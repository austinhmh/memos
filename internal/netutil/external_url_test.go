package netutil

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateExternalURLRejectsSpecialPurposeAddresses(t *testing.T) {
	for _, rawURL := range []string{
		"http://127.0.0.1/token",
		"http://[::1]/token",
		"http://10.0.0.1/token",
		"http://172.16.0.1/token",
		"http://192.168.0.1/token",
		"http://169.254.169.254/latest/meta-data",
		"http://100.64.0.1/token",
		"http://192.0.0.1/token",
		"http://192.0.2.10/token",
		"http://198.18.0.1/token",
		"http://198.51.100.10/token",
		"http://203.0.113.10/token",
		"http://0.0.0.1/token",
		"http://240.0.0.1/token",
		"http://255.255.255.255/token",
		"http://[::ffff:127.0.0.1]/token",
		"http://[::ffff:169.254.169.254]/token",
		"http://[64:ff9b::a9fe:a9fe]/token",
		"http://[2001::1]/token",
		"http://[2001:db8::1]/token",
		"http://[2002:7f00:1::]/token",
		"http://[fc00::1]/token",
		"http://[fd00::1]/token",
	} {
		t.Run(rawURL, func(t *testing.T) {
			_, err := ValidateExternalURL(context.Background(), rawURL)
			require.Error(t, err)
			assert.ErrorIs(t, err, ErrNonPublicAddress)
		})
	}
}

func TestValidateExternalURLAllowsPublicHTTPAddresses(t *testing.T) {
	for _, rawURL := range []string{
		"http://1.1.1.1/token",
		"http://1.1.1.1:80/token",
		"https://1.1.1.1:443/token",
		"https://[2606:4700:4700::1111]/token",
	} {
		t.Run(rawURL, func(t *testing.T) {
			_, err := ValidateExternalURL(context.Background(), rawURL)
			require.NoError(t, err)
		})
	}
}

func TestValidateExternalURLRejectsInvalidURLForms(t *testing.T) {
	for _, rawURL := range []string{
		"javascript:alert(1)",
		"http://user@example.com/token",
		"http:///missing-host",
		"http://1.1.1.1:abc/token",
		"http://1.1.1.1:0/token",
	} {
		t.Run(rawURL, func(t *testing.T) {
			_, err := ValidateExternalURL(context.Background(), rawURL)
			require.Error(t, err)
		})
	}
}

func TestExternalURLValidatorRestrictsPortsWhenConfigured(t *testing.T) {
	validator := ExternalURLValidator{AllowedPorts: map[int]struct{}{80: {}, 443: {}}}
	_, err := validator.Validate(context.Background(), "http://1.1.1.1:22/token")
	require.Error(t, err)
	assert.ErrorContains(t, err, "unsupported port")
}

func TestNewExternalTransportRejectsNonPublicDialTargetAndDisablesProxy(t *testing.T) {
	transport := NewExternalTransport(ExternalURLValidator{})
	require.Nil(t, transport.Proxy)

	conn, err := transport.DialContext(context.Background(), "tcp", net.JoinHostPort("127.0.0.1", "80"))
	require.Error(t, err)
	require.Nil(t, conn)
	assert.ErrorIs(t, err, ErrNonPublicAddress)
}

func TestExternalHTTPClientRejectsNonPublicRedirect(t *testing.T) {
	redirectURL := mustParseURL(t, "http://127.0.0.1/internal")
	err := NewExternalHTTPClient(0).CheckRedirect(&http.Request{URL: redirectURL}, nil)
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNonPublicAddress)
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	require.NoError(t, err)
	return parsed
}
