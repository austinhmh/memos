package oauth2

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/netutil"
	"github.com/usememos/memos/plugin/idp"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestNewIdentityProvider(t *testing.T) {
	tests := []struct {
		name        string
		config      *storepb.OAuth2Config
		containsErr string
	}{
		{
			name:        "nil config",
			config:      nil,
			containsErr: "oauth2 config is required",
		},
		{
			name: "nil field mapping",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "https://example.com/oauth/authorize",
				TokenUrl:     "https://example.com/token",
				UserInfoUrl:  "https://example.com/api/user",
			},
			containsErr: "fieldMapping is required",
		},
		{
			name: "internal authUrl rejected",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "http://127.0.0.1/oauth/authorize",
				TokenUrl:     "https://example.com/token",
				UserInfoUrl:  "https://example.com/api/user",
				FieldMapping: &storepb.FieldMapping{Identifier: "login"},
			},
			containsErr: `invalid authUrl`,
		},
		{
			name: "unsupported authUrl scheme rejected",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "javascript:alert(1)",
				TokenUrl:     "https://example.com/token",
				UserInfoUrl:  "https://example.com/api/user",
				FieldMapping: &storepb.FieldMapping{Identifier: "login"},
			},
			containsErr: `invalid authUrl`,
		},
		{
			name: "internal userInfoUrl rejected",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "http://8.8.8.8/oauth/authorize",
				TokenUrl:     "http://8.8.8.8/token",
				UserInfoUrl:  "http://127.0.0.1/internal",
				FieldMapping: &storepb.FieldMapping{Identifier: "login"},
			},
			containsErr: `invalid userInfoUrl`,
		},
		{
			name: "no tokenUrl",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "https://example.com/oauth/authorize",
				TokenUrl:     "",
				UserInfoUrl:  "https://example.com/api/user",
				FieldMapping: &storepb.FieldMapping{
					Identifier: "login",
				},
			},
			containsErr: `the field "tokenUrl" is empty but required`,
		},
		{
			name: "no userInfoUrl",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "https://example.com/oauth/authorize",
				TokenUrl:     "https://example.com/token",
				UserInfoUrl:  "",
				FieldMapping: &storepb.FieldMapping{
					Identifier: "login",
				},
			},
			containsErr: `the field "userInfoUrl" is empty but required`,
		},
		{
			name: "no field mapping identifier",
			config: &storepb.OAuth2Config{
				ClientId:     "test-client-id",
				ClientSecret: "test-client-secret",
				AuthUrl:      "https://example.com/oauth/authorize",
				TokenUrl:     "https://example.com/token",
				UserInfoUrl:  "https://example.com/api/user",
				FieldMapping: &storepb.FieldMapping{
					Identifier: "",
				},
			},
			containsErr: `the field "fieldMapping.identifier" is empty but required`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(*testing.T) {
			_, err := NewIdentityProvider(test.config)
			assert.ErrorContains(t, err, test.containsErr)
		})
	}
}

func newMockServer(t *testing.T, code, accessToken string, userinfo []byte) *httptest.Server {
	mux := http.NewServeMux()

	var rawIDToken string
	mux.HandleFunc("/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)

		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		vals, err := url.ParseQuery(string(body))
		require.NoError(t, err)

		require.Equal(t, code, vals.Get("code"))
		require.Equal(t, "authorization_code", vals.Get("grant_type"))

		w.Header().Set("Content-Type", "application/json")
		err = json.NewEncoder(w).Encode(map[string]any{
			"access_token": accessToken,
			"token_type":   "Bearer",
			"expires_in":   3600,
			"id_token":     rawIDToken,
		})
		require.NoError(t, err)
	})
	mux.HandleFunc("/oauth2/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, err := w.Write(userinfo)
		require.NoError(t, err)
	})

	s := httptest.NewServer(mux)

	return s
}

func TestValidateExternalURLRejectsPrivateAddresses(t *testing.T) {
	for _, rawURL := range []string{
		"http://127.0.0.1/token",
		"http://[::1]/token",
		"http://10.0.0.1/token",
		"http://172.16.0.1/token",
		"http://192.168.0.1/token",
		"http://169.254.169.254/latest/meta-data",
		"http://100.64.0.1/token",
		"http://192.0.0.1/token",
		"http://198.18.0.1/token",
		"http://0.0.0.1/token",
		"http://240.0.0.1/token",
		"http://255.255.255.255/token",
		"http://[::ffff:127.0.0.1]/token",
		"http://[::ffff:169.254.169.254]/token",
		"http://[64:ff9b::a9fe:a9fe]/token",
		"http://[2001::1]/token",
		"http://[2001:db8::1]/token",
		"http://[fc00::1]/token",
		"http://[fd00::1]/token",
	} {
		t.Run(rawURL, func(t *testing.T) {
			err := validateExternalURL(context.Background(), rawURL)
			require.Error(t, err)
			assert.ErrorContains(t, err, "non-public")
		})
	}
}

