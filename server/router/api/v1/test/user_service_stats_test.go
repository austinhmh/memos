package test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestListAllUserStats_PublicResponseIsRedacted(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "public_stats_user")
	require.NoError(t, err)

	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "public-stats-memo",
		CreatorID:  user.ID,
		Content:    "A public memo with #public tag",
		Visibility: store.Public,
		CreatedTs:  time.Now().Unix(),
		UpdatedTs:  time.Now().Unix(),
		Payload: &storepb.MemoPayload{
			Tags: []string{"public"},
			Property: &storepb.MemoPayload_Property{
				HasLink: true,
			},
		},
	})
	require.NoError(t, err)
	pinned := true
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Pinned: &pinned}))

	response, err := ts.Service.ListAllUserStats(ctx, &v1pb.ListAllUserStatsRequest{})
	require.NoError(t, err)
	require.Len(t, response.Stats, 1)

	stats := response.Stats[0]
	require.Equal(t, int32(1), stats.TagCount["public"])
	require.Empty(t, stats.MemoDisplayTimestamps)
	require.Empty(t, stats.PinnedMemos)
	require.Zero(t, stats.TotalMemoCount)
	require.Nil(t, stats.MemoTypeStats)
}

func TestListAllUserStats_PrivilegedResponseIncludesDetails(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "privileged_stats_user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	createdMemo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "privileged-stats-memo",
		CreatorID:  user.ID,
		Content:    "A protected memo with #private tag",
		Visibility: store.Private,
		CreatedTs:  time.Now().Unix(),
		UpdatedTs:  time.Now().Unix(),
		Payload: &storepb.MemoPayload{
			Tags: []string{"private"},
			Property: &storepb.MemoPayload_Property{
				HasCode:     true,
				HasTaskList: true,
			},
		},
	})
	require.NoError(t, err)
	pinned := true
	err = ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: createdMemo.ID, Pinned: &pinned})
	require.NoError(t, err)

	response, err := ts.Service.ListAllUserStats(userCtx, &v1pb.ListAllUserStatsRequest{})
	require.NoError(t, err)
	require.Len(t, response.Stats, 1)

	stats := response.Stats[0]
	require.Equal(t, int32(1), stats.TagCount["private"])
	require.Len(t, stats.MemoDisplayTimestamps, 1)
	require.Len(t, stats.PinnedMemos, 1)
	require.Equal(t, int32(1), stats.TotalMemoCount)
	require.NotNil(t, stats.MemoTypeStats)
	require.Equal(t, int32(1), stats.MemoTypeStats.CodeCount)
	require.Equal(t, int32(1), stats.MemoTypeStats.TodoCount)
}

func TestGetUserStats_PublicResponseIsRedacted(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "public_get_stats_user")
	require.NoError(t, err)

	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "public-get-stats-memo",
		CreatorID:  user.ID,
		Content:    "A public memo with #public-get tag",
		Visibility: store.Public,
		CreatedTs:  time.Now().Unix(),
		UpdatedTs:  time.Now().Unix(),
		Payload: &storepb.MemoPayload{
			Tags: []string{"public-get"},
			Property: &storepb.MemoPayload_Property{
				HasLink: true,
			},
		},
	})
	require.NoError(t, err)
	pinned := true
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Pinned: &pinned}))

	response, err := ts.Service.GetUserStats(ctx, &v1pb.GetUserStatsRequest{Name: fmt.Sprintf("users/%d", user.ID)})
	require.NoError(t, err)
	require.Equal(t, int32(1), response.TagCount["public-get"])
	require.Empty(t, response.MemoDisplayTimestamps)
	require.Empty(t, response.PinnedMemos)
	require.Zero(t, response.TotalMemoCount)
	require.Nil(t, response.MemoTypeStats)
}

