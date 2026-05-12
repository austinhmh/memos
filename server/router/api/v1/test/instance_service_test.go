package test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestGetInstanceProfile(t *testing.T) {
	ctx := context.Background()

	t.Run("GetInstanceProfile returns instance profile", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Call GetInstanceProfile directly
		req := &v1pb.GetInstanceProfileRequest{}
		resp, err := ts.Service.GetInstanceProfile(ctx, req)

		// Verify response
		require.NoError(t, err)
		require.NotNil(t, resp)

		// Verify the response contains expected data
		require.Equal(t, "test-1.0.0", resp.Version)
		require.Equal(t, "dev", resp.Mode)
		require.Equal(t, "http://localhost:8080", resp.InstanceUrl)

		// Owner should be empty since no users are created
		require.Empty(t, resp.Owner)
	})

	t.Run("GetInstanceProfile with owner", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create a host user in the store
		hostUser, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)
		require.NotNil(t, hostUser)

		// Call GetInstanceProfile directly
		req := &v1pb.GetInstanceProfileRequest{}
		resp, err := ts.Service.GetInstanceProfile(ctx, req)

		// Verify response
		require.NoError(t, err)
		require.NotNil(t, resp)

		// Verify the response contains expected data including owner
		require.Equal(t, "test-1.0.0", resp.Version)
		require.Equal(t, "dev", resp.Mode)
		require.Equal(t, "http://localhost:8080", resp.InstanceUrl)

		// User name should be "users/{id}" format where id is the user's ID
		expectedOwnerName := fmt.Sprintf("users/%d", hostUser.ID)
		require.Equal(t, expectedOwnerName, resp.Owner)
		resp, err = ts.Service.GetInstanceProfile(ctx, &v1pb.GetInstanceProfileRequest{})
		require.NoError(t, err)

		archivedStatus := store.Archived
		_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: hostUser.ID, RowStatus: &archivedStatus})
		require.NoError(t, err)

		resp, err = ts.Service.GetInstanceProfile(ctx, &v1pb.GetInstanceProfileRequest{})
		require.NoError(t, err)
		require.Empty(t, resp.Owner)
	})
}

func TestGetInstanceProfile_Concurrency(t *testing.T) {
	ctx := context.Background()

	t.Run("Concurrent access to service", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create a host user
		hostUser, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)
		expectedOwnerName := fmt.Sprintf("users/%d", hostUser.ID)

		// Make concurrent requests
		numGoroutines := 10
		results := make(chan *v1pb.InstanceProfile, numGoroutines)
		errors := make(chan error, numGoroutines)

		for i := 0; i < numGoroutines; i++ {
			go func() {
				req := &v1pb.GetInstanceProfileRequest{}
				resp, err := ts.Service.GetInstanceProfile(ctx, req)
				if err != nil {
					errors <- err
					return
				}
				results <- resp
			}()
		}

		// Collect all results
		for i := 0; i < numGoroutines; i++ {
			select {
			case err := <-errors:
				t.Fatalf("Goroutine returned error: %v", err)
			case resp := <-results:
				require.NotNil(t, resp)
				require.Equal(t, "test-1.0.0", resp.Version)
				require.Equal(t, "dev", resp.Mode)
				require.Equal(t, "http://localhost:8080", resp.InstanceUrl)
				require.Equal(t, expectedOwnerName, resp.Owner)
			}
		}
	})
}

func TestGetInstanceSetting(t *testing.T) {
	ctx := context.Background()

	t.Run("GetInstanceSetting - general setting", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Call GetInstanceSetting for general setting
		req := &v1pb.GetInstanceSettingRequest{
			Name: "instance/settings/GENERAL",
		}
		resp, err := ts.Service.GetInstanceSetting(ctx, req)

		// Verify response
		require.NoError(t, err)
		require.NotNil(t, resp)
		require.Equal(t, "instance/settings/GENERAL", resp.Name)

		// The general setting should have a general_setting field
		generalSetting := resp.GetGeneralSetting()
		require.NotNil(t, generalSetting)

		// General setting should have default values
		require.False(t, generalSetting.DisallowUserRegistration)
		require.False(t, generalSetting.DisallowPasswordAuth)
		require.Empty(t, generalSetting.AdditionalScript)
	})

	t.Run("GetInstanceSetting - storage setting", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create a host user for storage setting access
		hostUser, err := ts.CreateHostUser(ctx, "testhost")
		require.NoError(t, err)

		// Add user to context
		userCtx := ts.CreateUserContext(ctx, hostUser.ID)

		// Call GetInstanceSetting for storage setting
		req := &v1pb.GetInstanceSettingRequest{
			Name: "instance/settings/STORAGE",
		}
		resp, err := ts.Service.GetInstanceSetting(userCtx, req)

		// Verify response
		require.NoError(t, err)
		require.NotNil(t, resp)
		require.Equal(t, "instance/settings/STORAGE", resp.Name)

		// The storage setting should have a storage_setting field
		storageSetting := resp.GetStorageSetting()
		require.NotNil(t, storageSetting)
	})

	t.Run("GetInstanceSetting - memo related setting", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Call GetInstanceSetting for memo related setting
		req := &v1pb.GetInstanceSettingRequest{
			Name: "instance/settings/MEMO_RELATED",
		}
		resp, err := ts.Service.GetInstanceSetting(ctx, req)

		// Verify response
		require.NoError(t, err)
		require.NotNil(t, resp)
		require.Equal(t, "instance/settings/MEMO_RELATED", resp.Name)

		// The memo related setting should have a memo_related_setting field
		memoRelatedSetting := resp.GetMemoRelatedSetting()
		require.NotNil(t, memoRelatedSetting)
	})

	t.Run("GetInstanceSetting - invalid setting name", func(t *testing.T) {
		// Create test service for this specific test
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Call GetInstanceSetting with invalid name
		req := &v1pb.GetInstanceSettingRequest{
			Name: "invalid/setting/name",
		}
		_, err := ts.Service.GetInstanceSetting(ctx, req)

		// Should return an error
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid instance setting name")
	})
}

