package test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestCreateUserRegistration(t *testing.T) {
	ctx := context.Background()

	t.Run("CreateUser rejects missing user payload", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		_, err := ts.Service.CreateUser(ctx, nil)
		require.Error(t, err)
		require.Equal(t, codes.InvalidArgument, status.Code(err))

		_, err = ts.Service.CreateUser(ctx, &apiv1.CreateUserRequest{})
		require.Error(t, err)
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("Archived user cannot call authenticated business APIs", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "archived-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		archivedStatus := store.Archived
		_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{
			ID:        user.ID,
			RowStatus: &archivedStatus,
		})
		require.NoError(t, err)

		_, err = ts.Service.CreateAttachment(userCtx, &apiv1.CreateAttachmentRequest{
			Attachment: &apiv1.Attachment{
				Filename: "blocked.txt",
				Type:     "text/plain",
				Content:  []byte("blocked"),
			},
		})
		require.Error(t, err)
		require.Equal(t, codes.Unauthenticated, status.Code(err))
	})

	t.Run("GetUser hides sensitive fields and archived users from public callers", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		visibleUser, err := ts.CreateRegularUser(ctx, "visible-user")
		require.NoError(t, err)
		description := "public description"
		avatarURL := "https://example.com/avatar.png"
		_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{
			ID:          visibleUser.ID,
			Nickname:    &visibleUser.Username,
			Description: &description,
			AvatarURL:   &avatarURL,
		})
		require.NoError(t, err)

		publicUser, err := ts.Service.GetUser(ctx, &apiv1.GetUserRequest{Name: fmt.Sprintf("users/%d", visibleUser.ID)})
		require.NoError(t, err)
		require.Equal(t, apiv1.User_ROLE_UNSPECIFIED, publicUser.Role)
		require.Equal(t, apiv1.State_STATE_UNSPECIFIED, publicUser.State)
		require.Empty(t, publicUser.Email)
		require.Nil(t, publicUser.CreateTime)
		require.Nil(t, publicUser.UpdateTime)
		require.NotEmpty(t, publicUser.Username)
		require.NotEmpty(t, publicUser.DisplayName)
		require.Equal(t, description, publicUser.Description)
		require.Equal(t, avatarURL, publicUser.AvatarUrl)

		archivedUser, err := ts.CreateRegularUser(ctx, "archived-public-user")
		require.NoError(t, err)
		_, err = ts.Service.GetUser(ctx, &apiv1.GetUserRequest{Name: fmt.Sprintf("users/%d", archivedUser.ID)})
		require.NoError(t, err)
		_, err = ts.Service.GetUser(ctx, &apiv1.GetUserRequest{Name: fmt.Sprintf("users/%s", archivedUser.Username)})
		require.NoError(t, err)
		archivedStatus := store.Archived
		_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: archivedUser.ID, RowStatus: &archivedStatus})
		require.NoError(t, err)

		_, err = ts.Service.GetUser(ctx, &apiv1.GetUserRequest{Name: fmt.Sprintf("users/%d", archivedUser.ID)})
		require.Error(t, err)
		require.True(t, strings.Contains(err.Error(), "user not found"), err.Error())
		_, err = ts.Service.GetUser(ctx, &apiv1.GetUserRequest{Name: fmt.Sprintf("users/%s", archivedUser.Username)})
		require.Error(t, err)
		require.True(t, strings.Contains(err.Error(), "user not found"), err.Error())
	})

	t.Run("Concurrent first-user creation yields only one host", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		const attempts = 8
		results := make(chan *apiv1.User, attempts)
		errs := make(chan error, attempts)
		var wg sync.WaitGroup
		start := make(chan struct{})

		for i := 0; i < attempts; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				user, err := ts.Service.CreateUser(ctx, &apiv1.CreateUserRequest{
					User: &apiv1.User{
						Username: fmt.Sprintf("race-user-%d", i),
						Email:    fmt.Sprintf("race-user-%d@example.com", i),
						Password: "Password123",
					},
				})
				if err != nil {
					errs <- err
					return
				}
				results <- user
			}(i)
		}

		close(start)
		wg.Wait()
		close(results)
		close(errs)

		for err := range errs {
			require.NoError(t, err)
		}

		normalStatus := store.Normal
		hostRole := store.RoleHost
		hosts, err := ts.Store.ListUsers(ctx, &store.FindUser{Role: &hostRole, RowStatus: &normalStatus})
		require.NoError(t, err)
		require.Len(t, hosts, 1)

		hostCount := 0
		userCount := 0
		for user := range results {
			require.NotNil(t, user)
			if user.Role == apiv1.User_HOST {
				hostCount++
			} else if user.Role == apiv1.User_USER {
				userCount++
			}
		}
		require.Equal(t, 1, hostCount)
		require.Equal(t, attempts-1, userCount)
	})

	t.Run("Archived host is ignored when reconciling canonical active host", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		archivedHost, err := ts.CreateHostUser(ctx, "archived-bootstrap-host")
		require.NoError(t, err)
		archivedStatus := store.Archived
		_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: archivedHost.ID, RowStatus: &archivedStatus})
		require.NoError(t, err)

		activeHost, err := ts.CreateHostUser(ctx, "active-bootstrap-host")
		require.NoError(t, err)
		activeHostCtx := ts.CreateUserContext(ctx, activeHost.ID)

		createdUser, err := ts.Service.CreateUser(activeHostCtx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "candidate-host",
				Email:    "candidate-host@example.com",
				Password: "Password123",
				Role:     apiv1.User_HOST,
			},
		})
		require.NoError(t, err)
		require.Equal(t, apiv1.User_USER, createdUser.Role)

		normalStatus := store.Normal
		hostRole := store.RoleHost
		hosts, err := ts.Store.ListUsers(ctx, &store.FindUser{Role: &hostRole, RowStatus: &normalStatus})
		require.NoError(t, err)
		require.Len(t, hosts, 1)
		require.Equal(t, activeHost.ID, hosts[0].ID)
	})

	t.Run("CreateUser success when registration enabled", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// User registration is enabled by default, no need to set it explicitly

		// Create user without authentication - should succeed
		_, err := ts.Service.CreateUser(ctx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "newuser",
				Email:    "newuser@example.com",
				Password: "Password123",
			},
		})
		require.NoError(t, err)
	})

	t.Run("CreateUser blocked when registration disabled", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create a host user first so we're not in first-user setup mode
		_, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)

		// Disable user registration
		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_GENERAL,
			Value: &storepb.InstanceSetting_GeneralSetting{
				GeneralSetting: &storepb.InstanceGeneralSetting{
					DisallowUserRegistration: true,
				},
			},
		})
		require.NoError(t, err)

		// Try to create user without authentication - should fail
		_, err = ts.Service.CreateUser(ctx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "newuser",
				Email:    "newuser@example.com",
				Password: "Password123",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not allowed")
	})

	t.Run("CreateUser succeeds for superuser even when registration disabled", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create host user
		hostUser, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)
		hostCtx := ts.CreateUserContext(ctx, hostUser.ID)

		// Disable user registration
		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_GENERAL,
			Value: &storepb.InstanceSetting_GeneralSetting{
				GeneralSetting: &storepb.InstanceGeneralSetting{
					DisallowUserRegistration: true,
				},
			},
		})
		require.NoError(t, err)

		// Host user can create users even when registration is disabled - should succeed
		_, err = ts.Service.CreateUser(hostCtx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "newuser",
				Email:    "newuser@example.com",
				Password: "Password123",
			},
		})
		require.NoError(t, err)
	})

	t.Run("CreateUser regular user cannot create users when registration disabled", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create regular user
		regularUser, err := ts.CreateRegularUser(ctx, "regularuser")
		require.NoError(t, err)
		regularUserCtx := ts.CreateUserContext(ctx, regularUser.ID)

		// Disable user registration
		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_GENERAL,
			Value: &storepb.InstanceSetting_GeneralSetting{
				GeneralSetting: &storepb.InstanceGeneralSetting{
					DisallowUserRegistration: true,
				},
			},
		})
		require.NoError(t, err)

		// Regular user tries to create user when registration is disabled - should fail
		_, err = ts.Service.CreateUser(regularUserCtx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "newuser",
				Email:    "newuser@example.com",
				Password: "Password123",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not allowed")
	})

	t.Run("CreateUser host can assign roles", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create host user
		hostUser, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)
		hostCtx := ts.CreateUserContext(ctx, hostUser.ID)

		// Host user can create user with specific role - should succeed
		createdUser, err := ts.Service.CreateUser(hostCtx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "newadmin",
				Email:    "newadmin@example.com",
				Password: "Password123",
				Role:     apiv1.User_ADMIN,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, createdUser)
		require.Equal(t, apiv1.User_ADMIN, createdUser.Role)
	})

	t.Run("CreateUser unauthenticated user can only create regular user", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create a host user first so we're not in first-user setup mode
		_, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)

		// User registration is enabled by default

		// Unauthenticated user tries to create admin user - role should be ignored
		createdUser, err := ts.Service.CreateUser(ctx, &apiv1.CreateUserRequest{
			User: &apiv1.User{
				Username: "wannabeadmin",
				Email:    "wannabeadmin@example.com",
				Password: "Password123",
				Role:     apiv1.User_ADMIN, // This should be ignored
			},
		})
		require.NoError(t, err)
		require.NotNil(t, createdUser)
		require.Equal(t, apiv1.User_USER, createdUser.Role, "Unauthenticated users can only create USER role")
	})
}