func TestGetUserStats_TagCount(t *testing.T) {
	ctx := context.Background()

	// Create test service
	ts := NewTestService(t)
	defer ts.Cleanup()

	// Create a test host user
	user, err := ts.CreateHostUser(ctx, "test_user")
	require.NoError(t, err)

	// Create user context for authentication
	userCtx := ts.CreateUserContext(ctx, user.ID)

	// Create a memo with a single tag
	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "test-memo-1",
		CreatorID:  user.ID,
		Content:    "This is a test memo with #test tag",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"test"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, memo)

	// Test GetUserStats
	userName := fmt.Sprintf("users/%d", user.ID)
	response, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: userName,
	})
	require.NoError(t, err)
	require.NotNil(t, response)

	// Check that the tag count is exactly 1, not 2
	require.Contains(t, response.TagCount, "test")
	require.Equal(t, int32(1), response.TagCount["test"], "Tag count should be 1 for a single occurrence")

	// Create another memo with the same tag
	memo2, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "test-memo-2",
		CreatorID:  user.ID,
		Content:    "Another memo with #test tag",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"test"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, memo2)

	// Test GetUserStats again
	response2, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: userName,
	})
	require.NoError(t, err)
	require.NotNil(t, response2)

	// Check that the tag count is exactly 2, not 3
	require.Contains(t, response2.TagCount, "test")
	require.Equal(t, int32(2), response2.TagCount["test"], "Tag count should be 2 for two occurrences")

	// Test with a new unique tag
	memo3, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "test-memo-3",
		CreatorID:  user.ID,
		Content:    "Memo with #unique tag",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"unique"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, memo3)

	// Test GetUserStats for the new tag
	response3, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: userName,
	})
	require.NoError(t, err)
	require.NotNil(t, response3)

	// Check that the unique tag count is exactly 1
	require.Contains(t, response3.TagCount, "unique")
	require.Equal(t, int32(1), response3.TagCount["unique"], "New tag count should be 1 for first occurrence")

	// The original test tag should still be 2
	require.Contains(t, response3.TagCount, "test")
	require.Equal(t, int32(2), response3.TagCount["test"], "Original tag count should remain 2")
}

func TestListAllUserStats_ExcludesArchivedUsersForAllViewers(t *testing.T) {
	ctx := context.Background()

	for _, tc := range []struct {
		name      string
		callerCtx func(context.Context, *TestService, *store.User) context.Context
	}{
		{
			name: "public",
			callerCtx: func(ctx context.Context, _ *TestService, _ *store.User) context.Context {
				return ctx
			},
		},
		{
			name: "regular",
			callerCtx: func(ctx context.Context, ts *TestService, _ *store.User) context.Context {
				viewer, err := ts.CreateRegularUser(ctx, "regular-stats-viewer")
				require.NoError(t, err)
				return ts.CreateUserContext(ctx, viewer.ID)
			},
		},
		{
			name: "host",
			callerCtx: func(ctx context.Context, ts *TestService, _ *store.User) context.Context {
				host, err := ts.CreateHostUser(ctx, "host-stats-viewer")
				require.NoError(t, err)
				return ts.CreateUserContext(ctx, host.ID)
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ts := NewTestService(t)
			defer ts.Cleanup()

			archivedUser, err := ts.CreateRegularUser(ctx, "archived-stats-"+tc.name)
			require.NoError(t, err)
			for _, visibility := range []store.Visibility{store.Public, store.Protected, store.Private} {
				memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
					UID:        fmt.Sprintf("archived-%s-%s", tc.name, strings.ToLower(string(visibility))),
					CreatorID:  archivedUser.ID,
					Content:    "Archived user memo with #archived-leak tag",
					Visibility: visibility,
					CreatedTs:  time.Now().Unix(),
					UpdatedTs:  time.Now().Unix(),
					Payload: &storepb.MemoPayload{
						Tags: []string{"archived-leak"},
						Property: &storepb.MemoPayload_Property{
							HasCode:            true,
							HasTaskList:        true,
							HasIncompleteTasks: true,
						},
					},
				})
				require.NoError(t, err)
				pinned := true
				require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Pinned: &pinned}))
			}

			archivedStatus := store.Archived
			_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: archivedUser.ID, RowStatus: &archivedStatus})
			require.NoError(t, err)

			response, err := ts.Service.ListAllUserStats(tc.callerCtx(ctx, ts, archivedUser), &v1pb.ListAllUserStatsRequest{})
			require.NoError(t, err)
			for _, stats := range response.Stats {
				require.NotEqual(t, fmt.Sprintf("users/%d/stats", archivedUser.ID), stats.Name)
				require.NotContains(t, stats.TagCount, "archived-leak")
				require.Empty(t, stats.PinnedMemos)
			}
		})
	}
}

