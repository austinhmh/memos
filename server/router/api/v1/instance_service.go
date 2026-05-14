package v1

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/netutil"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// GetInstanceProfile returns the instance profile.
func (s *APIV1Service) GetInstanceProfile(ctx context.Context, _ *v1pb.GetInstanceProfileRequest) (*v1pb.InstanceProfile, error) {
	instanceProfile := &v1pb.InstanceProfile{
		Version:     s.Profile.Version,
		Mode:        s.Profile.Mode,
		InstanceUrl: s.Profile.InstanceURL,
	}
	owner, err := s.GetInstanceOwner(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance owner: %v", err)
	}
	if owner != nil {
		instanceProfile.Owner = owner.Name
	}
	return instanceProfile, nil
}

func (s *APIV1Service) GetInstanceSetting(ctx context.Context, request *v1pb.GetInstanceSettingRequest) (*v1pb.InstanceSetting, error) {
	instanceSettingKeyString, err := ExtractInstanceSettingKeyFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid instance setting name: %v", err)
	}

	instanceSettingKey := storepb.InstanceSettingKey(storepb.InstanceSettingKey_value[instanceSettingKeyString])
	// Get instance setting from store with default value.
	switch instanceSettingKey {
	case storepb.InstanceSettingKey_BASIC:
		_, err = s.Store.GetInstanceBasicSetting(ctx)
	case storepb.InstanceSettingKey_GENERAL:
		_, err = s.Store.GetInstanceGeneralSetting(ctx)
	case storepb.InstanceSettingKey_MEMO_RELATED:
		_, err = s.Store.GetInstanceMemoRelatedSetting(ctx)
	case storepb.InstanceSettingKey_STORAGE:
		_, err = s.Store.GetInstanceStorageSetting(ctx)
	default:
		return nil, status.Errorf(codes.InvalidArgument, "unsupported instance setting key: %v", instanceSettingKey)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance setting: %v", err)
	}

	instanceSetting, err := s.Store.GetInstanceSetting(ctx, &store.FindInstanceSetting{
		Name: instanceSettingKey.String(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance setting: %v", err)
	}
	if instanceSetting == nil {
		return nil, status.Errorf(codes.NotFound, "instance setting not found")
	}

	// For storage and basic settings, only host can get them.
	if instanceSetting.Key == storepb.InstanceSettingKey_STORAGE || instanceSetting.Key == storepb.InstanceSettingKey_BASIC {
		user, err := s.fetchCurrentUser(ctx)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
		}
		if user == nil {
			return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
		}
		if user.Role != store.RoleHost {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
	}

	return convertInstanceSettingFromStore(instanceSetting), nil
}

func (s *APIV1Service) UpdateInstanceSetting(ctx context.Context, request *v1pb.UpdateInstanceSettingRequest) (*v1pb.InstanceSetting, error) {
	if request.Setting == nil {
		return nil, status.Errorf(codes.InvalidArgument, "setting is required")
	}

	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if user.Role != store.RoleHost {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	updateSetting, err := s.buildInstanceSettingUpdate(ctx, request)
	if err != nil {
		return nil, err
	}
	instanceSetting, err := s.Store.UpsertInstanceSetting(ctx, updateSetting)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to upsert instance setting: %v", err)
	}

	return convertInstanceSettingFromStore(instanceSetting), nil
}

const allowPrivateS3EndpointEnv = "MEMOS_ALLOW_PRIVATE_S3_ENDPOINT"

func allowPrivateS3Endpoint() bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(allowPrivateS3EndpointEnv)))
	return value == "1" || value == "true" || value == "yes"
}

func validateStorageS3Config(ctx context.Context, storageSetting *storepb.InstanceStorageSetting) error {
	if storageSetting == nil || storageSetting.S3Config == nil {
		return nil
	}
	if storageSetting.StorageType != storepb.InstanceStorageSetting_S3 {
		return nil
	}
	return validateStorageS3ConfigEndpoint(ctx, storageSetting.S3Config.Endpoint)
}

