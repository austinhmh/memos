package fileserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestPublicBackgroundsExposeOnlyHostStandaloneImages(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	host, err := testStore.CreateUser(ctx, &store.User{Username: "background-host", Role: store.RoleHost, Email: "background-host@example.com"})
	require.NoError(t, err)
	regularUser, err := testStore.CreateUser(ctx, &store.User{Username: "background-user", Role: store.RoleUser, Email: "background-user@example.com"})
	require.NoError(t, err)
	privateMemo, err := testStore.CreateMemo(ctx, &store.Memo{
		UID:        "background-private-memo",
		CreatorID:  host.ID,
		Content:    "private background source",
		Visibility: store.Private,
		RowStatus:  store.Normal,
	})
	require.NoError(t, err)

	publicBackground, err := testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "host-background",
		CreatorID: host.ID,
		Filename:  "bg_wallpaper.png",
		Type:      "image/png",
		Size:      3,
		Blob:      []byte("png"),
	})
	require.NoError(t, err)
	_, err = testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "host-regular-image",
		CreatorID: host.ID,
		Filename:  "regular.png",
		Type:      "image/png",
		Size:      3,
		Blob:      []byte("img"),
	})
	require.NoError(t, err)
	_, err = testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "user-background",
		CreatorID: regularUser.ID,
		Filename:  "bg_user.png",
		Type:      "image/png",
		Size:      3,
		Blob:      []byte("usr"),
	})
	require.NoError(t, err)
	_, err = testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "host-background-text",
		CreatorID: host.ID,
		Filename:  "bg_note.txt",
		Type:      "text/plain",
		Size:      4,
		Blob:      []byte("note"),
	})
	require.NoError(t, err)
	_, err = testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "memo-bound-background",
		CreatorID: host.ID,
		Filename:  "bg_private.png",
		Type:      "image/png",
		Size:      3,
		Blob:      []byte("mem"),
		MemoID:    &privateMemo.ID,
	})
	require.NoError(t, err)

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, "file-secret")
	e := echo.New()
	e.GET("/file/backgrounds", service.listPublicBackgrounds)
	e.GET("/file/backgrounds/:uid/:filename", service.servePublicBackgroundFile)
	e.GET("/file/attachments/:uid/:filename", service.serveAttachmentFile)

	req := httptest.NewRequest(http.MethodGet, "/file/backgrounds", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "public, max-age=300", rec.Header().Get("Cache-Control"))
	require.Contains(t, rec.Body.String(), "\"url\":\"/file/backgrounds/host-background/bg_wallpaper.png\"")
	require.Contains(t, rec.Body.String(), "\"name\":\"backgrounds/host-background\"")
	require.Contains(t, rec.Body.String(), "\"filename\":\"wallpaper.png\"")
	require.NotContains(t, rec.Body.String(), "regular.png")
	require.NotContains(t, rec.Body.String(), "user.png")
	require.NotContains(t, rec.Body.String(), "note.txt")
	require.NotContains(t, rec.Body.String(), "private.png")
	require.NotContains(t, rec.Body.String(), "creator")
	require.NotContains(t, rec.Body.String(), "reference")
	require.NotContains(t, rec.Body.String(), "blob")

	bgReq := httptest.NewRequest(http.MethodGet, "/file/backgrounds/"+publicBackground.UID+"/"+publicBackground.Filename, nil)
	bgRec := httptest.NewRecorder()
	e.ServeHTTP(bgRec, bgReq)
	require.Equal(t, http.StatusOK, bgRec.Code)
	require.Equal(t, "image/png", bgRec.Header().Get("Content-Type"))
	require.Equal(t, "public, max-age=3600", bgRec.Header().Get("Cache-Control"))
	require.Equal(t, "nosniff", bgRec.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "png", bgRec.Body.String())

	attachmentReq := httptest.NewRequest(http.MethodGet, "/file/attachments/"+publicBackground.UID+"/"+publicBackground.Filename, nil)
	attachmentRec := httptest.NewRecorder()
	e.ServeHTTP(attachmentRec, attachmentReq)
	require.Equal(t, http.StatusForbidden, attachmentRec.Code)
	require.Equal(t, "private, no-store", attachmentRec.Header().Get("Cache-Control"))
	require.Equal(t, "Authorization, Cookie", attachmentRec.Header().Get("Vary"))
}