func TestUpdateInstanceSettingUpdateMask(t *testing.T) {
	ctx := context.Background()

	t.Run("storage upload size update preserves s3 config", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostUser, err := ts.CreateHostUser(ctx, "storagehost")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, hostUser.ID)

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_STORAGE,
			Value: &storepb.InstanceSetting_StorageSetting{
				StorageSetting: &storepb.InstanceStorageSetting{
					StorageType:       storepb.InstanceStorageSetting_S3,
					FilepathTemplate:  "assets/{filename}",
					UploadSizeLimitMb: 30,
					S3Config: &storepb.StorageS3Config{
						AccessKeyId:     "access-key",
						AccessKeySecret: "access-secret",
						Endpoint:        "https://s3.example.com",
						Region:          "us-east-1",
						Bucket:          "memos",
						UsePathStyle:    true,
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.UpdateInstanceSetting(userCtx, &v1pb.UpdateInstanceSettingRequest{
			Setting: &v1pb.InstanceSetting{
				Name: "instance/settings/STORAGE",
				Value: &v1pb.InstanceSetting_StorageSetting_{
					StorageSetting: &v1pb.InstanceSetting_StorageSetting{
						UploadSizeLimitMb: 64,
					},
				},
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"storage_setting.upload_size_limit_mb"}},
		})
		require.NoError(t, err)

		storageSetting := resp.GetStorageSetting()
		require.NotNil(t, storageSetting)
		require.Equal(t, int64(64), storageSetting.UploadSizeLimitMb)
		require.Equal(t, v1pb.InstanceSetting_StorageSetting_StorageType(storepb.InstanceStorageSetting_S3), storageSetting.StorageType)
		require.Equal(t, "assets/{filename}", storageSetting.FilepathTemplate)
		require.NotNil(t, storageSetting.S3Config)
		require.Equal(t, "access-key", storageSetting.S3Config.AccessKeyId)
		require.Equal(t, "access-secret", storageSetting.S3Config.AccessKeySecret)
		require.Equal(t, "https://s3.example.com", storageSetting.S3Config.Endpoint)
		require.Equal(t, "us-east-1", storageSetting.S3Config.Region)
		require.Equal(t, "memos", storageSetting.S3Config.Bucket)
		require.True(t, storageSetting.S3Config.UsePathStyle)

		persisted, err := ts.Store.GetInstanceStorageSetting(ctx)
		require.NoError(t, err)
		require.Equal(t, int64(64), persisted.UploadSizeLimitMb)
		require.NotNil(t, persisted.S3Config)
		require.Equal(t, "access-key", persisted.S3Config.AccessKeyId)
	})

	t.Run("general custom profile title update preserves other fields", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostUser, err := ts.CreateHostUser(ctx, "generalhost")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, hostUser.ID)

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_GENERAL,
			Value: &storepb.InstanceSetting_GeneralSetting{
				GeneralSetting: &storepb.InstanceGeneralSetting{
					DisallowUserRegistration: true,
					DisallowPasswordAuth:     true,
					AdditionalScript:         "console.log('old')",
					AdditionalStyle:          "body { color: red; }",
					WeekStartDayOffset:       1,
					DisallowChangeUsername:   true,
					DisallowChangeNickname:   true,
					CustomProfile: &storepb.InstanceCustomProfile{
						Title:       "Old title",
						Description: "Old description",
						LogoUrl:     "https://example.com/logo.png",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.UpdateInstanceSetting(userCtx, &v1pb.UpdateInstanceSettingRequest{
			Setting: &v1pb.InstanceSetting{
				Name: "instance/settings/GENERAL",
				Value: &v1pb.InstanceSetting_GeneralSetting_{
					GeneralSetting: &v1pb.InstanceSetting_GeneralSetting{
						CustomProfile: &v1pb.InstanceSetting_GeneralSetting_CustomProfile{
							Title: "New title",
						},
					},
				},
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"general_setting.custom_profile.title"}},
		})
		require.NoError(t, err)

		generalSetting := resp.GetGeneralSetting()
		require.NotNil(t, generalSetting)
		require.True(t, generalSetting.DisallowUserRegistration)
		require.True(t, generalSetting.DisallowPasswordAuth)
		require.Equal(t, "console.log('old')", generalSetting.AdditionalScript)
		require.Equal(t, "body { color: red; }", generalSetting.AdditionalStyle)
		require.Equal(t, int32(1), generalSetting.WeekStartDayOffset)
		require.True(t, generalSetting.DisallowChangeUsername)
		require.True(t, generalSetting.DisallowChangeNickname)
		require.NotNil(t, generalSetting.CustomProfile)
		require.Equal(t, "New title", generalSetting.CustomProfile.Title)
		require.Equal(t, "Old description", generalSetting.CustomProfile.Description)
		require.Equal(t, "https://example.com/logo.png", generalSetting.CustomProfile.LogoUrl)
	})

	t.Run("memo related reactions update preserves policy fields", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostUser, err := ts.CreateHostUser(ctx, "memohost")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, hostUser.ID)

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_MEMO_RELATED,
			Value: &storepb.InstanceSetting_MemoRelatedSetting{
				MemoRelatedSetting: &storepb.InstanceMemoRelatedSetting{
					DisallowPublicVisibility: true,
					DisplayWithUpdateTime:    true,
					ContentLengthLimit:       512 * 1024,
					EnableDoubleClickEdit:    true,
					Reactions:                []string{"old"},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.UpdateInstanceSetting(userCtx, &v1pb.UpdateInstanceSettingRequest{
			Setting: &v1pb.InstanceSetting{
				Name: "instance/settings/MEMO_RELATED",
				Value: &v1pb.InstanceSetting_MemoRelatedSetting_{
					MemoRelatedSetting: &v1pb.InstanceSetting_MemoRelatedSetting{
						Reactions: []string{"new", "ok"},
					},
				},
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"memo_related_setting.reactions"}},
		})
		require.NoError(t, err)

		memoRelatedSetting := resp.GetMemoRelatedSetting()
		require.NotNil(t, memoRelatedSetting)
		require.True(t, memoRelatedSetting.DisallowPublicVisibility)
		require.True(t, memoRelatedSetting.DisplayWithUpdateTime)
		require.Equal(t, int32(512*1024), memoRelatedSetting.ContentLengthLimit)
		require.True(t, memoRelatedSetting.EnableDoubleClickEdit)
		require.Equal(t, []string{"new", "ok"}, memoRelatedSetting.Reactions)
	})

	t.Run("unknown update path returns invalid argument", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostUser, err := ts.CreateHostUser(ctx, "invalidpathhost")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, hostUser.ID)

		_, err = ts.Service.UpdateInstanceSetting(userCtx, &v1pb.UpdateInstanceSettingRequest{
			Setting: &v1pb.InstanceSetting{
				Name: "instance/settings/GENERAL",
				Value: &v1pb.InstanceSetting_GeneralSetting_{
					GeneralSetting: &v1pb.InstanceSetting_GeneralSetting{},
				},
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"general_setting.unknown"}},
		})
		require.Error(t, err)
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("empty update mask keeps full replacement compatibility", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostUser, err := ts.CreateHostUser(ctx, "fullreplacehost")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, hostUser.ID)

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_STORAGE,
			Value: &storepb.InstanceSetting_StorageSetting{
				StorageSetting: &storepb.InstanceStorageSetting{
					StorageType:       storepb.InstanceStorageSetting_S3,
					FilepathTemplate:  "assets/{filename}",
					UploadSizeLimitMb: 30,
					S3Config: &storepb.StorageS3Config{
						AccessKeyId: "access-key",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.UpdateInstanceSetting(userCtx, &v1pb.UpdateInstanceSettingRequest{
			Setting: &v1pb.InstanceSetting{
				Name: "instance/settings/STORAGE",
				Value: &v1pb.InstanceSetting_StorageSetting_{
					StorageSetting: &v1pb.InstanceSetting_StorageSetting{
						UploadSizeLimitMb: 64,
					},
				},
			},
		})
		require.NoError(t, err)

		storageSetting := resp.GetStorageSetting()
		require.NotNil(t, storageSetting)
		require.Equal(t, int64(64), storageSetting.UploadSizeLimitMb)
		require.Equal(t, v1pb.InstanceSetting_StorageSetting_STORAGE_TYPE_UNSPECIFIED, storageSetting.StorageType)
		require.Empty(t, storageSetting.FilepathTemplate)
		require.Nil(t, storageSetting.S3Config)
	})
}