func validateStorageS3ConfigEndpoint(ctx context.Context, endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return nil
	}
	validator := netutil.ExternalURLValidator{
		AllowedSchemes: map[string]struct{}{
			"http":  {},
			"https": {},
		},
		AllowPrivateAddresses: allowPrivateS3Endpoint(),
	}
	if _, err := validator.Validate(ctx, endpoint); err != nil {
		if errors.Is(err, netutil.ErrNonPublicAddress) {
			return errors.Wrapf(err, "S3 endpoint must resolve to public addresses by default; set %s=true only for trusted private MinIO/S3 networks", allowPrivateS3EndpointEnv)
		}
		return errors.Wrap(err, "invalid S3 endpoint")
	}
	if validator.AllowPrivateAddresses {
		slog.Warn("Private S3 endpoint validation bypass is enabled; only use this for trusted private MinIO/S3 networks", "env", allowPrivateS3EndpointEnv)
	}
	return nil
}

func shouldValidateStorageS3Config(updateSetting *storepb.InstanceStorageSetting, paths []string) bool {
	if updateSetting == nil {
		return false
	}
	for _, path := range paths {
		switch normalizeInstanceSettingUpdatePath(path) {
		case "storage_setting", "value", "storageSetting",
			"storage_setting.storage_type", "value.storage_type", "storage_type", "storageSetting.storageType", "storageType",
			"storage_setting.s3_config", "value.s3_config", "s3_config", "storageSetting.s3Config", "s3Config",
			"storage_setting.s3_config.endpoint", "value.s3_config.endpoint", "s3_config.endpoint", "storageSetting.s3Config.endpoint", "s3Config.endpoint":
			return true
		}
	}
	return false
}

func (s *APIV1Service) buildInstanceSettingUpdate(ctx context.Context, request *v1pb.UpdateInstanceSettingRequest) (*storepb.InstanceSetting, error) {
	updateSetting, err := convertInstanceSettingToStore(request.Setting)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid instance setting: %v", err)
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		if updateSetting.Key == storepb.InstanceSettingKey_STORAGE {
			if err := validateStorageS3Config(ctx, updateSetting.GetStorageSetting()); err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "%v", err)
			}
		}
		return updateSetting, nil
	}

	existingSetting, err := s.getInstanceSettingForUpdate(ctx, updateSetting.Key)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance setting: %v", err)
	}

	mergedSetting, err := applyInstanceSettingUpdateMask(existingSetting, updateSetting, request.UpdateMask.Paths)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	if shouldValidateStorageS3Config(updateSetting.GetStorageSetting(), request.UpdateMask.Paths) {
		if err := validateStorageS3Config(ctx, mergedSetting.GetStorageSetting()); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}
	return mergedSetting, nil
}

func (s *APIV1Service) getInstanceSettingForUpdate(ctx context.Context, key storepb.InstanceSettingKey) (*storepb.InstanceSetting, error) {
	switch key {
	case storepb.InstanceSettingKey_GENERAL:
		generalSetting, err := s.Store.GetInstanceGeneralSetting(ctx)
		if err != nil {
			return nil, err
		}
		return &storepb.InstanceSetting{
			Key:   storepb.InstanceSettingKey_GENERAL,
			Value: &storepb.InstanceSetting_GeneralSetting{GeneralSetting: proto.Clone(generalSetting).(*storepb.InstanceGeneralSetting)},
		}, nil
	case storepb.InstanceSettingKey_STORAGE:
		storageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
		if err != nil {
			return nil, err
		}
		return &storepb.InstanceSetting{
			Key:   storepb.InstanceSettingKey_STORAGE,
			Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: proto.Clone(storageSetting).(*storepb.InstanceStorageSetting)},
		}, nil
	case storepb.InstanceSettingKey_MEMO_RELATED:
		memoRelatedSetting, err := s.Store.GetInstanceMemoRelatedSetting(ctx)
		if err != nil {
			return nil, err
		}
		return &storepb.InstanceSetting{
			Key:   storepb.InstanceSettingKey_MEMO_RELATED,
			Value: &storepb.InstanceSetting_MemoRelatedSetting{MemoRelatedSetting: proto.Clone(memoRelatedSetting).(*storepb.InstanceMemoRelatedSetting)},
		}, nil
	default:
		return nil, errors.Errorf("unsupported instance setting key: %v", key)
	}
}