func TestUpdateUserHostStateBoundaries(t *testing.T) {
	ctx := context.Background()

	t.Run("host cannot archive self", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		host, err := ts.CreateHostUser(ctx, "self-host")
		require.NoError(t, err)
		hostCtx := ts.CreateUserContext(ctx, host.ID)

		_, err = ts.Service.UpdateUser(hostCtx, &apiv1.UpdateUserRequest{
			User: &apiv1.User{
				Name:  fmt.Sprintf("users/%d", host.ID),
				State: apiv1.State_ARCHIVED,
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
		})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("host cannot archive last active host", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		host, err := ts.CreateHostUser(ctx, "last-host")
		require.NoError(t, err)
		regularUser, err := ts.CreateRegularUser(ctx, "regular-for-archive")
		require.NoError(t, err)
		hostCtx := ts.CreateUserContext(ctx, host.ID)

		_, err = ts.Service.UpdateUser(hostCtx, &apiv1.UpdateUserRequest{
			User: &apiv1.User{
				Name:  fmt.Sprintf("users/%d", regularUser.ID),
				State: apiv1.State_ARCHIVED,
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
		})
		require.NoError(t, err)

		_, err = ts.Service.UpdateUser(hostCtx, &apiv1.UpdateUserRequest{
			User: &apiv1.User{
				Name:  fmt.Sprintf("users/%d", host.ID),
				State: apiv1.State_ARCHIVED,
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
		})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("host cannot demote the last active host role", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		host, err := ts.CreateHostUser(ctx, "last-role-host")
		require.NoError(t, err)
		hostCtx := ts.CreateUserContext(ctx, host.ID)

		_, err = ts.Service.UpdateUser(hostCtx, &apiv1.UpdateUserRequest{
			User: &apiv1.User{
				Name: fmt.Sprintf("users/%d", host.ID),
				Role: apiv1.User_ADMIN,
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"role"}},
		})
		require.Error(t, err)
		require.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("host can demote another host when one active host remains", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostOne, err := ts.CreateHostUser(ctx, "role-host-one")
		require.NoError(t, err)
		hostTwo, err := ts.CreateHostUser(ctx, "role-host-two")
		require.NoError(t, err)
		hostOneCtx := ts.CreateUserContext(ctx, hostOne.ID)

		updatedHost, err := ts.Service.UpdateUser(hostOneCtx, &apiv1.UpdateUserRequest{
			User: &apiv1.User{
				Name: fmt.Sprintf("users/%d", hostTwo.ID),
				Role: apiv1.User_ADMIN,
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"role"}},
		})
		require.NoError(t, err)
		require.Equal(t, apiv1.User_ADMIN, updatedHost.Role)

		normalStatus := store.Normal
		hostRole := store.RoleHost
		hosts, err := ts.Store.ListUsers(ctx, &store.FindUser{Role: &hostRole, RowStatus: &normalStatus})
		require.NoError(t, err)
		require.Len(t, hosts, 1)
		require.Equal(t, hostOne.ID, hosts[0].ID)
	})

	t.Run("host can archive another host when one active host remains", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		hostOne, err := ts.CreateHostUser(ctx, "host-one")
		require.NoError(t, err)
		hostTwo, err := ts.CreateHostUser(ctx, "host-two")
		require.NoError(t, err)
		hostOneCtx := ts.CreateUserContext(ctx, hostOne.ID)

		_, err = ts.Service.UpdateUser(hostOneCtx, &apiv1.UpdateUserRequest{
			User: &apiv1.User{
				Name:  fmt.Sprintf("users/%d", hostTwo.ID),
				State: apiv1.State_ARCHIVED,
			},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}},
		})
		require.NoError(t, err)

		normalStatus := store.Normal
		hostRole := store.RoleHost
		hosts, err := ts.Store.ListUsers(ctx, &store.FindUser{Role: &hostRole, RowStatus: &normalStatus})
		require.NoError(t, err)
		require.Len(t, hosts, 1)
		require.Equal(t, hostOne.ID, hosts[0].ID)
	})
}

