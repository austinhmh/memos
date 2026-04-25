package test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestCreateAttachment(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "test_user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	// Test case 1: Create attachment with empty type but known extension
	t.Run("EmptyType_KnownExtension", func(t *testing.T) {
		attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
			Attachment: &v1pb.Attachment{
				Filename: "test.png",
				Content:  []byte("fake png content"),
			},
		})
		require.NoError(t, err)
		require.Equal(t, "image/png", attachment.Type)
	})

	// Test case 2: Create attachment with empty type and unknown extension, but detectable content
	t.Run("EmptyType_UnknownExtension_ContentSniffing", func(t *testing.T) {
		// PNG magic header: 89 50 4E 47 0D 0A 1A 0A
		pngContent := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
		attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
			Attachment: &v1pb.Attachment{
				Filename: "test.unknown",
				Content:  pngContent,
			},
		})
		require.NoError(t, err)
		require.Equal(t, "image/png", attachment.Type)
	})

	// Test case 3: Empty type, unknown extension, random content -> fallback to application/octet-stream
	t.Run("EmptyType_Fallback", func(t *testing.T) {
		randomContent := []byte{0x00, 0x01, 0x02, 0x03}
		attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
			Attachment: &v1pb.Attachment{
				Filename: "test.data",
				Content:  randomContent,
			},
		})
		require.NoError(t, err)
		require.Equal(t, "application/octet-stream", attachment.Type)
	})
}

func TestCreateAttachmentCannotAttachToOtherUsersMemo(t *testing.T) {
	ctx := context.Background()

	for _, visibility := range []v1pb.Visibility{v1pb.Visibility_PUBLIC, v1pb.Visibility_PROTECTED, v1pb.Visibility_PRIVATE} {
		t.Run(visibility.String(), func(t *testing.T) {
			ts := NewTestService(t)
			defer ts.Cleanup()

			owner, err := ts.CreateRegularUser(ctx, "owner-"+visibility.String())
			require.NoError(t, err)
			ownerCtx := ts.CreateUserContext(ctx, owner.ID)
			attacker, err := ts.CreateRegularUser(ctx, "attacker-"+visibility.String())
			require.NoError(t, err)
			attackerCtx := ts.CreateUserContext(ctx, attacker.ID)

			memo, err := ts.Service.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{
				Memo: &v1pb.Memo{
					Content:    "owner memo",
					Visibility: visibility,
				},
			})
			require.NoError(t, err)

			_, err = ts.Service.CreateAttachment(attackerCtx, &v1pb.CreateAttachmentRequest{
				Attachment: &v1pb.Attachment{
					Filename: "injected.txt",
					Type:     "text/plain",
					Content:  []byte("injected"),
					Memo:     &memo.Name,
				},
			})
			require.Error(t, err)
			require.Equal(t, codes.PermissionDenied, status.Code(err))
		})
	}
}

func TestCreateAttachmentRejectsUnauthorizedMemoBeforeLocalWrite(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	dataDir := t.TempDir()
	ts.Profile.Data = dataDir
	_, err := ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{
			StorageSetting: &storepb.InstanceStorageSetting{
				StorageType:      storepb.InstanceStorageSetting_LOCAL,
				FilepathTemplate: "assets/{filename}",
			},
		},
	})
	require.NoError(t, err)

	owner, err := ts.CreateRegularUser(ctx, "owner-local-orphan")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	attacker, err := ts.CreateRegularUser(ctx, "attacker-local-orphan")
	require.NoError(t, err)
	attackerCtx := ts.CreateUserContext(ctx, attacker.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{
			Content:    "owner memo",
			Visibility: v1pb.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateAttachment(attackerCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Filename: "orphan.txt",
			Type:     "text/plain",
			Content:  []byte("orphan"),
			Memo:     &memo.Name,
		},
	})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, statErr := os.Stat(filepath.Join(dataDir, "assets", "orphan.txt"))
	require.True(t, os.IsNotExist(statErr), "unauthorized memo binding must not leave local orphan files")
}

