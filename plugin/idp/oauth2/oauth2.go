// Package oauth2 is the plugin for OAuth2 Identity Provider.
package oauth2

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/oauth2"

	"github.com/usememos/memos/plugin/idp"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// IdentityProvider represents an OAuth2 Identity Provider.
type IdentityProvider struct {
	config *storepb.OAuth2Config
}

var errInternalIP = errors.New("internal IP addresses are not allowed")

var disallowedPublicIPRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("255.255.255.255/32"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
}

const oauth2RequestTimeout = 5 * time.Second

var validateExternalURLFunc = validateExternalURL

var newHTTPClient = func() *http.Client {
	return &http.Client{
		Timeout:   oauth2RequestTimeout,
		Transport: newSafeTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			if err := validateExternalURLFunc(req.Context(), req.URL.String()); err != nil {
				return errors.Wrap(err, "redirect to internal IP")
			}
			return nil
		},
	}
}

// NewIdentityProvider initializes a new OAuth2 Identity Provider with the given configuration.
func NewIdentityProvider(config *storepb.OAuth2Config) (*IdentityProvider, error) {
	if config == nil {
		return nil, errors.New("oauth2 config is required")
	}
	if config.FieldMapping == nil {
		return nil, errors.New("fieldMapping is required")
	}

	requiredFields := []struct {
		value string
		field string
	}{
		{config.ClientId, "clientId"},
		{config.ClientSecret, "clientSecret"},
		{config.AuthUrl, "authUrl"},
		{config.TokenUrl, "tokenUrl"},
		{config.UserInfoUrl, "userInfoUrl"},
		{config.FieldMapping.Identifier, "fieldMapping.identifier"},
	}
	for _, requiredField := range requiredFields {
		if requiredField.value == "" {
			return nil, errors.Errorf(`the field "%s" is empty but required`, requiredField.field)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), oauth2RequestTimeout)
	defer cancel()
	urlsToValidate := []struct {
		rawURL string
		field  string
	}{
		{config.AuthUrl, "authUrl"},
		{config.TokenUrl, "tokenUrl"},
		{config.UserInfoUrl, "userInfoUrl"},
	}
	for _, target := range urlsToValidate {
		if err := validateExternalURLFunc(ctx, target.rawURL); err != nil {
			return nil, errors.Wrapf(err, "invalid %s", target.field)
		}
	}

	return &IdentityProvider{
		config: config,
	}, nil
}

// ExchangeToken returns the exchanged OAuth2 token using the given authorization code.
// If codeVerifier is provided, it will be used for PKCE (Proof Key for Code Exchange) validation.
func (p *IdentityProvider) ExchangeToken(ctx context.Context, redirectURL, code, codeVerifier string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, oauth2RequestTimeout)
	defer cancel()

	if err := validateExternalURLFunc(ctx, p.config.TokenUrl); err != nil {
		return "", errors.Wrap(err, "invalid tokenUrl")
	}

	httpClient := newHTTPClient()
	conf := &oauth2.Config{
		ClientID:     p.config.ClientId,
		ClientSecret: p.config.ClientSecret,
		RedirectURL:  redirectURL,
		Scopes:       p.config.Scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:   p.config.AuthUrl,
			TokenURL:  p.config.TokenUrl,
			AuthStyle: oauth2.AuthStyleInParams,
		},
	}

	// Prepare token exchange options
	opts := []oauth2.AuthCodeOption{}

	// Add PKCE code_verifier if provided
	if codeVerifier != "" {
		opts = append(opts, oauth2.SetAuthURLParam("code_verifier", codeVerifier))
	}

	token, err := conf.Exchange(context.WithValue(ctx, oauth2.HTTPClient, httpClient), code, opts...)
	if err != nil {
		return "", errors.Wrap(err, "failed to exchange access token")
	}

	// Use the standard AccessToken field instead of Extra()
	// This is more reliable across different OAuth providers
	if token.AccessToken == "" {
		return "", errors.New("missing access token from authorization response")
	}

	return token.AccessToken, nil
}