func applyInstanceSettingUpdateMask(existingSetting, updateSetting *storepb.InstanceSetting, paths []string) (*storepb.InstanceSetting, error) {
	if existingSetting.Key != updateSetting.Key {
		return nil, errors.Errorf("setting key mismatch: %v != %v", existingSetting.Key, updateSetting.Key)
	}

	mergedSetting := proto.Clone(existingSetting).(*storepb.InstanceSetting)
	for _, path := range paths {
		normalizedPath := normalizeInstanceSettingUpdatePath(path)
		switch updateSetting.Key {
		case storepb.InstanceSettingKey_GENERAL:
			if err := applyInstanceGeneralSettingUpdatePath(mergedSetting.GetGeneralSetting(), updateSetting.GetGeneralSetting(), normalizedPath); err != nil {
				return nil, err
			}
		case storepb.InstanceSettingKey_STORAGE:
			if err := applyInstanceStorageSettingUpdatePath(mergedSetting.GetStorageSetting(), updateSetting.GetStorageSetting(), normalizedPath); err != nil {
				return nil, err
			}
		case storepb.InstanceSettingKey_MEMO_RELATED:
			if err := applyInstanceMemoRelatedSettingUpdatePath(mergedSetting.GetMemoRelatedSetting(), updateSetting.GetMemoRelatedSetting(), normalizedPath); err != nil {
				return nil, err
			}
		default:
			return nil, errors.Errorf("unsupported instance setting key: %v", updateSetting.Key)
		}
	}
	return mergedSetting, nil
}

func normalizeInstanceSettingUpdatePath(path string) string {
	return strings.TrimPrefix(path, "setting.")
}

func applyInstanceGeneralSettingUpdatePath(existingSetting, updateSetting *storepb.InstanceGeneralSetting, path string) error {
	if existingSetting == nil || updateSetting == nil {
		return errors.Errorf("general setting is required")
	}

	switch path {
	case "general_setting", "value", "generalSetting":
		proto.Merge(existingSetting, updateSetting)
	case "general_setting.disallow_user_registration", "value.disallow_user_registration", "disallow_user_registration", "generalSetting.disallowUserRegistration", "disallowUserRegistration":
		existingSetting.DisallowUserRegistration = updateSetting.DisallowUserRegistration
	case "general_setting.disallow_password_auth", "value.disallow_password_auth", "disallow_password_auth", "generalSetting.disallowPasswordAuth", "disallowPasswordAuth":
		existingSetting.DisallowPasswordAuth = updateSetting.DisallowPasswordAuth
	case "general_setting.additional_script", "value.additional_script", "additional_script", "generalSetting.additionalScript", "additionalScript":
		existingSetting.AdditionalScript = updateSetting.AdditionalScript
	case "general_setting.additional_style", "value.additional_style", "additional_style", "generalSetting.additionalStyle", "additionalStyle":
		existingSetting.AdditionalStyle = updateSetting.AdditionalStyle
	case "general_setting.custom_profile", "value.custom_profile", "custom_profile", "generalSetting.customProfile", "customProfile":
		existingSetting.CustomProfile = cloneInstanceCustomProfile(updateSetting.CustomProfile)
	case "general_setting.custom_profile.title", "value.custom_profile.title", "custom_profile.title", "generalSetting.customProfile.title", "customProfile.title":
		existingSetting.CustomProfile = cloneInstanceCustomProfile(existingSetting.CustomProfile)
		existingSetting.CustomProfile.Title = updateSetting.GetCustomProfile().GetTitle()
	case "general_setting.custom_profile.description", "value.custom_profile.description", "custom_profile.description", "generalSetting.customProfile.description", "customProfile.description":
		existingSetting.CustomProfile = cloneInstanceCustomProfile(existingSetting.CustomProfile)
		existingSetting.CustomProfile.Description = updateSetting.GetCustomProfile().GetDescription()
	case "general_setting.custom_profile.logo_url", "value.custom_profile.logo_url", "custom_profile.logo_url", "generalSetting.customProfile.logoUrl", "customProfile.logoUrl":
		existingSetting.CustomProfile = cloneInstanceCustomProfile(existingSetting.CustomProfile)
		existingSetting.CustomProfile.LogoUrl = updateSetting.GetCustomProfile().GetLogoUrl()
	case "general_setting.week_start_day_offset", "value.week_start_day_offset", "week_start_day_offset", "generalSetting.weekStartDayOffset", "weekStartDayOffset":
		existingSetting.WeekStartDayOffset = updateSetting.WeekStartDayOffset
	case "general_setting.disallow_change_username", "value.disallow_change_username", "disallow_change_username", "generalSetting.disallowChangeUsername", "disallowChangeUsername":
		existingSetting.DisallowChangeUsername = updateSetting.DisallowChangeUsername
	case "general_setting.disallow_change_nickname", "value.disallow_change_nickname", "disallow_change_nickname", "generalSetting.disallowChangeNickname", "disallowChangeNickname":
		existingSetting.DisallowChangeNickname = updateSetting.DisallowChangeNickname
	default:
		return errors.Errorf("invalid update path: %s", path)
	}
	return nil
}

