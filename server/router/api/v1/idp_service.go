package v1

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/usememos/memos/plugin/idp/oauth2"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) CreateIdentityProvider(ctx context.Context, request *v1pb.CreateIdentityProviderRequest) (*v1pb.IdentityProvider, error) {
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if currentUser.Role != store.RoleHost {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if request == nil || request.IdentityProvider == nil {
		return nil, status.Errorf(codes.InvalidArgument, "identity_provider is required")
	}
	if err := validateIdentityProviderConfig(request.IdentityProvider.Type, request.IdentityProvider.Config); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid identity provider config: %v", err)
	}

	identityProvider, err := s.Store.CreateIdentityProvider(ctx, convertIdentityProviderToStore(request.IdentityProvider))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create identity provider, error: %+v", err)
	}
	return convertIdentityProviderFromStore(identityProvider), nil
}

func (s *APIV1Service) ListIdentityProviders(ctx context.Context, _ *v1pb.ListIdentityProvidersRequest) (*v1pb.ListIdentityProvidersResponse, error) {
	identityProviders, err := s.Store.ListIdentityProviders(ctx, &store.FindIdentityProvider{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list identity providers, error: %+v", err)
	}

	response := &v1pb.ListIdentityProvidersResponse{
		IdentityProviders: []*v1pb.IdentityProvider{},
	}

	// Default to lowest-privilege role, update later based on real role
	currentUserRole := store.RoleUser
	currentUser, err := s.fetchCurrentUser(ctx)
	if err == nil && currentUser != nil {
		currentUserRole = currentUser.Role
	}

	for _, identityProvider := range identityProviders {
		identityProviderConverted := convertIdentityProviderFromStore(identityProvider)
		response.IdentityProviders = append(response.IdentityProviders, redactIdentityProviderResponse(identityProviderConverted, currentUserRole))
	}
	return response, nil
}

func (s *APIV1Service) GetIdentityProvider(ctx context.Context, request *v1pb.GetIdentityProviderRequest) (*v1pb.IdentityProvider, error) {
	id, err := ExtractIdentityProviderIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid identity provider name: %v", err)
	}
	identityProvider, err := s.Store.GetIdentityProvider(ctx, &store.FindIdentityProvider{
		ID: &id,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get identity provider, error: %+v", err)
	}
	if identityProvider == nil {
		return nil, status.Errorf(codes.NotFound, "identity provider not found")
	}

	// Default to lowest-privilege role, update later based on real role
	currentUserRole := store.RoleUser
	currentUser, err := s.fetchCurrentUser(ctx)
	if err == nil && currentUser != nil {
		currentUserRole = currentUser.Role
	}

	identityProviderConverted := convertIdentityProviderFromStore(identityProvider)
	return redactIdentityProviderResponse(identityProviderConverted, currentUserRole), nil
}

func (s *APIV1Service) UpdateIdentityProvider(ctx context.Context, request *v1pb.UpdateIdentityProviderRequest) (*v1pb.IdentityProvider, error) {
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if currentUser.Role != store.RoleHost {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if request == nil || request.IdentityProvider == nil {
		return nil, status.Errorf(codes.InvalidArgument, "identity_provider is required")
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update_mask is required")
	}

	id, err := ExtractIdentityProviderIDFromName(request.IdentityProvider.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid identity provider name: %v", err)
	}
	update := &store.UpdateIdentityProviderV1{
		ID:   id,
		Type: storepb.IdentityProvider_Type(storepb.IdentityProvider_Type_value[request.IdentityProvider.Type.String()]),
	}
	for _, field := range request.UpdateMask.Paths {
		switch field {
		case "title":
			update.Name = &request.IdentityProvider.Title
		case "identifier_filter":
			update.IdentifierFilter = &request.IdentityProvider.IdentifierFilter
		case "config":
			if err := validateIdentityProviderConfig(request.IdentityProvider.Type, request.IdentityProvider.Config); err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "invalid identity provider config: %v", err)
			}
			update.Config = convertIdentityProviderConfigToStore(request.IdentityProvider.Type, request.IdentityProvider.Config)
		default:
			// Ignore unsupported fields
		}
	}

	identityProvider, err := s.Store.UpdateIdentityProvider(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update identity provider, error: %+v", err)
	}
	return convertIdentityProviderFromStore(identityProvider), nil
}

func (s *APIV1Service) DeleteIdentityProvider(ctx context.Context, request *v1pb.DeleteIdentityProviderRequest) (*emptypb.Empty, error) {
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if currentUser.Role != store.RoleHost {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	id, err := ExtractIdentityProviderIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid identity provider name: %v", err)
	}

	// Check if the identity provider exists before trying to delete it
	identityProvider, err := s.Store.GetIdentityProvider(ctx, &store.FindIdentityProvider{ID: &id})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check identity provider existence: %v", err)
	}
	if identityProvider == nil {
		return nil, status.Errorf(codes.NotFound, "identity provider not found")
	}

	if err := s.Store.DeleteIdentityProvider(ctx, &store.DeleteIdentityProvider{ID: id}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete identity provider, error: %+v", err)
	}
	return &emptypb.Empty{}, nil
}

