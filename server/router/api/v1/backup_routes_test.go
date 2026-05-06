package v1

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestAuthorizeBackupRequestRequiresHostRole(t *testing.T) {
	ctx := context.Background()
	service, testStore, secret := newBackupRouteTestService(ctx, t)
	defer testStore.Close()
	user, err := testStore.CreateUser(ctx, &store.User{Username: "backup-regular", Role: store.RoleUser, Email: "backup-regular@example.com"})
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), []byte(secret))
	require.NoError(t, err)
	echoServer := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/backups", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()

	_, status, message := service.authorizeBackupRequest(echoServer.NewContext(request, recorder))

	require.Equal(t, http.StatusForbidden, status)
	require.Equal(t, "permission denied", message)
}

func TestAuthorizeBackupRequestAllowsHostRole(t *testing.T) {
	ctx := context.Background()
	service, testStore, secret := newBackupRouteTestService(ctx, t)
	defer testStore.Close()
	user, err := testStore.CreateUser(ctx, &store.User{Username: "backup-host", Role: store.RoleHost, Email: "backup-host@example.com"})
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), []byte(secret))
	require.NoError(t, err)
	echoServer := echo.New()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/backups", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()

	_, status, message := service.authorizeBackupRequest(echoServer.NewContext(request, recorder))

	require.Equal(t, http.StatusOK, status)
	require.Empty(t, message)
}

func newBackupRouteTestService(ctx context.Context, t *testing.T) (*APIV1Service, *store.Store, string) {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	secret := "test-secret"
	service := NewAPIV1Service(secret, &profile.Profile{Mode: "dev", Version: "test-1.0.0", Driver: "sqlite"}, testStore)
	return service, testStore, secret
}