func applyInstanceStorageSettingUpdatePath(existingSetting, updateSetting *storepb.InstanceStorageSetting, path string) error {
	if existingSetting == nil || updateSetting == nil {
		return errors.Errorf("storage setting is required")
	}

	switch path {
	case "storage_setting", "value", "storageSetting":
		mergedSetting := proto.Clone(existingSetting).(*storepb.InstanceStorageSetting)
		proto.Merge(mergedSetting, updateSetting)
		if err := validateStorageS3Config(context.Background(), mergedSetting); err != nil {
			return err
		}
		proto.Merge(existingSetting, updateSetting)
	case "storage_setting.storage_type", "value.storage_type", "storage_type", "storageSetting.storageType", "storageType":
		existingSetting.StorageType = updateSetting.StorageType
	case "storage_setting.filepath_template", "value.filepath_template", "filepath_template", "storageSetting.filepathTemplate", "filepathTemplate":
		existingSetting.FilepathTemplate = updateSetting.FilepathTemplate
	case "storage_setting.upload_size_limit_mb", "value.upload_size_limit_mb", "upload_size_limit_mb", "storageSetting.uploadSizeLimitMb", "uploadSizeLimitMb":
		existingSetting.UploadSizeLimitMb = updateSetting.UploadSizeLimitMb
	case "storage_setting.s3_config", "value.s3_config", "s3_config", "storageSetting.s3Config", "s3Config":
		if err := validateStorageS3ConfigEndpoint(context.Background(), updateSetting.GetS3Config().GetEndpoint()); err != nil {
			return err
		}
		existingSetting.S3Config = cloneStorageS3Config(updateSetting.S3Config)
	case "storage_setting.s3_config.access_key_id", "value.s3_config.access_key_id", "s3_config.access_key_id", "storageSetting.s3Config.accessKeyId", "s3Config.accessKeyId":
		existingSetting.S3Config = cloneStorageS3Config(existingSetting.S3Config)
		existingSetting.S3Config.AccessKeyId = updateSetting.GetS3Config().GetAccessKeyId()
	case "storage_setting.s3_config.access_key_secret", "value.s3_config.access_key_secret", "s3_config.access_key_secret", "storageSetting.s3Config.accessKeySecret", "s3Config.accessKeySecret":
		existingSetting.S3Config = cloneStorageS3Config(existingSetting.S3Config)
		existingSetting.S3Config.AccessKeySecret = updateSetting.GetS3Config().GetAccessKeySecret()
	case "storage_setting.s3_config.endpoint", "value.s3_config.endpoint", "s3_config.endpoint", "storageSetting.s3Config.endpoint", "s3Config.endpoint":
		endpoint := updateSetting.GetS3Config().GetEndpoint()
		if err := validateStorageS3ConfigEndpoint(context.Background(), endpoint); err != nil {
			return err
		}
		existingSetting.S3Config = cloneStorageS3Config(existingSetting.S3Config)
		existingSetting.S3Config.Endpoint = endpoint
	case "storage_setting.s3_config.region", "value.s3_config.region", "s3_config.region", "storageSetting.s3Config.region", "s3Config.region":
		existingSetting.S3Config = cloneStorageS3Config(existingSetting.S3Config)
		existingSetting.S3Config.Region = updateSetting.GetS3Config().GetRegion()
	case "storage_setting.s3_config.bucket", "value.s3_config.bucket", "s3_config.bucket", "storageSetting.s3Config.bucket", "s3Config.bucket":
		existingSetting.S3Config = cloneStorageS3Config(existingSetting.S3Config)
		existingSetting.S3Config.Bucket = updateSetting.GetS3Config().GetBucket()
	case "storage_setting.s3_config.use_path_style", "value.s3_config.use_path_style", "s3_config.use_path_style", "storageSetting.s3Config.usePathStyle", "s3Config.usePathStyle":
		existingSetting.S3Config = cloneStorageS3Config(existingSetting.S3Config)
		existingSetting.S3Config.UsePathStyle = updateSetting.GetS3Config().GetUsePathStyle()
	default:
		return errors.Errorf("invalid update path: %s", path)
	}
	return nil
}

