// Package oauth2 is the plugin for OAuth2 Identity Provider.
package oauth2

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/oauth2"

	"github.com/usememos/memos/internal/netutil"
	"github.com/usememos/memos/plugin/idp"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// IdentityProvider represents an OAuth2 Identity Provider.
type IdentityProvider struct {
	config *storepb.OAuth2Config
}

var errInternalIP = netutil.ErrNonPublicAddress

const (
	oauth2RequestTimeout    = 5 * time.Second
	maxUserInfoResponseSize = 1 << 20
)

var validateExternalURLFunc = func(ctx context.Context, rawURL string) error {
	_, err := netutil.ExternalURLValidator{AllowedPorts: map[int]struct{}{80: {}, 443: {}}}.Validate(ctx, rawURL)
	return err
}

var newHTTPClient = func() *http.Client {
	validator := netutil.ExternalURLValidator{AllowedPorts: map[int]struct{}{80: {}, 443: {}}}
	return &http.Client{
		Timeout:   oauth2RequestTimeout,
		Transport: netutil.NewExternalTransport(validator),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			if _, err := validator.Validate(req.Context(), req.URL.String()); err != nil {
				return errors.Wrap(err, "redirect to non-public address")
			}
			return nil
		},
	}
}

func validateExternalURL(ctx context.Context, rawURL string) error {
	return validateExternalURLFunc(ctx, rawURL)
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

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUserInfoResponseSize+1))
	if err != nil {
		return nil, errors.Wrap(err, "failed to read response body")
	}
	if len(body) > maxUserInfoResponseSize {
		return nil, errors.New("user info response body too large")
	}

	var claims map[string]any
	if err := json.Unmarshal(body, &claims); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal response body")
	}
	slog.Info("received user info claims", "claim_count", len(claims))
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
	slog.Info("mapped user info", "identifier", userInfo.Identifier, "has_email", userInfo.Email != "", "has_avatar", userInfo.AvatarURL != "")
	return userInfo, nil
}