// UserInfo returns the parsed user information using the given OAuth2 token.
func (p *IdentityProvider) UserInfo(token string) (*idp.IdentityProviderUserInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), oauth2RequestTimeout)
	defer cancel()

	if err := validateExternalURLFunc(ctx, p.config.UserInfoUrl); err != nil {
		return nil, errors.Wrap(err, "invalid userInfoUrl")
	}

	client := newHTTPClient()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.config.UserInfoUrl, nil)
	if err != nil {
		return nil, errors.Wrap(err, "failed to new http request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get user information")
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read response body")
	}

	var claims map[string]any
	if err := json.Unmarshal(body, &claims); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal response body")
	}
	slog.Info("user info claims", "claims", claims)
	userInfo := &idp.IdentityProviderUserInfo{}
	if v, ok := claims[p.config.FieldMapping.Identifier].(string); ok {
		userInfo.Identifier = v
	}
	if userInfo.Identifier == "" {
		return nil, errors.Errorf("the field %q is not found in claims or has empty value", p.config.FieldMapping.Identifier)
	}

	// Best effort to map optional fields
	if p.config.FieldMapping.DisplayName != "" {
		if v, ok := claims[p.config.FieldMapping.DisplayName].(string); ok {
			userInfo.DisplayName = v
		}
	}
	if userInfo.DisplayName == "" {
		userInfo.DisplayName = userInfo.Identifier
	}
	if p.config.FieldMapping.Email != "" {
		if v, ok := claims[p.config.FieldMapping.Email].(string); ok {
			userInfo.Email = v
		}
	}
	if p.config.FieldMapping.AvatarUrl != "" {
		if v, ok := claims[p.config.FieldMapping.AvatarUrl].(string); ok {
			userInfo.AvatarURL = v
		}
	}
	slog.Info("user info", "userInfo", userInfo)
	return userInfo, nil
}

func isDisallowedIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() {
		return true
	}
	for _, prefix := range disallowedPublicIPRanges {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func validateExternalURL(ctx context.Context, rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return errors.Wrap(err, "failed to parse URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.Errorf("unsupported scheme %q, only http/https allowed", parsed.Scheme)
	}
	host := parsed.Hostname()
	if host == "" {
		return errors.New("empty hostname")
	}
	if err := validateExternalURLPort(parsed); err != nil {
		return err
	}
	if ip := net.ParseIP(host); ip != nil {
		if isDisallowedIP(ip) {
			return errors.Wrap(errInternalIP, ip.String())
		}
		return nil
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return errors.Wrap(err, "failed to resolve hostname")
	}
	return validateResolvedIPs(host, ips)
}

func validateExternalURLPort(parsed *url.URL) error {
	port := parsed.Port()
	if port == "" {
		if parsed.RawPath != "" {
			return errors.Errorf("invalid port %q", parsed.RawPath)
		}
		return nil
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return errors.Errorf("invalid port %q", port)
	}
	if portNumber != 80 && portNumber != 443 {
		return errors.Errorf("unsupported port %d, only 80/443 allowed", portNumber)
	}
	return nil
}

func validateResolvedIPs(host string, ips []net.IP) error {
	if len(ips) == 0 {
		return errors.New("hostname resolved to no IPs")
	}
	for _, ip := range ips {
		if isDisallowedIP(ip) {
			return errors.Wrapf(errInternalIP, "host=%s, ip=%s", host, ip.String())
		}
	}
	return nil
}

func lookupExternalIPs(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if isDisallowedIP(ip) {
			return nil, errors.Wrap(errInternalIP, ip.String())
		}
		return []net.IP{ip}, nil
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve hostname")
	}
	if err := validateResolvedIPs(host, ips); err != nil {
		return nil, err
	}
	return ips, nil
}

func newSafeTransport() *http.Transport {
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := lookupExternalIPs(ctx, host)
			if err != nil {
				return nil, err
			}
			var d net.Dialer
			for _, ip := range ips {
				conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			return nil, errors.Errorf("failed to connect to %s", host)
		},
	}
}