func applyInstanceMemoRelatedSettingUpdatePath(existingSetting, updateSetting *storepb.InstanceMemoRelatedSetting, path string) error {
	if existingSetting == nil || updateSetting == nil {
		return errors.Errorf("memo related setting is required")
	}

	switch path {
	case "memo_related_setting", "value", "memoRelatedSetting":
		proto.Merge(existingSetting, updateSetting)
	case "memo_related_setting.disallow_public_visibility", "value.disallow_public_visibility", "disallow_public_visibility", "memoRelatedSetting.disallowPublicVisibility", "disallowPublicVisibility":
		existingSetting.DisallowPublicVisibility = updateSetting.DisallowPublicVisibility
	case "memo_related_setting.display_with_update_time", "value.display_with_update_time", "display_with_update_time", "memoRelatedSetting.displayWithUpdateTime", "displayWithUpdateTime":
		existingSetting.DisplayWithUpdateTime = updateSetting.DisplayWithUpdateTime
	case "memo_related_setting.content_length_limit", "value.content_length_limit", "content_length_limit", "memoRelatedSetting.contentLengthLimit", "contentLengthLimit":
		existingSetting.ContentLengthLimit = updateSetting.ContentLengthLimit
	case "memo_related_setting.enable_double_click_edit", "value.enable_double_click_edit", "enable_double_click_edit", "memoRelatedSetting.enableDoubleClickEdit", "enableDoubleClickEdit":
		existingSetting.EnableDoubleClickEdit = updateSetting.EnableDoubleClickEdit
	case "memo_related_setting.reactions", "value.reactions", "reactions", "memoRelatedSetting.reactions":
		existingSetting.Reactions = append([]string(nil), updateSetting.Reactions...)
	default:
		return errors.Errorf("invalid update path: %s", path)
	}
	return nil
}

func cloneInstanceCustomProfile(profile *storepb.InstanceCustomProfile) *storepb.InstanceCustomProfile {
	if profile == nil {
		return &storepb.InstanceCustomProfile{}
	}
	return proto.Clone(profile).(*storepb.InstanceCustomProfile)
}

func cloneStorageS3Config(config *storepb.StorageS3Config) *storepb.StorageS3Config {
	if config == nil {
		return &storepb.StorageS3Config{}
	}
	return proto.Clone(config).(*storepb.StorageS3Config)
}

