package v1

import (
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/usememos/memos/plugin/httpgetter"
)

const (
	linkCacheMaxSize = 500
	linkCacheTTL     = 24 * time.Hour
	linkFetchTimeout = 5 * time.Second
)

type linkCacheEntry struct {
	data      *httpgetter.HTMLMeta
	createdAt time.Time
}

type linkCache struct {
	mu      sync.RWMutex
	entries map[string]*linkCacheEntry
}

var globalLinkCache = &linkCache{
	entries: make(map[string]*linkCacheEntry),
}

func (c *linkCache) get(url string) (*httpgetter.HTMLMeta, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.entries[url]
	if !ok {
		return nil, false
	}
	if time.Since(entry.createdAt) > linkCacheTTL {
		return nil, false
	}
	return entry.data, true
}

func (c *linkCache) set(url string, data *httpgetter.HTMLMeta) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= linkCacheMaxSize {
		var oldestKey string
		var oldestTime time.Time
		for k, v := range c.entries {
			if oldestKey == "" || v.createdAt.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.createdAt
			}
		}
		if oldestKey != "" {
			delete(c.entries, oldestKey)
		}
	}
	c.entries[url] = &linkCacheEntry{
		data:      data,
		createdAt: time.Now(),
	}
}

// RegisterLinkRoutes registers the URL metadata endpoint on the Echo server.
func (s *APIV1Service) RegisterLinkRoutes(echoServer *echo.Echo) {
	echoServer.GET("/api/v1/url-metadata", s.handleGetURLMetadata)
}

func (s *APIV1Service) handleGetURLMetadata(c echo.Context) error {
	targetURL := c.QueryParam("url")
	if targetURL == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "url parameter is required"})
	}

	if cached, ok := globalLinkCache.get(targetURL); ok {
		return c.JSON(http.StatusOK, cached)
	}

	meta, err := httpgetter.GetHTMLMeta(targetURL)
	if err != nil {
		empty := &httpgetter.HTMLMeta{}
		globalLinkCache.set(targetURL, empty)
		return c.JSON(http.StatusOK, empty)
	}

	globalLinkCache.set(targetURL, meta)
	return c.JSON(http.StatusOK, meta)
}