func TestValidateExternalURLRejectsInvalidOrSensitivePorts(t *testing.T) {
	for _, rawURL := range []string{
		"http://1.1.1.1:22/token",
		"http://1.1.1.1:25/token",
		"http://1.1.1.1:65535/token",
		"http://1.1.1.1:0/token",
		"http://1.1.1.1:abc/token",
	} {
		t.Run(rawURL, func(t *testing.T) {
			err := validateExternalURL(context.Background(), rawURL)
			require.Error(t, err)
			assert.ErrorContains(t, err, "port")
		})
	}
}

func TestValidateExternalURLAllowsDefaultWebPorts(t *testing.T) {
	for _, rawURL := range []string{
		"http://1.1.1.1/token",
		"http://1.1.1.1:80/token",
		"https://1.1.1.1:443/token",
	} {
		t.Run(rawURL, func(t *testing.T) {
			require.NoError(t, validateExternalURL(context.Background(), rawURL))
		})
	}
}

func TestNewExternalTransportRejectsPrivateDialTargetAndDisablesProxy(t *testing.T) {
	transport := netutil.NewExternalTransport(netutil.ExternalURLValidator{})
	require.Nil(t, transport.Proxy)

	conn, err := transport.DialContext(context.Background(), "tcp", net.JoinHostPort("127.0.0.1", "80"))
	require.Error(t, err)
	require.Nil(t, conn)
	assert.ErrorContains(t, err, "non-public")
}

func TestHTTPClientRejectsInternalRedirect(t *testing.T) {
	previousValidator := validateExternalURLFunc
	validateExternalURLFunc = func(_ context.Context, rawURL string) error {
		if rawURL == "http://127.0.0.1/internal" {
			return errInternalIP
		}
		return nil
	}
	defer func() {
		validateExternalURLFunc = previousValidator
	}()

	redirectURL, err := url.Parse("http://127.0.0.1/internal")
	require.NoError(t, err)
	err = newHTTPClient().CheckRedirect(&http.Request{URL: redirectURL}, nil)
	require.Error(t, err)
	assert.ErrorContains(t, err, "redirect to non-public address")
}

func TestIdentityProvider(t *testing.T) {
	ctx := context.Background()

	const (
		testClientID    = "test-client-id"
		testCode        = "test-code"
		testAccessToken = "test-access-token"
		testSubject     = "123456789"
		testName        = "John Doe"
		testEmail       = "john.doe@example.com"
	)
	userInfo, err := json.Marshal(
		map[string]any{
			"sub":   testSubject,
			"name":  testName,
			"email": testEmail,
		},
	)
	require.NoError(t, err)

	s := newMockServer(t, testCode, testAccessToken, userInfo)
	previousValidator := validateExternalURLFunc
	previousHTTPClientFactory := newHTTPClient
	validateExternalURLFunc = func(context.Context, string) error { return nil }
	newHTTPClient = func() *http.Client { return s.Client() }
	defer func() {
		validateExternalURLFunc = previousValidator
		newHTTPClient = previousHTTPClientFactory
	}()

	oauth2, err := NewIdentityProvider(
		&storepb.OAuth2Config{
			ClientId:     testClientID,
			ClientSecret: "test-client-secret",
			AuthUrl:      fmt.Sprintf("%s/oauth2/authorize", s.URL),
			TokenUrl:     fmt.Sprintf("%s/oauth2/token", s.URL),
			UserInfoUrl:  fmt.Sprintf("%s/oauth2/userinfo", s.URL),
			FieldMapping: &storepb.FieldMapping{
				Identifier:  "sub",
				DisplayName: "name",
				Email:       "email",
			},
		},
	)
	require.NoError(t, err)

	redirectURL := "https://example.com/oauth/callback"
	// Test without PKCE (backward compatibility)
	oauthToken, err := oauth2.ExchangeToken(ctx, redirectURL, testCode, "")
	require.NoError(t, err)
	require.Equal(t, testAccessToken, oauthToken)

	userInfoResult, err := oauth2.UserInfo(oauthToken)
	require.NoError(t, err)

	wantUserInfo := &idp.IdentityProviderUserInfo{
		Identifier:  testSubject,
		DisplayName: testName,
		Email:       testEmail,
	}
	assert.Equal(t, wantUserInfo, userInfoResult)
}
