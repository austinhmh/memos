package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestSetMemoRelations(t *testing.T) {
	ctx := context.Background()

	t.Run("SetMemoRelations success by memo owner", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create user
		user, err := ts.CreateRegularUser(ctx, "user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		// Create memo1
		memo1, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Content:    "Test memo 1",
				Visibility: apiv1.Visibility_PRIVATE,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo1)

		// Create memo2
		memo2, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
			Memo: &apiv1.Memo{
				Content:    "Test memo 2",
				Visibility: apiv1.Visibility_PRIVATE,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo2)

		// Set memo relations - should succeed
		_, err = ts.Service.SetMemoRelations(userCtx, &apiv1.SetMemoRelationsRequest{
			Name: memo1.Name,
			Relations: []*apiv1.MemoRelation{
				{
					RelatedMemo: &apiv1.MemoRelation_Memo{
						Name: memo2.Name,
					},
					Type: apiv1.MemoRelation_REFERENCE,
				},
			},
		})
		require.NoError(t, err)
	})

	t.Run("SetMemoRelations success by host user", func(t *testing.T) {
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
				Visibility: apiv1.Visibility_PRIVATE,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// Host user can modify relations - should succeed
		_, err = ts.Service.SetMemoRelations(hostCtx, &apiv1.SetMemoRelationsRequest{
			Name:      memo.Name,
			Relations: []*apiv1.MemoRelation{},
		})
		require.NoError(t, err)
	})

	t.Run("SetMemoRelations permission denied for non-owner", func(t *testing.T) {
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
				Visibility: apiv1.Visibility_PRIVATE,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// User2 tries to modify relations - should fail
		_, err = ts.Service.SetMemoRelations(user2Ctx, &apiv1.SetMemoRelationsRequest{
			Name:      memo.Name,
			Relations: []*apiv1.MemoRelation{},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "permission denied")
	})

	t.Run("SetMemoRelations unauthenticated", func(t *testing.T) {
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
				Visibility: apiv1.Visibility_PRIVATE,
			},
		})
		require.NoError(t, err)
		require.NotNil(t, memo)

		// Unauthenticated user tries to modify relations - should fail
		_, err = ts.Service.SetMemoRelations(ctx, &apiv1.SetMemoRelationsRequest{
			Name:      memo.Name,
			Relations: []*apiv1.MemoRelation{},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not authenticated")
	})

	t.Run("SetMemoRelations memo not found", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		// Create user
		user, err := ts.CreateRegularUser(ctx, "user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		// Try to set relations on non-existent memo - should fail
		_, err = ts.Service.SetMemoRelations(userCtx, &apiv1.SetMemoRelationsRequest{
			Name:      "memos/nonexistent-uid-12345",
			Relations: []*apiv1.MemoRelation{},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not found")
	})
}

func TestSetMemoRelationsRejectsInvisibleRelatedMemoAndPreservesExistingRelations(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "relation-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	other, err := ts.CreateRegularUser(ctx, "relation-private-owner")
	require.NoError(t, err)
	otherCtx := ts.CreateUserContext(ctx, other.ID)

	sourceMemo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "source memo", Visibility: apiv1.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	visibleRelatedMemo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "visible related memo", Visibility: apiv1.Visibility_PRIVATE},
	})
	require.NoError(t, err)
	privateRelatedMemo, err := ts.Service.CreateMemo(otherCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "other private related memo", Visibility: apiv1.Visibility_PRIVATE},
	})
	require.NoError(t, err)

	_, err = ts.Service.SetMemoRelations(ownerCtx, &apiv1.SetMemoRelationsRequest{
		Name: sourceMemo.Name,
		Relations: []*apiv1.MemoRelation{{
			RelatedMemo: &apiv1.MemoRelation_Memo{Name: visibleRelatedMemo.Name},
			Type:        apiv1.MemoRelation_REFERENCE,
		}},
	})
	require.NoError(t, err)

	_, err = ts.Service.SetMemoRelations(ownerCtx, &apiv1.SetMemoRelationsRequest{
		Name: sourceMemo.Name,
		Relations: []*apiv1.MemoRelation{{
			RelatedMemo: &apiv1.MemoRelation_Memo{Name: privateRelatedMemo.Name},
			Type:        apiv1.MemoRelation_REFERENCE,
		}},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "related memo not found")

	sourceMemoUID := sourceMemo.Name[len("memos/"):]
	visibleRelatedMemoUID := visibleRelatedMemo.Name[len("memos/"):]
	sourceStoreMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &sourceMemoUID})
	require.NoError(t, err)
	require.NotNil(t, sourceStoreMemo)
	visibleRelatedStoreMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &visibleRelatedMemoUID})
	require.NoError(t, err)
	require.NotNil(t, visibleRelatedStoreMemo)

	relations, err := ts.Store.ListMemoRelations(ctx, &store.FindMemoRelation{MemoID: &sourceStoreMemo.ID})
	require.NoError(t, err)
	require.Len(t, relations, 1)
	require.Equal(t, visibleRelatedStoreMemo.ID, relations[0].RelatedMemoID)
}