func TestPublicBackgroundFileRejectsNonPublicBackgrounds(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	host, err := testStore.CreateUser(ctx, &store.User{Username: "background-reject-host", Role: store.RoleHost, Email: "background-reject-host@example.com"})
	require.NoError(t, err)
	regularUser, err := testStore.CreateUser(ctx, &store.User{Username: "background-reject-user", Role: store.RoleUser, Email: "background-reject-user@example.com"})
	require.NoError(t, err)
	privateMemo, err := testStore.CreateMemo(ctx, &store.Memo{UID: "background-reject-memo", CreatorID: host.ID, Content: "private", Visibility: store.Private, RowStatus: store.Normal})
	require.NoError(t, err)

	attachments := []*store.Attachment{
		{UID: "reject-host-regular", CreatorID: host.ID, Filename: "regular.png", Type: "image/png", Size: 3, Blob: []byte("one")},
		{UID: "reject-user-bg", CreatorID: regularUser.ID, Filename: "bg_user.png", Type: "image/png", Size: 3, Blob: []byte("two")},
		{UID: "reject-host-text", CreatorID: host.ID, Filename: "bg_note.txt", Type: "text/plain", Size: 5, Blob: []byte("three")},
		{UID: "reject-host-svg", CreatorID: host.ID, Filename: "bg_bad.svg", Type: "image/svg+xml", Size: 4, Blob: []byte("four")},
		{UID: "reject-host-external", CreatorID: host.ID, Filename: "bg_external.png", Type: "image/png", Size: 0, StorageType: storepb.AttachmentStorageType_EXTERNAL, Reference: "https://example.com/a.png"},
		{UID: "reject-memo-bg", CreatorID: host.ID, Filename: "bg_private.png", Type: "image/png", Size: 3, Blob: []byte("six"), MemoID: &privateMemo.ID},
	}
	for _, attachment := range attachments {
		_, err = testStore.CreateAttachment(ctx, attachment)
		require.NoError(t, err)
	}

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, "file-secret")
	e := echo.New()
	e.GET("/file/backgrounds/:uid/:filename", service.servePublicBackgroundFile)

	for _, attachment := range attachments {
		req := httptest.NewRequest(http.MethodGet, "/file/backgrounds/"+attachment.UID+"/"+attachment.Filename, nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusNotFound, rec.Code, attachment.UID)
	}
}

func TestCheckAttachmentPermissionUsesMemoCreatorForPrivateMemo(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	owner, err := testStore.CreateUser(ctx, &store.User{Username: "memo-owner", Role: store.RoleUser, Email: "memo-owner@example.com"})
	require.NoError(t, err)
	attacker, err := testStore.CreateUser(ctx, &store.User{Username: "attachment-owner", Role: store.RoleUser, Email: "attachment-owner@example.com"})
	require.NoError(t, err)
	host, err := testStore.CreateUser(ctx, &store.User{Username: "host", Role: store.RoleHost, Email: "host@example.com"})
	require.NoError(t, err)

	memo, err := testStore.CreateMemo(ctx, &store.Memo{
		UID:        "private-memo",
		CreatorID:  owner.ID,
		Content:    "private memo",
		Visibility: store.Private,
		RowStatus:  store.Normal,
	})
	require.NoError(t, err)
	attachment, err := testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "private-attachment",
		CreatorID: attacker.ID,
		Filename:  "secret.txt",
		Type:      "text/plain",
		Size:      6,
		Blob:      []byte("secret"),
		MemoID:    &memo.ID,
	})
	require.NoError(t, err)

	secret := "file-secret"
	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, secret)

	ownerToken, _, err := auth.GenerateAccessTokenV2(owner.ID, owner.Username, owner.Role.String(), owner.RowStatus.String(), []byte(secret))
	require.NoError(t, err)
	attackerToken, _, err := auth.GenerateAccessTokenV2(attacker.ID, attacker.Username, attacker.Role.String(), attacker.RowStatus.String(), []byte(secret))
	require.NoError(t, err)
	hostToken, _, err := auth.GenerateAccessTokenV2(host.ID, host.Username, host.Role.String(), host.RowStatus.String(), []byte(secret))
	require.NoError(t, err)

	tests := []struct {
		name       string
		token      string
		wantStatus int
	}{
		{name: "memo owner can read", token: ownerToken, wantStatus: 0},
		{name: "attachment creator cannot read another users private memo", token: attackerToken, wantStatus: http.StatusForbidden},
		{name: "host can read", token: hostToken, wantStatus: 0},
		{name: "anonymous cannot read", wantStatus: http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/file/attachments/private-attachment/secret.txt", nil)
			if tt.token != "" {
				req.Header.Set("Authorization", "Bearer "+tt.token)
			}
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			err := service.checkAttachmentPermission(ctx, c, attachment)
			if tt.wantStatus == 0 {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			httpErr, ok := err.(*echo.HTTPError)
			require.True(t, ok)
			require.Equal(t, tt.wantStatus, httpErr.Code)
		})
	}
}

