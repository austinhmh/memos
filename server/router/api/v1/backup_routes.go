package v1

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/pkg/errors"

	"github.com/usememos/memos/server/auth"
	backupsvc "github.com/usememos/memos/server/backup"
	"github.com/usememos/memos/store"
)

const restoreBodyLimit = "256M"

// RegisterBackupRoutes registers host-only logical backup endpoints.
func (s *APIV1Service) RegisterBackupRoutes(echoServer *echo.Echo) {
	backupGroup := echoServer.Group("/api/v1/admin/backups")
	backupGroup.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOriginFunc:  s.corsAllowOrigin,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowHeaders:     []string{"Authorization", "Content-Type", "Cookie", "Origin"},
		AllowCredentials: true,
	}))
	backupGroup.GET("", s.handleListBackups)
	backupGroup.POST("/run", s.handleRunBackup)
	backupGroup.POST("/restore", s.handleRestoreBackup, middleware.BodyLimit(restoreBodyLimit))
}

func (s *APIV1Service) handleListBackups(c echo.Context) error {
	ctx, httpStatus, message := s.authorizeBackupRequest(c)
	if message != "" {
		return backupError(c, httpStatus, message, nil)
	}
	objects, err := backupsvc.NewService(s.Profile, s.Store).ListBackups(ctx)
	if err != nil {
		return backupError(c, http.StatusInternalServerError, internalServerErrorMessage, err, "action", "list_backups")
	}
	return c.JSON(http.StatusOK, map[string]any{"backups": objects})
}

func (s *APIV1Service) handleRunBackup(c echo.Context) error {
	ctx, httpStatus, message := s.authorizeBackupRequest(c)
	if message != "" {
		return backupError(c, httpStatus, message, nil)
	}
	object, err := backupsvc.NewService(s.Profile, s.Store).UploadArchive(ctx)
	if err != nil {
		return backupError(c, http.StatusInternalServerError, internalServerErrorMessage, err, "action", "run_backup")
	}
	return c.JSON(http.StatusOK, object)
}

func (s *APIV1Service) handleRestoreBackup(c echo.Context) error {
	ctx, httpStatus, message := s.authorizeBackupRequest(c)
	if message != "" {
		return backupError(c, httpStatus, message, nil)
	}
	file, err := c.FormFile("file")
	if err != nil {
		return backupError(c, http.StatusBadRequest, "backup file is required", nil)
	}
	reader, err := file.Open()
	if err != nil {
		return backupError(c, http.StatusBadRequest, "failed to open backup file", nil)
	}
	defer reader.Close()
	if err := backupsvc.NewService(s.Profile, s.Store).RestoreArchive(ctx, reader); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return backupError(c, http.StatusRequestTimeout, "restore request timed out", err, "action", "restore_backup")
		}
		if err.Error() == "restore target is not empty" {
			return backupError(c, http.StatusPreconditionFailed, "restore target is not empty", nil)
		}
		return backupError(c, http.StatusInternalServerError, internalServerErrorMessage, err, "action", "restore_backup")
	}
	return c.JSON(http.StatusOK, map[string]bool{"restored": true})
}

func (s *APIV1Service) authorizeBackupRequest(c echo.Context) (context.Context, int, string) {
	ctx := c.Request().Context()
	authResult := auth.NewAuthenticator(s.Store, s.Secret).Authenticate(ctx, c.Request().Header.Get("Authorization"))
	if authResult == nil {
		return ctx, http.StatusUnauthorized, "authentication required"
	}
	if authResult.Claims != nil {
		ctx = auth.SetUserClaimsInContext(ctx, authResult.Claims)
		ctx = context.WithValue(ctx, auth.UserIDContextKey, authResult.Claims.UserID)
	} else if authResult.User != nil {
		ctx = auth.SetUserInContext(ctx, authResult.User, authResult.AccessToken)
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return ctx, http.StatusInternalServerError, "failed to get current user"
	}
	if user == nil {
		return ctx, http.StatusUnauthorized, "authentication required"
	}
	if user.Role != store.RoleHost {
		return ctx, http.StatusForbidden, "permission denied"
	}
	return ctx, http.StatusOK, ""
}

func backupError(c echo.Context, status int, message string, err error, attrs ...any) error {
	if err != nil {
		args := append([]any{"status", status}, attrs...)
		args = append(args, "error", err)
		slog.Error("backup route error", args...)
	}
	return c.JSON(status, map[string]string{"error": message})
}
