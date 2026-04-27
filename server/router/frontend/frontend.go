package frontend

import (
	"context"
	"embed"
	"io/fs"
	"net/http"
	pathpkg "path"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/store"
)

//go:embed dist/*
var embeddedFiles embed.FS

type FrontendService struct {
	Profile *profile.Profile
	Store   *store.Store
}

func NewFrontendService(profile *profile.Profile, store *store.Store) *FrontendService {
	return &FrontendService{
		Profile: profile,
		Store:   store,
	}
}

func (*FrontendService) Serve(_ context.Context, e *echo.Echo) {
	frontendFS := getFileSystem("dist")

	skipper := func(c echo.Context) bool {
		requestPath := c.Request().URL.Path
		if isNativeRoute(requestPath) {
			return true
		}
		cleanPath := strings.TrimPrefix(pathpkg.Clean(requestPath), "/")
		if cleanPath == "." {
			cleanPath = "index.html"
		}
		file, err := frontendFS.Open(cleanPath)
		if err == nil {
			_ = file.Close()
			if cleanPath == "index.html" {
				setIndexHeaders(c)
			} else {
				c.Response().Header().Set(echo.HeaderCacheControl, "public, max-age=3600, immutable")
			}
			return false
		}
		if pathpkg.Ext(cleanPath) != "" {
			return true
		}
		setIndexHeaders(c)
		return false
	}

	// Route to serve the main app with HTML5 fallback for SPA behavior.
	e.Use(middleware.StaticWithConfig(middleware.StaticConfig{
		Filesystem: frontendFS,
		HTML5:      true, // Enable fallback to index.html
		Skipper:    skipper,
	}))
}

func isNativeRoute(requestPath string) bool {
	return requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") ||
		strings.HasPrefix(requestPath, "/memos.api.v1.") ||
		requestPath == "/file" || strings.HasPrefix(requestPath, "/file/")
}

func setIndexHeaders(c echo.Context) {
	c.Response().Header().Set(echo.HeaderCacheControl, "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")
	c.Response().Header().Set("X-Frame-Options", "DENY")
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	c.Response().Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	c.Response().Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'")
}

func getFileSystem(path string) http.FileSystem {
	fs, err := fs.Sub(embeddedFiles, path)
	if err != nil {
		panic(err)
	}
	return http.FS(fs)
}