func convertIdentityProviderFromStore(identityProvider *storepb.IdentityProvider) *v1pb.IdentityProvider {
	temp := &v1pb.IdentityProvider{
		Name:             fmt.Sprintf("%s%d", IdentityProviderNamePrefix, identityProvider.Id),
		Title:            identityProvider.Name,
		IdentifierFilter: identityProvider.IdentifierFilter,
		Type:             v1pb.IdentityProvider_Type(v1pb.IdentityProvider_Type_value[identityProvider.Type.String()]),
	}
	if identityProvider.Type == storepb.IdentityProvider_OAUTH2 {
		oauth2Config := identityProvider.Config.GetOauth2Config()
		apiOAuth2Config := &v1pb.OAuth2Config{}
		if oauth2Config != nil {
			apiOAuth2Config.ClientId = oauth2Config.ClientId
			apiOAuth2Config.ClientSecret = oauth2Config.ClientSecret
			apiOAuth2Config.AuthUrl = oauth2Config.AuthUrl
			apiOAuth2Config.TokenUrl = oauth2Config.TokenUrl
			apiOAuth2Config.UserInfoUrl = oauth2Config.UserInfoUrl
			apiOAuth2Config.Scopes = oauth2Config.Scopes
			if oauth2Config.FieldMapping != nil {
				apiOAuth2Config.FieldMapping = &v1pb.FieldMapping{
					Identifier:  oauth2Config.FieldMapping.Identifier,
					DisplayName: oauth2Config.FieldMapping.DisplayName,
					Email:       oauth2Config.FieldMapping.Email,
					AvatarUrl:   oauth2Config.FieldMapping.AvatarUrl,
				}
			}
		}
		temp.Config = &v1pb.IdentityProviderConfig{
			Config: &v1pb.IdentityProviderConfig_Oauth2Config{
				Oauth2Config: apiOAuth2Config,
			},
		}
	}
	return temp
}

func convertIdentityProviderToStore(identityProvider *v1pb.IdentityProvider) *storepb.IdentityProvider {
	id, _ := ExtractIdentityProviderIDFromName(identityProvider.Name)

	temp := &storepb.IdentityProvider{
		Id:               id,
		Name:             identityProvider.Title,
		IdentifierFilter: identityProvider.IdentifierFilter,
		Type:             storepb.IdentityProvider_Type(storepb.IdentityProvider_Type_value[identityProvider.Type.String()]),
		Config:           convertIdentityProviderConfigToStore(identityProvider.Type, identityProvider.Config),
	}
	return temp
}

func convertIdentityProviderConfigToStore(identityProviderType v1pb.IdentityProvider_Type, config *v1pb.IdentityProviderConfig) *storepb.IdentityProviderConfig {
	if identityProviderType == v1pb.IdentityProvider_OAUTH2 {
		if config == nil {
			return nil
		}
		oauth2Config := config.GetOauth2Config()
		if oauth2Config == nil {
			return nil
		}
		fieldMapping := &storepb.FieldMapping{}
		if oauth2Config.FieldMapping != nil {
			fieldMapping = &storepb.FieldMapping{
				Identifier:  oauth2Config.FieldMapping.Identifier,
				DisplayName: oauth2Config.FieldMapping.DisplayName,
				Email:       oauth2Config.FieldMapping.Email,
				AvatarUrl:   oauth2Config.FieldMapping.AvatarUrl,
			}
		}
		return &storepb.IdentityProviderConfig{
			Config: &storepb.IdentityProviderConfig_Oauth2Config{
				Oauth2Config: &storepb.OAuth2Config{
					ClientId:     oauth2Config.ClientId,
					ClientSecret: oauth2Config.ClientSecret,
					AuthUrl:      oauth2Config.AuthUrl,
					TokenUrl:     oauth2Config.TokenUrl,
					UserInfoUrl:  oauth2Config.UserInfoUrl,
					Scopes:       oauth2Config.Scopes,
					FieldMapping: fieldMapping,
				},
			},
		}
	}
	return nil
}

func validateIdentityProviderConfig(identityProviderType v1pb.IdentityProvider_Type, config *v1pb.IdentityProviderConfig) error {
	if identityProviderType != v1pb.IdentityProvider_OAUTH2 {
		return errors.New("unsupported identity provider type")
	}
	if config == nil {
		return errors.New("config is required")
	}
	oauth2Config := config.GetOauth2Config()
	if oauth2Config == nil {
		return errors.New("oauth2_config is required")
	}
	if _, err := oauth2.NewIdentityProvider(&storepb.OAuth2Config{
		ClientId:     oauth2Config.ClientId,
		ClientSecret: oauth2Config.ClientSecret,
		AuthUrl:      oauth2Config.AuthUrl,
		TokenUrl:     oauth2Config.TokenUrl,
		UserInfoUrl:  oauth2Config.UserInfoUrl,
		Scopes:       oauth2Config.Scopes,
		FieldMapping: func() *storepb.FieldMapping {
			if oauth2Config.FieldMapping == nil {
				return nil
			}
			return &storepb.FieldMapping{
				Identifier:  oauth2Config.FieldMapping.Identifier,
				DisplayName: oauth2Config.FieldMapping.DisplayName,
				Email:       oauth2Config.FieldMapping.Email,
				AvatarUrl:   oauth2Config.FieldMapping.AvatarUrl,
			}
		}(),
	}); err != nil {
		return err
	}
	return nil
}

func redactIdentityProviderResponse(identityProvider *v1pb.IdentityProvider, userRole store.Role) *v1pb.IdentityProvider {
	if identityProvider == nil {
		return nil
	}
	if userRole == store.RoleHost {
		return identityProvider
	}
	if identityProvider.Type == v1pb.IdentityProvider_OAUTH2 {
		oauth2Config := identityProvider.Config.GetOauth2Config()
		if oauth2Config != nil {
			oauth2Config.ClientSecret = ""
			oauth2Config.TokenUrl = ""
			oauth2Config.UserInfoUrl = ""
			oauth2Config.FieldMapping = nil
		}
	}
	identityProvider.IdentifierFilter = ""
	return identityProvider
}
