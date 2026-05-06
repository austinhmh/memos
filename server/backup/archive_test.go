package backup

import (
	"bytes"
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestWriteReadTarGzRoundTripProtobufOneofs(t *testing.T) {
	ctx := context.Background()
	memoID := int32(7)
	memoUID := "memo-one"
	data := &store.BackupData{
		UserSettings: []*storepb.UserSetting{
			{
				UserId: 1,
				Key:    storepb.UserSetting_GENERAL,
				Value: &storepb.UserSetting_General{General: &storepb.GeneralUserSetting{
					Locale:         "en",
					MemoVisibility: "PRIVATE",
					Theme:          "default",
				}},
			},
			{
				UserId: 1,
				Key:    storepb.UserSetting_PERSONAL_ACCESS_TOKENS,
				Value: &storepb.UserSetting_PersonalAccessTokens{PersonalAccessTokens: &storepb.PersonalAccessTokensUserSetting{
					Tokens: []*storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{
						{TokenId: "token-one", TokenHash: "hash-one", Description: "backup token"},
					},
				}},
			},
		},
		IdentityProviders: []*storepb.IdentityProvider{
			{
				Name:             "idp-one",
				Type:             storepb.IdentityProvider_OAUTH2,
				IdentifierFilter: "@example.com",
				Config: &storepb.IdentityProviderConfig{Config: &storepb.IdentityProviderConfig_Oauth2Config{Oauth2Config: &storepb.OAuth2Config{
					ClientId:     "client-id",
					ClientSecret: "client-secret",
					AuthUrl:      "https://example.com/auth",
					TokenUrl:     "https://example.com/token",
					UserInfoUrl:  "https://example.com/userinfo",
				}}},
			},
		},
		Attachments: []*store.Attachment{
			{
				ID:          9,
				UID:         "attachment-one",
				CreatorID:   1,
				CreatedTs:   11,
				UpdatedTs:   12,
				Filename:    "photo.png",
				Type:        "image/png",
				Size:        3,
				StorageType: storepb.AttachmentStorageType_S3,
				Reference:   "assets/photo.png",
				Payload: &storepb.AttachmentPayload{Payload: &storepb.AttachmentPayload_S3Object_{S3Object: &storepb.AttachmentPayload_S3Object{
					Key:               "assets/photo.png",
					LastPresignedTime: timestamppb.New(time.Unix(123, 0)),
				}}},
				MemoID:  &memoID,
				MemoUID: &memoUID,
			},
		},
	}
	manifest := NewManifest(&profile.Profile{Driver: "sqlite", Version: "0.26.3"}, data, time.Unix(1, 0))
	buffer := &bytes.Buffer{}
	if err := WriteTarGz(ctx, buffer, manifest, data, []AttachmentBlob{{UID: "attachment-one", Reader: bytes.NewReader([]byte("abc"))}}); err != nil {
		t.Fatalf("WriteTarGz() error = %v", err)
	}

	archive, err := ReadTarGz(ctx, bytes.NewReader(buffer.Bytes()))
	if err != nil {
		t.Fatalf("ReadTarGz() error = %v", err)
	}
	if got := len(archive.Data.UserSettings); got != len(data.UserSettings) {
		t.Fatalf("len(UserSettings) = %d, want %d", got, len(data.UserSettings))
	}
	for i, want := range data.UserSettings {
		if got := archive.Data.UserSettings[i]; !proto.Equal(got, want) {
			t.Fatalf("UserSettings[%d] = %v, want %v", i, got, want)
		}
	}
	if got := archive.Data.IdentityProviders[0]; !proto.Equal(got, data.IdentityProviders[0]) {
		t.Fatalf("IdentityProvider = %v, want %v", got, data.IdentityProviders[0])
	}
	if got := archive.Data.Attachments[0].Payload; !proto.Equal(got, data.Attachments[0].Payload) {
		t.Fatalf("Attachment payload = %v, want %v", got, data.Attachments[0].Payload)
	}
	if string(archive.Blobs["attachment-one"]) != "abc" {
		t.Fatalf("attachment blob = %q, want abc", string(archive.Blobs["attachment-one"]))
	}
}
