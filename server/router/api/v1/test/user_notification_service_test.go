package test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestUserNotificationRequiresNameParentToMatchOwner(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "notification-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	other, err := ts.CreateRegularUser(ctx, "notification-other")
	require.NoError(t, err)

	messageType := storepb.InboxMessage_MEMO_COMMENT
	inbox, err := ts.Store.CreateInbox(ctx, &store.Inbox{
		SenderID:   other.ID,
		ReceiverID: owner.ID,
		Status:     store.UNREAD,
		Message:    &storepb.InboxMessage{Type: messageType},
	})
	require.NoError(t, err)

	spoofedName := fmt.Sprintf("users/%d/notifications/%d", other.ID, inbox.ID)
	_, err = ts.Service.UpdateUserNotification(ownerCtx, &apiv1.UpdateUserNotificationRequest{
		Notification: &apiv1.UserNotification{
			Name:   spoofedName,
			Status: apiv1.UserNotification_ARCHIVED,
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.DeleteUserNotification(ownerCtx, &apiv1.DeleteUserNotificationRequest{Name: spoofedName})
	require.Error(t, err)
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	inboxes, err := ts.Store.ListInboxes(ctx, &store.FindInbox{ID: &inbox.ID})
	require.NoError(t, err)
	require.Len(t, inboxes, 1)
	require.Equal(t, store.UNREAD, inboxes[0].Status)
}

func TestUpdateUserNotificationRequiresUpdateMask(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "notification-mask-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	sender, err := ts.CreateRegularUser(ctx, "notification-mask-sender")
	require.NoError(t, err)

	inbox, err := ts.Store.CreateInbox(ctx, &store.Inbox{
		SenderID:   sender.ID,
		ReceiverID: owner.ID,
		Status:     store.UNREAD,
		Message:    &storepb.InboxMessage{Type: storepb.InboxMessage_MEMO_COMMENT},
	})
	require.NoError(t, err)
	name := fmt.Sprintf("users/%d/notifications/%d", owner.ID, inbox.ID)

	for _, updateMask := range []*fieldmaskpb.FieldMask{nil, {Paths: []string{}}} {
		_, err = ts.Service.UpdateUserNotification(ownerCtx, &apiv1.UpdateUserNotificationRequest{
			Notification: &apiv1.UserNotification{
				Name:   name,
				Status: apiv1.UserNotification_ARCHIVED,
			},
			UpdateMask: updateMask,
		})
		require.Error(t, err)
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	}

	updated, err := ts.Service.UpdateUserNotification(ownerCtx, &apiv1.UpdateUserNotificationRequest{
		Notification: &apiv1.UserNotification{Name: name, Status: apiv1.UserNotification_ARCHIVED},
		UpdateMask:   &fieldmaskpb.FieldMask{Paths: []string{"status"}},
	})
	require.NoError(t, err)
	require.Equal(t, apiv1.UserNotification_ARCHIVED, updated.Status)
}

func TestUserPrivateResourceUpdatesRejectNilAndUnknownUpdateMasks(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "private-resource-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	_, err = ts.Service.UpdateUserSetting(ownerCtx, &apiv1.UpdateUserSettingRequest{})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	settingName := fmt.Sprintf("users/%d/settings/GENERAL", owner.ID)
	_, err = ts.Service.UpdateUserSetting(ownerCtx, &apiv1.UpdateUserSettingRequest{
		Setting: &apiv1.UserSetting{
			Name: settingName,
			Value: &apiv1.UserSetting_GeneralSetting_{
				GeneralSetting: &apiv1.UserSetting_GeneralSetting{Locale: "en"},
			},
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"unsupported"}},
	})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	webhook, err := ts.Service.CreateUserWebhook(ownerCtx, &apiv1.CreateUserWebhookRequest{
		Parent: fmt.Sprintf("users/%d", owner.ID),
		Webhook: &apiv1.UserWebhook{
			Url:         "https://example.com/hook",
			DisplayName: "hook",
		},
	})
	require.NoError(t, err)

	for _, updateMask := range []*fieldmaskpb.FieldMask{nil, {Paths: []string{}}} {
		_, err = ts.Service.UpdateUserWebhook(ownerCtx, &apiv1.UpdateUserWebhookRequest{
			Webhook: &apiv1.UserWebhook{
				Name:        webhook.Name,
				Url:         "https://example.com/updated",
				DisplayName: "updated",
			},
			UpdateMask: updateMask,
		})
		require.Error(t, err)
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	}

	_, err = ts.Service.UpdateUserWebhook(ownerCtx, &apiv1.UpdateUserWebhookRequest{
		Webhook:    &apiv1.UserWebhook{Name: webhook.Name, Url: "https://example.com/updated"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"unsupported"}},
	})
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	updated, err := ts.Service.UpdateUserWebhook(ownerCtx, &apiv1.UpdateUserWebhookRequest{
		Webhook:    &apiv1.UserWebhook{Name: webhook.Name, Url: "https://example.com/updated", DisplayName: "updated"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"url", "display_name"}},
	})
	require.NoError(t, err)
	require.Equal(t, "https://example.com/updated", updated.Url)
	require.Equal(t, "updated", updated.DisplayName)
}