func TestListUsersShowDeleted(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	host, err := ts.CreateHostUser(ctx, "list-host")
	require.NoError(t, err)
	hostCtx := ts.CreateUserContext(ctx, host.ID)
	activeUser, err := ts.CreateRegularUser(ctx, "active-user")
	require.NoError(t, err)
	archivedUser, err := ts.CreateRegularUser(ctx, "archived-user-list")
	require.NoError(t, err)
	archivedStatus := store.Archived
	_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: archivedUser.ID, RowStatus: &archivedStatus})
	require.NoError(t, err)

	list, err := ts.Service.ListUsers(hostCtx, &apiv1.ListUsersRequest{})
	require.NoError(t, err)
	requireUserListed(t, list.Users, activeUser.ID)
	requireUserNotListed(t, list.Users, archivedUser.ID)

	listWithDeleted, err := ts.Service.ListUsers(hostCtx, &apiv1.ListUsersRequest{ShowDeleted: true})
	require.NoError(t, err)
	requireUserListed(t, listWithDeleted.Users, activeUser.ID)
	requireUserListed(t, listWithDeleted.Users, archivedUser.ID)
}

func requireUserListed(t *testing.T, users []*apiv1.User, userID int32) {
	t.Helper()
	userName := fmt.Sprintf("users/%d", userID)
	for _, user := range users {
		if user.Name == userName {
			return
		}
	}
	t.Fatalf("expected %s to be listed", userName)
}

func requireUserNotListed(t *testing.T, users []*apiv1.User, userID int32) {
	t.Helper()
	userName := fmt.Sprintf("users/%d", userID)
	for _, user := range users {
		require.NotEqual(t, userName, user.Name)
	}
}
