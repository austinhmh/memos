package v1

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
)

func TestGatewayHeaderMatchers(t *testing.T) {
	incomingHeaders := map[string]string{
		"Cookie":     "cookie",
		"User-Agent": "user-agent",
	}
	for input, expected := range incomingHeaders {
		mapped, ok := gatewayIncomingHeaderMatcher(input)
		require.True(t, ok)
		require.Equal(t, expected, mapped)

		mapped, ok = gatewayIncomingHeaderMatcher(strings.ToLower(input))
		require.True(t, ok)
		require.Equal(t, expected, mapped)
	}

	for _, input := range []string{"Accept", "Grpc-Metadata-Debug", "Origin", "X-Forwarded-For", "X-Forwarded-Proto", "X-Real-Ip"} {
		mapped, ok := gatewayIncomingHeaderMatcher(input)
		require.False(t, ok)
		require.Empty(t, mapped)
	}

	for _, input := range []string{"set-cookie", "Set-Cookie", "SET-COOKIE"} {
		mapped, ok := gatewayOutgoingHeaderMatcher(input)
		require.True(t, ok)
		require.Equal(t, "Set-Cookie", mapped)
	}

	for _, input := range []string{"grpc-metadata-debug", "content-type", "authorization"} {
		mapped, ok := gatewayOutgoingHeaderMatcher(input)
		require.False(t, ok)
		require.Empty(t, mapped)
	}
}

func TestGatewayPublicPathACL(t *testing.T) {
	publicPaths := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/auth/signin"},
		{http.MethodPost, "/api/v1/auth/refresh"},
		{http.MethodPost, "/api/v1/users"},
		{http.MethodGet, "/api/v1/instance/profile"},
		{http.MethodGet, "/api/v1/instance/settings/general"},
		{http.MethodGet, "/api/v1/identity-providers"},
		{http.MethodGet, "/api/v1/users:stats"},
		{http.MethodGet, "/api/v1/users/1"},
		{http.MethodGet, "/api/v1/users/alice"},
		{http.MethodGet, "/api/v1/users/1:getStats"},
		{http.MethodGet, "/api/v1/memos"},
		{http.MethodGet, "/api/v1/memos/1"},
		{http.MethodGet, "/api/v1/memos/1/comments"},
	}
	for _, tc := range publicPaths {
		require.True(t, isPublicGatewayPath(tc.method, tc.path), "%s %s should be public", tc.method, tc.path)
	}

	protectedPaths := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/users"},
		{http.MethodGet, "/api/v1/identity-providers/1"},
		{http.MethodGet, "/api/v1/users/1/settings"},
		{http.MethodGet, "/api/v1/users/1/settings/general"},
		{http.MethodGet, "/api/v1/users/1/personalAccessTokens"},
		{http.MethodGet, "/api/v1/users/1/webhooks"},
		{http.MethodGet, "/api/v1/users/1/notifications"},
		{http.MethodGet, "/api/v1/users/1/shortcuts"},
		{http.MethodPost, "/api/v1/users/1/personalAccessTokens"},
		{http.MethodGet, "/api/v1/memos/1/attachments"},
		{http.MethodGet, "/api/v1/memos/1/reactions"},
		{http.MethodGet, "/api/v1/users/1%2Fsettings"},
		{http.MethodGet, "/api/v1/users/1%252Fsettings"},
		{http.MethodGet, "/api/v1/users/1%5Csettings"},
		{http.MethodGet, "/api/v1/memos/1%2Fattachments"},
		{http.MethodGet, "/api/v1/memos/1%252Fattachments"},
		{http.MethodGet, "/api/v1/users/1\\settings"},
		{http.MethodGet, "/api/v1/memos/1\\attachments"},
		{http.MethodGet, "/api/v1/users/1%25252Fsettings"},
		{http.MethodGet, "/api/v1/memos/1%25252Fattachments"},
		{http.MethodGet, "/api/v1/users/1%255Csettings"},
		{http.MethodGet, "/api/v1/users/1/../settings"},
		{http.MethodGet, "/api/v1/users/1/%2E%2E/settings"},
		{http.MethodGet, "/api/v1/users/./1"},
		{http.MethodGet, "/api/v1/users/1%2525252Fsettings"},
		{http.MethodGet, "/api/v1/users/1%252525252Fsettings"},
		{http.MethodGet, "/api/v1/users//settings"},
		{http.MethodGet, "/api/v1/memos/1//comments"},
		{http.MethodHead, "/api/v1/users/1"},
		{http.MethodPost, "/api/v1/users/1"},
		{http.MethodHead, "/api/v1/memos/1"},
		{http.MethodPost, "/api/v1/memos/1/comments"},
		{http.MethodPut, "/api/v1/users/1"},
		{http.MethodPatch, "/api/v1/memos/1"},
		{http.MethodDelete, "/api/v1/memos/1/comments"},
		{http.MethodPost, "/api/v1/memos"},
	}
	for _, tc := range protectedPaths {
		require.False(t, isPublicGatewayPath(tc.method, tc.path), "%s %s should require auth", tc.method, tc.path)
	}

	require.True(t, isPublicGatewayPath(http.MethodGet, "/api/v1/users/1/"))
	require.True(t, isPublicGatewayPath(http.MethodGet, "/api/v1/memos/1/comments/"))
}

func TestBuildRefreshTokenCookieUsesSecureByDefault(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour)

	httpsService := &APIV1Service{Profile: &profile.Profile{Mode: "prod", InstanceURL: "https://example.com"}}
	secureCookie := httpsService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.True(t, strings.Contains(secureCookie, "Secure"))

	prodEmptyURLService := &APIV1Service{Profile: &profile.Profile{Mode: "prod"}}
	prodEmptyURLCookie := prodEmptyURLService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.True(t, strings.Contains(prodEmptyURLCookie, "Secure"))

	httpService := &APIV1Service{Profile: &profile.Profile{Mode: "prod", InstanceURL: "http://example.com"}}
	httpCookie := httpService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.True(t, strings.Contains(httpCookie, "Secure"))

	localhostService := &APIV1Service{Profile: &profile.Profile{Mode: "prod", InstanceURL: "http://localhost:8081"}}
	localhostCookie := localhostService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.False(t, strings.Contains(localhostCookie, "Secure"))

	loopbackIPv4Service := &APIV1Service{Profile: &profile.Profile{Mode: "prod", InstanceURL: "http://127.0.0.1:8081"}}
	loopbackIPv4Cookie := loopbackIPv4Service.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.False(t, strings.Contains(loopbackIPv4Cookie, "Secure"))

	loopbackIPv6Service := &APIV1Service{Profile: &profile.Profile{Mode: "prod", InstanceURL: "http://[::1]:8081"}}
	loopbackIPv6Cookie := loopbackIPv6Service.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.False(t, strings.Contains(loopbackIPv6Cookie, "Secure"))

	devService := &APIV1Service{Profile: &profile.Profile{Mode: "dev"}}
	devCookie := devService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.False(t, strings.Contains(devCookie, "Secure"))

	devRemoteHTTPService := &APIV1Service{Profile: &profile.Profile{Mode: "dev", InstanceURL: "http://example.com"}}
	devRemoteHTTPCookie := devRemoteHTTPService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.True(t, strings.Contains(devRemoteHTTPCookie, "Secure"))

	nilProfileService := &APIV1Service{}
	nilProfileCookie := nilProfileService.buildRefreshTokenCookie(t.Context(), "refresh", expiresAt)
	require.True(t, strings.Contains(nilProfileCookie, "Secure"))
}