func TestCreateAttachmentHostCanAttachToOtherUsersMemo(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "owner-host-attach")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	host, err := ts.CreateHostUser(ctx, "host-attach")
	require.NoError(t, err)
	hostCtx := ts.CreateUserContext(ctx, host.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{
			Content:    "owner memo",
			Visibility: v1pb.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	attachment, err := ts.Service.CreateAttachment(hostCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Filename: "host.txt",
			Type:     "text/plain",
			Content:  []byte("host"),
			Memo:     &memo.Name,
		},
	})
	require.NoError(t, err)
	attachmentUID := stringFromAttachmentName(t, attachment.Name)
	storedAttachment, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	require.NoError(t, err)
	require.NotNil(t, storedAttachment.MemoID)
	require.Equal(t, memo.Name, attachmentMemoName(t, ts, *storedAttachment.MemoID))
}

func TestDeleteAttachmentBoundToMemoRequiresMemoPermission(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "bound-delete-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	attachmentCreator, err := ts.CreateRegularUser(ctx, "bound-delete-creator")
	require.NoError(t, err)
	attachmentCreatorCtx := ts.CreateUserContext(ctx, attachmentCreator.ID)
	host, err := ts.CreateHostUser(ctx, "bound-delete-host")
	require.NoError(t, err)
	hostCtx := ts.CreateUserContext(ctx, host.ID)

	memo, err := ts.Service.CreateMemo(memoOwnerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{
			Content:    "owner private memo",
			Visibility: v1pb.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	attachment, err := ts.Service.CreateAttachment(attachmentCreatorCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Filename: "creator-owned.txt",
			Type:     "text/plain",
			Content:  []byte("creator-owned"),
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.SetMemoAttachments(hostCtx, &v1pb.SetMemoAttachmentsRequest{
		Name:        memo.Name,
		Attachments: []*v1pb.Attachment{{Name: attachment.Name}},
	})
	require.NoError(t, err)

	_, err = ts.Service.DeleteAttachment(attachmentCreatorCtx, &v1pb.DeleteAttachmentRequest{Name: attachment.Name})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.DeleteAttachment(memoOwnerCtx, &v1pb.DeleteAttachmentRequest{Name: attachment.Name})
	require.NoError(t, err)
}

func TestBoundAttachmentDirectAPIsRequireBoundMemoVisibility(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "bound-direct-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	attachmentCreator, err := ts.CreateRegularUser(ctx, "bound-direct-creator")
	require.NoError(t, err)
	attachmentCreatorCtx := ts.CreateUserContext(ctx, attachmentCreator.ID)

	memo, err := ts.Service.CreateMemo(memoOwnerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "private owner memo", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	memoUID := memo.Name[len("memos/"):]
	storedMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.NotNil(t, storedMemo)

	attachmentUID := "external-bound-private"
	_, err = ts.Store.CreateAttachment(ctx, &store.Attachment{
		UID:         attachmentUID,
		CreatorID:   attachmentCreator.ID,
		Filename:    "external.txt",
		Type:        "text/plain",
		Size:        12,
		StorageType: storepb.AttachmentStorageType_EXTERNAL,
		Reference:   "https://example.com/private/external.txt",
		MemoID:      &storedMemo.ID,
	})
	require.NoError(t, err)
	attachmentName := "attachments/" + attachmentUID

	_, err = ts.Service.GetAttachment(attachmentCreatorCtx, &v1pb.GetAttachmentRequest{Name: attachmentName})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	listResp, err := ts.Service.ListAttachments(attachmentCreatorCtx, &v1pb.ListAttachmentsRequest{})
	require.NoError(t, err)
	for _, attachment := range listResp.Attachments {
		require.NotEqual(t, attachmentName, attachment.Name)
		require.NotEqual(t, "https://example.com/private/external.txt", attachment.ExternalLink)
	}

	ownerAttachment, err := ts.Service.GetAttachment(memoOwnerCtx, &v1pb.GetAttachmentRequest{Name: attachmentName})
	require.NoError(t, err)
	require.Equal(t, "https://example.com/private/external.txt", ownerAttachment.ExternalLink)
}

func TestUpdateBoundAttachmentRequiresBoundMemoPermission(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "bound-update-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	attachmentCreator, err := ts.CreateRegularUser(ctx, "bound-update-creator")
	require.NoError(t, err)
	attachmentCreatorCtx := ts.CreateUserContext(ctx, attachmentCreator.ID)
	host, err := ts.CreateHostUser(ctx, "bound-update-host")
	require.NoError(t, err)
	hostCtx := ts.CreateUserContext(ctx, host.ID)

	memo, err := ts.Service.CreateMemo(memoOwnerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "owner memo", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	attachment, err := ts.Service.CreateAttachment(attachmentCreatorCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "old.txt", Type: "text/plain", Content: []byte("old")},
	})
	require.NoError(t, err)
	_, err = ts.Service.SetMemoAttachments(hostCtx, &v1pb.SetMemoAttachmentsRequest{
		Name:        memo.Name,
		Attachments: []*v1pb.Attachment{{Name: attachment.Name}},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpdateAttachment(attachmentCreatorCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: attachment.Name, Filename: "creator.txt"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
	})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	updated, err := ts.Service.UpdateAttachment(memoOwnerCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: attachment.Name, Filename: "owner.txt"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
	})
	require.NoError(t, err)
	require.Equal(t, "owner.txt", updated.Filename)
}

func TestSetMemoAttachmentsCannotMoveAttachmentFromUnauthorizedBoundMemo(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "bound-move-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	attachmentCreator, err := ts.CreateRegularUser(ctx, "bound-move-creator")
	require.NoError(t, err)
	attachmentCreatorCtx := ts.CreateUserContext(ctx, attachmentCreator.ID)
	host, err := ts.CreateHostUser(ctx, "bound-move-host")
	require.NoError(t, err)
	hostCtx := ts.CreateUserContext(ctx, host.ID)

	ownerMemo, err := ts.Service.CreateMemo(memoOwnerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "owner memo", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	creatorMemo, err := ts.Service.CreateMemo(attachmentCreatorCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "creator memo", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	attachment, err := ts.Service.CreateAttachment(attachmentCreatorCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "move.txt", Type: "text/plain", Content: []byte("move")},
	})
	require.NoError(t, err)

	_, err = ts.Service.SetMemoAttachments(hostCtx, &v1pb.SetMemoAttachmentsRequest{
		Name:        ownerMemo.Name,
		Attachments: []*v1pb.Attachment{{Name: attachment.Name}},
	})
	require.NoError(t, err)
	_, err = ts.Service.SetMemoAttachments(attachmentCreatorCtx, &v1pb.SetMemoAttachmentsRequest{
		Name:        creatorMemo.Name,
		Attachments: []*v1pb.Attachment{{Name: attachment.Name}},
	})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	attachmentUID := stringFromAttachmentName(t, attachment.Name)
	storedAttachment, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	require.NoError(t, err)
	require.NotNil(t, storedAttachment.MemoID)
	require.Equal(t, ownerMemo.Name, attachmentMemoName(t, ts, *storedAttachment.MemoID))
}

func stringFromAttachmentName(t *testing.T, name string) string {
	t.Helper()
	const prefix = "attachments/"
	require.Contains(t, name, prefix)
	return name[len(prefix):]
}

func attachmentMemoName(t *testing.T, ts *TestService, memoID int32) string {
	t.Helper()
	memo, err := ts.Store.GetMemo(context.Background(), &store.FindMemo{ID: &memoID})
	require.NoError(t, err)
	require.NotNil(t, memo)
	return "memos/" + memo.UID
}
