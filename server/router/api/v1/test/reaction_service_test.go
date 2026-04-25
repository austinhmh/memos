package test

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestDeleteMemoReaction(t *testing.T) {
	ctx := context.Background()

	t.Run("DeleteMemoReaction success by reaction owner", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create user
		user, err := ts.CreateRegularUser(ctx, "user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		// Create memo
		memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Content:    "Test memo",
				Visibility: apiv1.Visibility_PUBLIC,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// Create reaction
		reaction, err := ts.Service.UpsertMemoReaction(userCtx, &apiv1.UpsertMemoReactionRequest{
			Name: memo.Name,
			Reaction: &apiv1.Reaction{
				ContentId:    memo.Name,
				ReactionType: "👍",
			},
		})
		require.NoError(t, err)
		require.NotNil(t, reaction)

		// Delete reaction - should succeed
		_, err = ts.Service.DeleteMemoReaction(userCtx, &apiv1.DeleteMemoReactionRequest{
			Name: reaction.Name,
		})
		require.NoError(t, err)
	})

	t.Run("DeleteMemoReaction success by host user", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create regular user
		regularUser, err := ts.CreateRegularUser(ctx, "user")
		require.NoError(t, err)
		regularUserCtx := ts.CreateUserContext(ctx, regularUser.ID)

		// Create host user
		hostUser, err := ts.CreateHostUser(ctx, "admin")
		require.NoError(t, err)
		hostCtx := ts.CreateUserContext(ctx, hostUser.ID)

		// Create memo by regular user
		memo, err := ts.Service.CreateMemo(regularUserCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Content:    "Test memo",
				Visibility: apiv1.Visibility_PUBLIC,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// Create reaction by regular user
		reaction, err := ts.Service.UpsertMemoReaction(regularUserCtx, &apiv1.UpsertMemoReactionRequest{
			Name: memo.Name,
			Reaction: &apiv1.Reaction{
				ContentId:    memo.Name,
				ReactionType: "👍",
			},
		})
		require.NoError(t, err)
		require.NotNil(t, reaction)

		// Host user can delete reaction - should succeed
		_, err = ts.Service.DeleteMemoReaction(hostCtx, &apiv1.DeleteMemoReactionRequest{
			Name: reaction.Name,
		})
		require.NoError(t, err)
	})

	t.Run("DeleteMemoReaction permission denied for non-owner", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create user1
		user1, err := ts.CreateRegularUser(ctx, "user1")
		require.NoError(t, err)
		user1Ctx := ts.CreateUserContext(ctx, user1.ID)

		// Create user2
		user2, err := ts.CreateRegularUser(ctx, "user2")
		require.NoError(t, err)
		user2Ctx := ts.CreateUserContext(ctx, user2.ID)

		// Create memo by user1
		memo, err := ts.Service.CreateMemo(user1Ctx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Content:    "Test memo",
				Visibility: apiv1.Visibility_PUBLIC,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// Create reaction by user1
		reaction, err := ts.Service.UpsertMemoReaction(user1Ctx, &apiv1.UpsertMemoReactionRequest{
			Name: memo.Name,
			Reaction: &apiv1.Reaction{
				ContentId:    memo.Name,
				ReactionType: "👍",
			},
		})
		require.NoError(t, err)
		require.NotNil(t, reaction)

		// User2 tries to delete reaction - should fail with permission denied
		_, err = ts.Service.DeleteMemoReaction(user2Ctx, &apiv1.DeleteMemoReactionRequest{
			Name: reaction.Name,
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "permission denied")
	})

	t.Run("DeleteMemoReaction unauthenticated", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create user
		user, err := ts.CreateRegularUser(ctx, "user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		// Create memo
		memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Content:    "Test memo",
				Visibility: apiv1.Visibility_PUBLIC,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// Create reaction
		reaction, err := ts.Service.UpsertMemoReaction(userCtx, &apiv1.UpsertMemoReactionRequest{
			Name: memo.Name,
			Reaction: &apiv1.Reaction{
				ContentId:    memo.Name,
				ReactionType: "👍",
			},
		})
		require.NoError(t, err)
		require.NotNil(t, reaction)

		// Unauthenticated user tries to delete reaction - should fail
		_, err = ts.Service.DeleteMemoReaction(ctx, &apiv1.DeleteMemoReactionRequest{
			Name: reaction.Name,
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not authenticated")
	})

	t.Run("DeleteMemoReaction not found returns permission denied", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create user
		user, err := ts.CreateRegularUser(ctx, "user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		// Try to delete non-existent reaction - should fail with permission denied
		// (not "not found" to avoid information disclosure)
		// Use new nested resource format: memos/{memo}/reactions/{reaction}
		_, err = ts.Service.DeleteMemoReaction(userCtx, &apiv1.DeleteMemoReactionRequest{
			Name: "memos/nonexistent/reactions/99999",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "permission denied")
		require.NotContains(t, err.Error(), "not found")
	})
}

func TestListMemoReactionsHidesArchivedCreator(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "reaction-memo-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	activeReactor, err := ts.CreateRegularUser(ctx, "active-reactor")
	require.NoError(t, err)
	activeReactorCtx := ts.CreateUserContext(ctx, activeReactor.ID)
	archivedReactor, err := ts.CreateRegularUser(ctx, "archived-reactor")
	require.NoError(t, err)
	archivedReactorCtx := ts.CreateUserContext(ctx, archivedReactor.ID)

	memo, err := ts.Service.CreateMemo(memoOwnerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "reaction target", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)

	_, err = ts.Service.UpsertMemoReaction(activeReactorCtx, &apiv1.UpsertMemoReactionRequest{
		Name:     memo.Name,
		Reaction: &apiv1.Reaction{ContentId: memo.Name, ReactionType: "👍"},
	})
	require.NoError(t, err)
	_, err = ts.Service.UpsertMemoReaction(archivedReactorCtx, &apiv1.UpsertMemoReactionRequest{
		Name:     memo.Name,
		Reaction: &apiv1.Reaction{ContentId: memo.Name, ReactionType: "❤️"},
	})
	require.NoError(t, err)

	archivedStatus := store.Archived
	_, err = ts.Store.UpdateUser(ctx, &store.UpdateUser{ID: archivedReactor.ID, RowStatus: &archivedStatus})
	require.NoError(t, err)

	list, err := ts.Service.ListMemoReactions(ctx, &apiv1.ListMemoReactionsRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Len(t, list.Reactions, 1)
	require.Equal(t, "users/"+strconv.Itoa(int(activeReactor.ID)), list.Reactions[0].Creator)

	memoWithReactions, err := ts.Service.GetMemo(ctx, &apiv1.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Len(t, memoWithReactions.Reactions, 1)
	require.Equal(t, "👍", memoWithReactions.Reactions[0].ReactionType)
}

func TestDeleteMemoReactionRequiresMatchingMemoPath(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "reaction-path-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "reaction path target", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)
	otherMemo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "reaction wrong path", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)
	reaction, err := ts.Service.UpsertMemoReaction(userCtx, &apiv1.UpsertMemoReactionRequest{
		Name:     memo.Name,
		Reaction: &apiv1.Reaction{ContentId: memo.Name, ReactionType: "👍"},
	})
	require.NoError(t, err)

	wrongMemoPath := strings.Replace(reaction.Name, memo.Name, otherMemo.Name, 1)
	_, err = ts.Service.DeleteMemoReaction(userCtx, &apiv1.DeleteMemoReactionRequest{Name: wrongMemoPath})
	require.Error(t, err)
	require.Contains(t, err.Error(), "permission denied")

	list, err := ts.Service.ListMemoReactions(ctx, &apiv1.ListMemoReactionsRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Len(t, list.Reactions, 1)
}

func TestDeleteMemoReactionRejectsArchivedMemo(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "reaction-archived-memo-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "reaction archived target", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)
	reaction, err := ts.Service.UpsertMemoReaction(userCtx, &apiv1.UpsertMemoReactionRequest{
		Name:     memo.Name,
		Reaction: &apiv1.Reaction{ContentId: memo.Name, ReactionType: "👍"},
	})
	require.NoError(t, err)

	memoUID := memo.Name[len("memos/"):]
	storeMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.NotNil(t, storeMemo)
	archivedStatus := store.Archived
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: storeMemo.ID, RowStatus: &archivedStatus}))

	_, err = ts.Service.DeleteMemoReaction(userCtx, &apiv1.DeleteMemoReactionRequest{Name: reaction.Name})
	require.Error(t, err)
	require.Contains(t, err.Error(), "permission denied")

	contentID := memo.Name
	storedReaction, err := ts.Store.GetReaction(ctx, &store.FindReaction{ContentID: &contentID})
	require.NoError(t, err)
	require.NotNil(t, storedReaction)
}