func convertInstanceSettingFromStore(setting *storepb.InstanceSetting) *v1pb.InstanceSetting {
	instanceSetting := &v1pb.InstanceSetting{
		Name: fmt.Sprintf("instance/settings/%s", setting.Key.String()),
	}
	switch setting.Value.(type) {
	case *storepb.InstanceSetting_GeneralSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_GeneralSetting_{
			GeneralSetting: convertInstanceGeneralSettingFromStore(setting.GetGeneralSetting()),
		}
	case *storepb.InstanceSetting_StorageSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_StorageSetting_{
			StorageSetting: convertInstanceStorageSettingFromStore(setting.GetStorageSetting()),
		}
	case *storepb.InstanceSetting_MemoRelatedSetting:
		instanceSetting.Value = &v1pb.InstanceSetting_MemoRelatedSetting_{
			MemoRelatedSetting: convertInstanceMemoRelatedSettingFromStore(setting.GetMemoRelatedSetting()),
		}
	}
	return instanceSetting
}

func convertInstanceSettingToStore(setting *v1pb.InstanceSetting) (*storepb.InstanceSetting, error) {
	settingKeyString, err := ExtractInstanceSettingKeyFromName(setting.Name)
	if err != nil {
		return nil, err
	}
	settingKey, ok := storepb.InstanceSettingKey_value[settingKeyString]
	if !ok {
		return nil, errors.Errorf("unsupported instance setting key: %s", settingKeyString)
	}

	instanceSetting := &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey(settingKey),
	}
	switch instanceSetting.Key {
	case storepb.InstanceSettingKey_GENERAL:
		instanceSetting.Value = &storepb.InstanceSetting_GeneralSetting{
			GeneralSetting: convertInstanceGeneralSettingToStore(setting.GetGeneralSetting()),
		}
	case storepb.InstanceSettingKey_STORAGE:
		instanceSetting.Value = &storepb.InstanceSetting_StorageSetting{
			StorageSetting: convertInstanceStorageSettingToStore(setting.GetStorageSetting()),
		}
	case storepb.InstanceSettingKey_MEMO_RELATED:
		instanceSetting.Value = &storepb.InstanceSetting_MemoRelatedSetting{
			MemoRelatedSetting: convertInstanceMemoRelatedSettingToStore(setting.GetMemoRelatedSetting()),
		}
	default:
		return nil, errors.Errorf("unsupported instance setting key: %s", settingKeyString)
	}
	return instanceSetting, nil
}

func convertInstanceGeneralSettingFromStore(setting *storepb.InstanceGeneralSetting) *v1pb.InstanceSetting_GeneralSetting {
	if setting == nil {
		return nil
	}

	generalSetting := &v1pb.InstanceSetting_GeneralSetting{
		DisallowUserRegistration: setting.DisallowUserRegistration,
		DisallowPasswordAuth:     setting.DisallowPasswordAuth,
		AdditionalScript:         setting.AdditionalScript,
		AdditionalStyle:          setting.AdditionalStyle,
		WeekStartDayOffset:       setting.WeekStartDayOffset,
		DisallowChangeUsername:   setting.DisallowChangeUsername,
		DisallowChangeNickname:   setting.DisallowChangeNickname,
	}
	if setting.CustomProfile != nil {
		generalSetting.CustomProfile = &v1pb.InstanceSetting_GeneralSetting_CustomProfile{
			Title:       setting.CustomProfile.Title,
			Description: setting.CustomProfile.Description,
			LogoUrl:     setting.CustomProfile.LogoUrl,
		}
	}
	return generalSetting
}

func convertInstanceGeneralSettingToStore(setting *v1pb.InstanceSetting_GeneralSetting) *storepb.InstanceGeneralSetting {
	if setting == nil {
		return nil
	}
	generalSetting := &storepb.InstanceGeneralSetting{
		DisallowUserRegistration: setting.DisallowUserRegistration,
		DisallowPasswordAuth:     setting.DisallowPasswordAuth,
		AdditionalScript:         setting.AdditionalScript,
		AdditionalStyle:          setting.AdditionalStyle,
		WeekStartDayOffset:       setting.WeekStartDayOffset,
		DisallowChangeUsername:   setting.DisallowChangeUsername,
		DisallowChangeNickname:   setting.DisallowChangeNickname,
	}
	if setting.CustomProfile != nil {
		generalSetting.CustomProfile = &storepb.InstanceCustomProfile{
			Title:       setting.CustomProfile.Title,
			Description: setting.CustomProfile.Description,
			LogoUrl:     setting.CustomProfile.LogoUrl,
		}
	}
	return generalSetting
}