func TestGetUserByIdentifierHidesArchivedAvatarUser(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	user, err := testStore.CreateUser(ctx, &store.User{
		Username:  "archived-avatar-user",
		Role:      store.RoleUser,
		Email:     "archived-avatar-user@example.com",
		AvatarURL: "data:image/png;base64,iVBORw0KGgo=",
	})
	require.NoError(t, err)

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, "file-secret")

	byID, err := service.getUserByIdentifier(ctx, strconv.Itoa(int(user.ID)))
	require.NoError(t, err)
	require.NotNil(t, byID)
	byUsername, err := service.getUserByIdentifier(ctx, user.Username)
	require.NoError(t, err)
	require.NotNil(t, byUsername)

	archivedStatus := store.Archived
	_, err = testStore.UpdateUser(ctx, &store.UpdateUser{ID: user.ID, RowStatus: &archivedStatus})
	require.NoError(t, err)

	byID, err = service.getUserByIdentifier(ctx, strconv.Itoa(int(user.ID)))
	require.NoError(t, err)
	require.Nil(t, byID)
	byUsername, err = service.getUserByIdentifier(ctx, user.Username)
	require.NoError(t, err)
	require.Nil(t, byUsername)
}

func TestCheckAttachmentPermissionHidesArchivedPublicMemoAttachment(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	owner, err := testStore.CreateUser(ctx, &store.User{Username: "archived-public-owner", Role: store.RoleUser, Email: "archived-public-owner@example.com"})
	require.NoError(t, err)
	memo, err := testStore.CreateMemo(ctx, &store.Memo{
		UID:        "archived-public-memo",
		CreatorID:  owner.ID,
		Content:    "public memo from archived user",
		Visibility: store.Public,
		RowStatus:  store.Normal,
	})
	require.NoError(t, err)
	attachment, err := testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "archived-public-attachment",
		CreatorID: owner.ID,
		Filename:  "public.txt",
		Type:      "text/plain",
		Size:      6,
		Blob:      []byte("public"),
		MemoID:    &memo.ID,
	})
	require.NoError(t, err)

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, "file-secret")
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/file/attachments/archived-public-attachment/public.txt", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	require.NoError(t, service.checkAttachmentPermission(ctx, c, attachment))

	archivedStatus := store.Archived
	require.NoError(t, testStore.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &archivedStatus}))

	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	err = service.checkAttachmentPermission(ctx, c, attachment)
	require.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	require.True(t, ok)
	require.Equal(t, http.StatusNotFound, httpErr.Code)
}

