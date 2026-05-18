package rss

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/plugin/markdown"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestExploreRSSDoesNotServeArchivedMemoFromCachedBody(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()
	service := NewRSSService(&profile.Profile{Mode: "prod"}, testStore, markdown.NewService())

	user, err := testStore.CreateUser(ctx, &store.User{Username: "rss-owner", Role: store.RoleUser, Email: "rss-owner@example.com"})
	require.NoError(t, err)
	memo, err := testStore.CreateMemo(ctx, &store.Memo{UID: "rss-public-memo", CreatorID: user.ID, Content: "archived rss content", Visibility: store.Public})
	require.NoError(t, err)

	first := performRSSRequest(t, service.GetExploreRSS, "/explore/rss.xml")
	require.Equal(t, http.StatusOK, first.Code)
	require.Contains(t, first.Body.String(), "archived rss content")
	require.Equal(t, "no-store", first.Header().Get(echo.HeaderCacheControl))

	archivedStatus := store.Archived
	require.NoError(t, testStore.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &archivedStatus}))

	second := performRSSRequest(t, service.GetExploreRSS, "/explore/rss.xml")
	require.Equal(t, http.StatusOK, second.Code)
	require.NotContains(t, second.Body.String(), "archived rss content")
}

func TestUserRSSDoesNotServeArchivedUserFromCachedBody(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()
	service := NewRSSService(&profile.Profile{Mode: "prod"}, testStore, markdown.NewService())

	user, err := testStore.CreateUser(ctx, &store.User{Username: "rss-archived-user", Role: store.RoleUser, Email: "rss-archived-user@example.com"})
	require.NoError(t, err)
	_, err = testStore.CreateMemo(ctx, &store.Memo{UID: "rss-user-memo", CreatorID: user.ID, Content: "archived user rss content", Visibility: store.Public})
	require.NoError(t, err)

	first := performRSSRequest(t, service.GetUserRSS, "/u/rss-archived-user/rss.xml")
	require.Equal(t, http.StatusOK, first.Code)
	require.Contains(t, first.Body.String(), "archived user rss content")

	archivedStatus := store.Archived
	_, err = testStore.UpdateUser(ctx, &store.UpdateUser{ID: user.ID, RowStatus: &archivedStatus})
	require.NoError(t, err)

	second := performRSSRequest(t, service.GetUserRSS, "/u/rss-archived-user/rss.xml")
	require.Equal(t, http.StatusNotFound, second.Code)
	require.False(t, strings.Contains(second.Body.String(), "archived user rss content"))
}

func TestRSSUsesConfiguredInstanceURLInsteadOfHostHeader(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()
	service := NewRSSService(&profile.Profile{Mode: "prod", InstanceURL: "https://memos.example.com/base/"}, testStore, markdown.NewService())

	user, err := testStore.CreateUser(ctx, &store.User{Username: "rss-host-owner", Role: store.RoleUser, Email: "rss-host-owner@example.com"})
	require.NoError(t, err)
	_, err = testStore.CreateMemo(ctx, &store.Memo{UID: "rss-host-memo", CreatorID: user.ID, Content: "host header rss content", Visibility: store.Public})
	require.NoError(t, err)

	resp := performRSSRequestWithHost(t, service.GetExploreRSS, "/explore/rss.xml", "evil.example")
	require.Equal(t, http.StatusOK, resp.Code)
	require.Contains(t, resp.Body.String(), "https://memos.example.com/base/memos/rss-host-memo")
	require.NotContains(t, resp.Body.String(), "evil.example")
}

func TestRSSFallsBackToRequestHostWithoutInstanceURL(t *testing.T) {
	service := NewRSSService(&profile.Profile{Mode: "prod"}, nil, markdown.NewService())
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/explore/rss.xml", nil)
	req.Host = "fallback.example"
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	require.Equal(t, "http://fallback.example", service.baseURL(c))
}

func performRSSRequest(t *testing.T, handler echo.HandlerFunc, target string) *httptest.ResponseRecorder {
	t.Helper()
	return performRSSRequestWithHost(t, handler, target, "")
}

func performRSSRequestWithHost(t *testing.T, handler echo.HandlerFunc, target string, host string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if host != "" {
		req.Host = host
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if strings.HasPrefix(target, "/u/") {
		parts := strings.Split(target, "/")
		require.GreaterOrEqual(t, len(parts), 3)
		c.SetParamNames("username")
		c.SetParamValues(parts[2])
	}
	if err := handler(c); err != nil {
		e.HTTPErrorHandler(err, c)
	}
	return rec
}
