package frontend

import (
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
)

func TestServeSkipsNativeRoutes(t *testing.T) {
	e := echo.New()
	NewFrontendService(nil, nil).Serve(context.Background(), e)

	for _, path := range []string{"/file", "/file/users/archived/avatar", "/api", "/api/v1/memos", "/memos.api.v1.AuthService/SignIn"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusNotFound, rec.Code, path)
		require.NotContains(t, rec.Body.String(), "<!doctype html>", path)
	}
}

func TestServeUsesNoStoreForSPAFallbackRoutes(t *testing.T) {
	e := echo.New()
	NewFrontendService(nil, nil).Serve(context.Background(), e)

	req := httptest.NewRequest(http.MethodGet, "/explore", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "<!doctype html>")
	require.Equal(t, "no-cache, no-store, must-revalidate", rec.Header().Get(echo.HeaderCacheControl))
	require.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	csp := rec.Header().Get("Content-Security-Policy")
	require.Contains(t, csp, "script-src 'self'")
	require.NotContains(t, csp, "script-src 'self' 'unsafe-inline'")
}

func TestServeStaticLikeMissingResourcesReturnNotFound(t *testing.T) {
	e := echo.New()
	NewFrontendService(nil, nil).Serve(context.Background(), e)

	for _, path := range []string{"/assets/missing.js", "/missing-logo-does-not-exist.webp", "/missing-site-does-not-exist.webmanifest", "/missing-apple-touch-icon.png"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusNotFound, rec.Code, path)
		require.NotContains(t, rec.Body.String(), "<!doctype html>", path)
	}
}

func TestServeEmbedsUnderscorePrefixedAssets(t *testing.T) {
	assets, err := fs.ReadDir(embeddedFiles, "dist/assets")
	if err != nil {
		t.Skip("frontend release assets are not present")
	}

	var underscoreAssetPath string
	for _, asset := range assets {
		if strings.HasPrefix(asset.Name(), "_") && !asset.IsDir() {
			underscoreAssetPath = "/assets/" + asset.Name()
			break
		}
	}
	require.NotEmpty(t, underscoreAssetPath)

	e := echo.New()
	NewFrontendService(nil, nil).Serve(context.Background(), e)

	req := httptest.NewRequest(http.MethodGet, path.Clean(underscoreAssetPath), nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotContains(t, rec.Body.String(), "<!doctype html>")
}

func TestServeDoesNotSkipAdjacentNativeRoutePrefixes(t *testing.T) {
	e := echo.New()
	NewFrontendService(nil, nil).Serve(context.Background(), e)

	tests := []struct {
		path     string
		wantCode int
		wantHTML bool
	}{
		{path: "/files", wantCode: http.StatusOK, wantHTML: true},
		{path: "/filex", wantCode: http.StatusOK, wantHTML: true},
		{path: "/apiary", wantCode: http.StatusOK, wantHTML: true},
		{path: "/memos.api.v1foo", wantCode: http.StatusNotFound, wantHTML: false},
	}
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, tc.wantCode, rec.Code, tc.path)
		if tc.wantHTML {
			require.Contains(t, rec.Body.String(), "<!doctype html>", tc.path)
		} else {
			require.NotContains(t, rec.Body.String(), "<!doctype html>", tc.path)
		}
	}
}