func TestServeAttachmentFileRejectsFilenameMismatch(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	owner, err := testStore.CreateUser(ctx, &store.User{Username: "filename-owner", Role: store.RoleUser, Email: "filename-owner@example.com"})
	require.NoError(t, err)
	_, err = testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "filename-attachment",
		CreatorID: owner.ID,
		Filename:  "real.txt",
		Type:      "text/plain",
		Size:      4,
		Blob:      []byte("real"),
	})
	require.NoError(t, err)

	secret := "file-secret"
	ownerToken, _, err := auth.GenerateAccessTokenV2(owner.ID, owner.Username, owner.Role.String(), owner.RowStatus.String(), []byte(secret))
	require.NoError(t, err)
	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, secret)
	e := echo.New()
	e.GET("/file/attachments/:uid/:filename", service.serveAttachmentFile)

	req := httptest.NewRequest(http.MethodGet, "/file/attachments/filename-attachment/fake.txt", nil)
	req.Header.Set("Authorization", "Bearer "+ownerToken)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
	require.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
	require.Equal(t, "Authorization, Cookie", rec.Header().Get("Vary"))
}

func TestServeAttachmentFileDoesNotRevealPrivateFilenameToUnauthorizedUsers(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	owner, err := testStore.CreateUser(ctx, &store.User{Username: "oracle-owner", Role: store.RoleUser, Email: "oracle-owner@example.com"})
	require.NoError(t, err)
	attacker, err := testStore.CreateUser(ctx, &store.User{Username: "oracle-attacker", Role: store.RoleUser, Email: "oracle-attacker@example.com"})
	require.NoError(t, err)
	memo, err := testStore.CreateMemo(ctx, &store.Memo{
		UID:        "oracle-private-memo",
		CreatorID:  owner.ID,
		Content:    "private memo",
		Visibility: store.Private,
		RowStatus:  store.Normal,
	})
	require.NoError(t, err)
	_, err = testStore.CreateAttachment(ctx, &store.Attachment{
		UID:       "oracle-private-attachment",
		CreatorID: owner.ID,
		Filename:  "secret-real-name.txt",
		Type:      "text/plain",
		Size:      6,
		Blob:      []byte("secret"),
		MemoID:    &memo.ID,
	})
	require.NoError(t, err)

	secret := "file-secret"
	attackerToken, _, err := auth.GenerateAccessTokenV2(attacker.ID, attacker.Username, attacker.Role.String(), attacker.RowStatus.String(), []byte(secret))
	require.NoError(t, err)
	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, secret)
	e := echo.New()
	e.GET("/file/attachments/:uid/:filename", service.serveAttachmentFile)

	requests := []string{
		"/file/attachments/oracle-private-attachment/secret-real-name.txt",
		"/file/attachments/oracle-private-attachment/wrong-name.txt",
	}
	for _, path := range requests {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+attackerToken)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusForbidden, rec.Code)
		require.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
		require.Equal(t, "Authorization, Cookie", rec.Header().Get("Vary"))
	}
}

func TestServeAttachmentFileCacheHeadersByVisibility(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	owner, err := testStore.CreateUser(ctx, &store.User{Username: "cache-owner", Role: store.RoleUser, Email: "cache-owner@example.com"})
	require.NoError(t, err)
	secret := "file-secret"
	ownerToken, _, err := auth.GenerateAccessTokenV2(owner.ID, owner.Username, owner.Role.String(), owner.RowStatus.String(), []byte(secret))
	require.NoError(t, err)

	publicMemo, err := testStore.CreateMemo(ctx, &store.Memo{UID: "public-cache-memo", CreatorID: owner.ID, Content: "public", Visibility: store.Public, RowStatus: store.Normal})
	require.NoError(t, err)
	privateMemo, err := testStore.CreateMemo(ctx, &store.Memo{UID: "private-cache-memo", CreatorID: owner.ID, Content: "private", Visibility: store.Private, RowStatus: store.Normal})
	require.NoError(t, err)

	publicAttachment, err := testStore.CreateAttachment(ctx, &store.Attachment{UID: "public-cache-attachment", CreatorID: owner.ID, Filename: "public.txt", Type: "text/plain", Size: 6, Blob: []byte("public"), MemoID: &publicMemo.ID})
	require.NoError(t, err)
	privateAttachment, err := testStore.CreateAttachment(ctx, &store.Attachment{UID: "private-cache-attachment", CreatorID: owner.ID, Filename: "private.txt", Type: "text/plain", Size: 7, Blob: []byte("private"), MemoID: &privateMemo.ID})
	require.NoError(t, err)

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, secret)
	e := echo.New()
	e.GET("/file/attachments/:uid/:filename", service.serveAttachmentFile)

	tests := []struct {
		attachment   *store.Attachment
		token        string
		wantCache    string
		wantResponse string
	}{
		{attachment: publicAttachment, wantCache: "private, no-store", wantResponse: "public"},
		{attachment: privateAttachment, token: ownerToken, wantCache: "private, no-store", wantResponse: "private"},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, "/file/attachments/"+tt.attachment.UID+"/"+tt.attachment.Filename, nil)
		if tt.token != "" {
			req.Header.Set("Authorization", "Bearer "+tt.token)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, tt.wantCache, rec.Header().Get("Cache-Control"))
		require.Equal(t, "Authorization, Cookie", rec.Header().Get("Vary"))
		require.Equal(t, tt.wantResponse, rec.Body.String())
	}
}