func TestGetUserStats_ArchivedTargetReturnsSameNotFoundAsMissing(t *testing.T) {
	ctx := context.Background()

	for _, tc := range []struct {
		name      string
		callerCtx func(context.Context, *TestService) context.Context
	}{
		{
			name: "public",
			callerCtx: func(ctx context.Context, _ *TestService) context.Context {
				return ctx
			},
		},
		{
			name: "regular",
			callerCtx: func(ctx context.Context, ts *TestService) context.Context {
				viewer, err := ts.CreateRegularUser(ctx, "regular-archived-target-viewer")
				require.NoError(t, err)
				return ts.CreateUserContext(ctx, viewer.ID)
			},
		},
		{
			name: "host",
			callerCtx: func(ctx context.Context, ts *TestService) context.Context {
				host, err := ts.CreateHostUser(ctx, "host-archived-target-viewer")
				require.NoError(t, err)
				return ts.CreateUserContext(ctx, host.ID)
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ts := NewTestService(t)
			defer ts.Cleanup()

			archivedUser, err := ts.CreateRegularUser(ctx, "archived-target-"+tc.name)
			require.NoError(t, err)
			archivedStatus := store.Archived
			_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: archivedUser.ID, RowStatus: &archivedStatus})
			require.NoError(t, err)

			callerCtx := tc.callerCtx(ctx, ts)
			_, archivedErr := ts.Service.GetUserStats(callerCtx, &v1pb.GetUserStatsRequest{Name: fmt.Sprintf("users/%d", archivedUser.ID)})
			require.Equal(t, codes.NotFound, status.Code(archivedErr))

			_, missingErr := ts.Service.GetUserStats(callerCtx, &v1pb.GetUserStatsRequest{Name: "users/999999"})
			require.Equal(t, codes.NotFound, status.Code(missingErr))
			require.Equal(t, status.Convert(missingErr).Message(), status.Convert(archivedErr).Message())
		})
	}
}

func TestGetUserStats_HostCanInspectOtherUserPrivateStats(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	host, err := ts.CreateHostUser(ctx, "host-private-stats-viewer")
	require.NoError(t, err)
	regularUser, err := ts.CreateRegularUser(ctx, "regular-private-stats-owner")
	require.NoError(t, err)

	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "regular-private-stats-memo",
		CreatorID:  regularUser.ID,
		Content:    "Private memo with #host-visible-private tag",
		Visibility: store.Private,
		CreatedTs:  time.Now().Unix(),
		UpdatedTs:  time.Now().Unix(),
		Payload: &storepb.MemoPayload{
			Tags: []string{"host-visible-private"},
			Property: &storepb.MemoPayload_Property{
				HasCode: true,
			},
		},
	})
	require.NoError(t, err)
	pinned := true
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Pinned: &pinned}))

	hostCtx := ts.CreateUserContext(ctx, host.ID)
	listResponse, err := ts.Service.ListAllUserStats(hostCtx, &v1pb.ListAllUserStatsRequest{})
	require.NoError(t, err)

	var listStats *v1pb.UserStats
	for _, stats := range listResponse.Stats {
		if stats.Name == fmt.Sprintf("users/%d/stats", regularUser.ID) {
			listStats = stats
			break
		}
	}
	require.NotNil(t, listStats)
	require.Equal(t, int32(1), listStats.TagCount["host-visible-private"])
	require.Equal(t, int32(1), listStats.TotalMemoCount)
	require.Len(t, listStats.PinnedMemos, 1)

	getStats, err := ts.Service.GetUserStats(hostCtx, &v1pb.GetUserStatsRequest{Name: fmt.Sprintf("users/%d", regularUser.ID)})
	require.NoError(t, err)
	require.Equal(t, int32(1), getStats.TagCount["host-visible-private"])
	require.Equal(t, int32(1), getStats.TotalMemoCount)
	require.Len(t, getStats.PinnedMemos, 1)
	require.NotNil(t, getStats.MemoTypeStats)
	require.Equal(t, int32(1), getStats.MemoTypeStats.CodeCount)
}

func TestUserStats_DoesNotTrustStaleUserCacheForArchivedUser(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "stale-cache-archived-user")
	require.NoError(t, err)
	_, err = ts.Store.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "stale-cache-archived-memo",
		CreatorID:  user.ID,
		Content:    "Stale cached user memo with #stale-archived-leak tag",
		Visibility: store.Public,
		CreatedTs:  time.Now().Unix(),
		UpdatedTs:  time.Now().Unix(),
		Payload: &storepb.MemoPayload{
			Tags: []string{"stale-archived-leak"},
		},
	})
	require.NoError(t, err)

	archivedStatus := store.Archived
	_, err = ts.Store.GetDriver().UpdateUser(ctx, &store.UpdateUser{ID: user.ID, RowStatus: &archivedStatus})
	require.NoError(t, err)

	response, err := ts.Service.ListAllUserStats(ctx, &v1pb.ListAllUserStatsRequest{})
	require.NoError(t, err)
	for _, stats := range response.Stats {
		require.NotEqual(t, fmt.Sprintf("users/%d/stats", user.ID), stats.Name)
		require.NotContains(t, stats.TagCount, "stale-archived-leak")
	}

	_, err = ts.Service.GetUserStats(ctx, &v1pb.GetUserStatsRequest{Name: fmt.Sprintf("users/%d", user.ID)})
	require.Equal(t, codes.NotFound, status.Code(err))
}
