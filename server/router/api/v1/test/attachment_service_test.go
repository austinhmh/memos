package test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
				Content:  []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
			},
		})
		require.NoError(t, err)
		require.Equal(t, "image/png", attachment.Type)
	})

	// Test case 2: Empty type, unknown extension, random content -> fallback to application/octet-stream
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

func TestCreateAttachmentUsesServerDetectedMimeType(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "mime-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	pngContent := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Filename: "test.unknown",
			Type:     "application/octet-stream",
			Content:  pngContent,
		},
	})
	require.NoError(t, err)
	require.Equal(t, "image/png", attachment.Type)

	_, err = ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Filename: "html.txt",
			Type:     "text/plain",
			Content:  []byte("<html><script>alert(1)</script></html>"),
		},
	})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

func TestCreateAttachmentRejectsShortCustomIDForRegularUser(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "short-id-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		AttachmentId: "abc",
		Attachment:   &v1pb.Attachment{Filename: "safe.txt", Type: "text/plain", Content: []byte("content")},
	})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))
	require.True(t, strings.Contains(err.Error(), "custom attachment_id"))
}

func TestAttachmentRejectsUnsafeFilenames(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "unsafe-filename-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	longFilename := ""
	for range 256 {
		longFilename += "a"
	}

	unsafeFilenames := []string{
		"bad\x00name.png",
		"bad\nname.png",
		"bad\rname.png",
		"bad\tname.png",
		"bad\x7fname.png",
		string([]byte{0xff, 'a', '.', 'p', 'n', 'g'}),
		"../evil.png",
		"back\\slash.png",
		longFilename,
	}

	for _, filename := range unsafeFilenames {
		t.Run("Create/"+filename, func(t *testing.T) {
			_, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
				Attachment: &v1pb.Attachment{Filename: filename, Type: "image/png", Content: []byte("content")},
			})
			require.Error(t, err)
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}

	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "safe.png", Type: "image/png", Content: []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}},
	})
	require.NoError(t, err)

	for _, filename := range unsafeFilenames {
		t.Run("Update/"+filename, func(t *testing.T) {
			_, err := ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{
				Attachment: &v1pb.Attachment{Name: attachment.Name, Filename: filename},
				UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
			})
			require.Error(t, err)
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}
}

func TestUpdateAttachmentRejectsNilAndUnknownUpdateMask(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()

	user, err := ts.CreateRegularUser(ctx, "attachment-mask-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{Filename: "mask-safe.txt", Type: "text/plain", Content: []byte("content")},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	for _, updateMask := range []*fieldmaskpb.FieldMask{nil, {Paths: []string{}}} {
		_, err = ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{
			Attachment: &v1pb.Attachment{Name: attachment.Name, Filename: "renamed.txt"},
			UpdateMask: updateMask,
		})
		require.Error(t, err)
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	}

	_, err = ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: attachment.Name, Filename: "renamed.txt"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"unsupported"}},
	})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	updated, err := ts.Service.UpdateAttachment(userCtx, &v1pb.UpdateAttachmentRequest{
		Attachment: &v1pb.Attachment{Name: attachment.Name, Filename: "renamed.txt"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
	})
	require.NoError(t, err)
	require.Equal(t, "renamed.txt", updated.Filename)
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

func TestDeleteAttachmentRejectsMemoContentReference(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "referenced-delete-owner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "memo with image placeholder", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)

	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Memo:     &memo.Name,
			Filename: "referenced.png",
			Content:  []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
		},
	})
	require.NoError(t, err)

	attachmentUID := strings.TrimPrefix(attachment.Name, "attachments/")
	content := fmt.Sprintf("memo with image ![referenced](/file/attachments/%s/referenced.png)", attachmentUID)
	_, err = ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Content: content},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)

	_, err = ts.Service.DeleteAttachment(userCtx, &v1pb.DeleteAttachmentRequest{Name: attachment.Name})
	require.Error(t, err)
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestUpdateMemoCanRemoveReferencedAttachmentSafely(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "safe-remove-owner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "memo with image placeholder", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)

	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Memo:     &memo.Name,
			Filename: "safe-remove.png",
			Content:  []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
		},
	})
	require.NoError(t, err)

	attachmentUID := strings.TrimPrefix(attachment.Name, "attachments/")
	content := fmt.Sprintf("memo with image ![safe](/file/attachments/%s/safe-remove.png)", attachmentUID)
	updatedMemo, err := ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Content: content, Attachments: []*v1pb.Attachment{{Name: attachment.Name}}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "attachments"}},
	})
	require.NoError(t, err)
	require.Len(t, updatedMemo.Attachments, 1)

	updatedMemo, err = ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Content: "memo without image", Attachments: []*v1pb.Attachment{}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "attachments"}},
	})
	require.NoError(t, err)
	require.Empty(t, updatedMemo.Attachments)

	storedAttachment, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	require.NoError(t, err)
	require.Nil(t, storedAttachment)
}

func TestUpdateMemoRejectsRemovingAttachmentStillReferencedByContent(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "unsafe-remove-owner")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Service.CreateMemo(userCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "memo with image placeholder", Visibility: v1pb.Visibility_PRIVATE},
	})
	require.NoError(t, err)

	attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Memo:     &memo.Name,
			Filename: "unsafe-remove.png",
			Content:  []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A},
		},
	})
	require.NoError(t, err)

	attachmentUID := strings.TrimPrefix(attachment.Name, "attachments/")
	content := fmt.Sprintf("memo with image ![unsafe](/file/attachments/%s/unsafe-remove.png)", attachmentUID)
	_, err = ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Content: content, Attachments: []*v1pb.Attachment{{Name: attachment.Name}}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "attachments"}},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpdateMemo(userCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Attachments: []*v1pb.Attachment{}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"attachments"}},
	})
	require.Error(t, err)
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
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