func TestServeAttachmentFileLocalStorageSupportsRangeRequests(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	dataDir := t.TempDir()
	attachmentPath := filepath.Join(dataDir, "assets", "local-range.txt")
	require.NoError(t, os.MkdirAll(filepath.Dir(attachmentPath), 0750))
	require.NoError(t, os.WriteFile(attachmentPath, []byte("0123456789"), 0600))

	owner, err := testStore.CreateUser(ctx, &store.User{Username: "local-range-owner", Role: store.RoleUser, Email: "local-range-owner@example.com"})
	require.NoError(t, err)
	memo, err := testStore.CreateMemo(ctx, &store.Memo{UID: "local-range-memo", CreatorID: owner.ID, Content: "public local", Visibility: store.Public, RowStatus: store.Normal})
	require.NoError(t, err)
	attachment, err := testStore.CreateAttachment(ctx, &store.Attachment{
		UID:         "local-range-attachment",
		CreatorID:   owner.ID,
		Filename:    "local-range.txt",
		Type:        "text/plain",
		Size:        10,
		StorageType: storepb.AttachmentStorageType_LOCAL,
		Reference:   filepath.Join("assets", "local-range.txt"),
		MemoID:      &memo.ID,
	})
	require.NoError(t, err)

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: dataDir}, testStore, "file-secret")
	e := echo.New()
	e.GET("/file/attachments/:uid/:filename", service.serveAttachmentFile)

	req := httptest.NewRequest(http.MethodGet, "/file/attachments/"+attachment.UID+"/"+attachment.Filename, nil)
	req.Header.Set("Range", "bytes=2-5")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusPartialContent, rec.Code)
	require.Equal(t, "bytes 2-5/10", rec.Header().Get("Content-Range"))
	require.Equal(t, "2345", rec.Body.String())
}

func TestGetAttachmentBlobRejectsDatabaseBlobAboveUploadLimit(t *testing.T) {
	ctx := context.Background()
	testStore := teststore.NewTestingStore(ctx, t)
	defer testStore.Close()

	_, err := testStore.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{UploadSizeLimitMb: 1},
		},
	})
	require.NoError(t, err)

	service := NewFileServerService(&profile.Profile{Mode: "dev", Data: t.TempDir()}, testStore, "file-secret")
	_, err = service.getAttachmentBlob(ctx, &store.Attachment{
		UID:         "large-db-attachment",
		Filename:    "large.bin",
		Type:        "application/octet-stream",
		StorageType: storepb.AttachmentStorageType_ATTACHMENT_STORAGE_TYPE_UNSPECIFIED,
		Blob:        make([]byte, 1<<20+1),
	})
	require.ErrorContains(t, err, "download size limit")
}

func TestSafeThumbnailFileKeyRejectsUnsafeUID(t *testing.T) {
	_, err := safeThumbnailFileKey("../escape", "photo.png")
	require.Error(t, err)

	key, err := safeThumbnailFileKey("safe-thumb", "archive.tar.gz")
	require.NoError(t, err)
	require.Equal(t, "safe-thumb.thumb", key)
}
