package netutil

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"time"

	"github.com/pkg/errors"
)

var ErrNonPublicAddress = errors.New("non-public IP addresses are not allowed")

var specialPurposeIPRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("255.255.255.255/32"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("::ffff:0:0/96"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

type ExternalURLValidator struct {
	Resolver       *net.Resolver
	AllowedSchemes map[string]struct{}
	AllowedPorts   map[int]struct{}
}

type ValidatedExternalURL struct {
	URL  *url.URL
	Host string
	Port string
	IPs  []net.IP
}

func IsNonPublicIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	return IsNonPublicAddr(addr)
}

func IsNonPublicAddr(addr netip.Addr) bool {
	if addr.Is4In6() {
		mapped := addr.Unmap()
		return mapped != addr && IsNonPublicAddr(mapped)
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsMulticast() || addr.IsUnspecified() {
		return true
	}
	for _, prefix := range specialPurposeIPRanges {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func ValidateExternalURL(ctx context.Context, rawURL string) (*ValidatedExternalURL, error) {
	return ExternalURLValidator{}.Validate(ctx, rawURL)
}

func (v ExternalURLValidator) Validate(ctx context.Context, rawURL string) (*ValidatedExternalURL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, errors.Wrap(err, "failed to parse URL")
	}
	if parsed.User != nil {
		return nil, errors.New("URL must not contain user info")
	}
	if parsed.RawPath != "" {
		return nil, errors.Errorf("invalid path %q", parsed.RawPath)
	}
	if !v.isAllowedScheme(parsed.Scheme) {
		return nil, errors.Errorf("unsupported scheme %q, only http/https allowed", parsed.Scheme)
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, errors.New("empty hostname")
	}
	port, err := v.port(parsed)
	if err != nil {
		return nil, err
	}
	ips, err := v.LookupExternalIPs(ctx, host)
	if err != nil {
		return nil, err
	}
	return &ValidatedExternalURL{
		URL:  parsed,
		Host: host,
		Port: port,
		IPs:  ips,
	}, nil
}

func (v ExternalURLValidator) LookupExternalIPs(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if IsNonPublicIP(ip) {
			return nil, errors.Wrap(ErrNonPublicAddress, ip.String())
		}
		return []net.IP{ip}, nil
	}
	resolver := v.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	ips, err := resolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve hostname")
	}
	if err := ValidateResolvedIPs(host, ips); err != nil {
		return nil, err
	}
	return ips, nil
}

func ValidateResolvedIPs(host string, ips []net.IP) error {
	if len(ips) == 0 {
		return errors.New("hostname resolved to no IPs")
	}
	for _, ip := range ips {
		if IsNonPublicIP(ip) {
			return errors.Wrapf(ErrNonPublicAddress, "host=%s, ip=%s", host, ip.String())
		}
	}
	return nil
}

func NewExternalHTTPClient(timeout time.Duration) *http.Client {
	validator := ExternalURLValidator{}
	return &http.Client{
		Timeout:   timeout,
		Transport: NewExternalTransport(validator),
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

func NewExternalTransport(validator ExternalURLValidator) *http.Transport {
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, errors.Wrap(err, "invalid address")
			}
			ips, err := validator.LookupExternalIPs(ctx, host)
			if err != nil {
				return nil, err
			}
			var dialer net.Dialer
			for _, ip := range ips {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			return nil, errors.Errorf("failed to connect to %s", host)
		},
	}
}

func (v ExternalURLValidator) isAllowedScheme(scheme string) bool {
	if len(v.AllowedSchemes) == 0 {
		return scheme == "http" || scheme == "https"
	}
	_, ok := v.AllowedSchemes[scheme]
	return ok
}

func (v ExternalURLValidator) port(parsed *url.URL) (string, error) {
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			return "443", nil
		}
		return "80", nil
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return "", errors.Errorf("invalid port %q", port)
	}
	if len(v.AllowedPorts) > 0 {
		if _, ok := v.AllowedPorts[portNumber]; !ok {
			return "", errors.Errorf("unsupported port %d", portNumber)
		}
	}
	return port, nil
}