func convertInstanceStorageSettingFromStore(settingpb *storepb.InstanceStorageSetting) *v1pb.InstanceSetting_StorageSetting {
	if settingpb == nil {
		return nil
	}
	setting := &v1pb.InstanceSetting_StorageSetting{
		StorageType:       v1pb.InstanceSetting_StorageSetting_StorageType(settingpb.StorageType),
		FilepathTemplate:  settingpb.FilepathTemplate,
		UploadSizeLimitMb: settingpb.UploadSizeLimitMb,
	}
	if settingpb.S3Config != nil {
		setting.S3Config = &v1pb.InstanceSetting_StorageSetting_S3Config{
			AccessKeyId:     settingpb.S3Config.AccessKeyId,
			AccessKeySecret: settingpb.S3Config.AccessKeySecret,
			Endpoint:        settingpb.S3Config.Endpoint,
			Region:          settingpb.S3Config.Region,
			Bucket:          settingpb.S3Config.Bucket,
			UsePathStyle:    settingpb.S3Config.UsePathStyle,
		}
	}
	return setting
}

func convertInstanceStorageSettingToStore(setting *v1pb.InstanceSetting_StorageSetting) *storepb.InstanceStorageSetting {
	if setting == nil {
		return nil
	}
	settingpb := &storepb.InstanceStorageSetting{
		StorageType:       storepb.InstanceStorageSetting_StorageType(setting.StorageType),
		FilepathTemplate:  setting.FilepathTemplate,
		UploadSizeLimitMb: setting.UploadSizeLimitMb,
	}
	if setting.S3Config != nil {
		settingpb.S3Config = &storepb.StorageS3Config{
			AccessKeyId:     setting.S3Config.AccessKeyId,
			AccessKeySecret: setting.S3Config.AccessKeySecret,
			Endpoint:        setting.S3Config.Endpoint,
			Region:          setting.S3Config.Region,
			Bucket:          setting.S3Config.Bucket,
			UsePathStyle:    setting.S3Config.UsePathStyle,
		}
	}
	return settingpb
}

func convertInstanceMemoRelatedSettingFromStore(setting *storepb.InstanceMemoRelatedSetting) *v1pb.InstanceSetting_MemoRelatedSetting {
	if setting == nil {
		return nil
	}
	return &v1pb.InstanceSetting_MemoRelatedSetting{
		DisallowPublicVisibility: setting.DisallowPublicVisibility,
		DisplayWithUpdateTime:    setting.DisplayWithUpdateTime,
		ContentLengthLimit:       setting.ContentLengthLimit,
		EnableDoubleClickEdit:    setting.EnableDoubleClickEdit,
		Reactions:                setting.Reactions,
	}
}

func convertInstanceMemoRelatedSettingToStore(setting *v1pb.InstanceSetting_MemoRelatedSetting) *storepb.InstanceMemoRelatedSetting {
	if setting == nil {
		return nil
	}
	return &storepb.InstanceMemoRelatedSetting{
		DisallowPublicVisibility: setting.DisallowPublicVisibility,
		DisplayWithUpdateTime:    setting.DisplayWithUpdateTime,
		ContentLengthLimit:       setting.ContentLengthLimit,
		EnableDoubleClickEdit:    setting.EnableDoubleClickEdit,
		Reactions:                setting.Reactions,
	}
}

func (s *APIV1Service) GetInstanceOwner(ctx context.Context) (*v1pb.User, error) {
	normalStatus := store.Normal
	hostUserType := store.RoleHost
	user, err := s.Store.GetUser(ctx, &store.FindUser{
		Role:      &hostUserType,
		RowStatus: &normalStatus,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to find owner")
	}
	if user == nil {
		return nil, nil
	}

	return convertUserFromStore(user), nil
}
