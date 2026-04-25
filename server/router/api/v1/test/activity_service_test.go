package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func TestListActivitiesSkipsStaleOrHiddenMemoCommentPayloads(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "activity-memo-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	commenter, err := ts.CreateRegularUser(ctx, "activity-commenter")
	require.NoError(t, err)
	commenterCtx := ts.CreateUserContext(ctx, commenter.ID)

	parentMemo, err := ts.Service.CreateMemo(memoOwnerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "activity parent", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)
	_, err = ts.Service.CreateMemoComment(commenterCtx, &apiv1.CreateMemoCommentRequest{
		Name: parentMemo.Name,
		Comment: &apiv1.Memo{
			Content:    "visible comment",
			Visibility: apiv1.Visibility_PUBLIC,
		},
	})
	require.NoError(t, err)

	activities, err := ts.Service.ListActivities(commenterCtx, &apiv1.ListActivitiesRequest{})
	require.NoError(t, err)
	require.Len(t, activities.Activities, 1)
	require.Equal(t, parentMemo.Name, activities.Activities[0].GetPayload().GetMemoComment().GetRelatedMemo())

	privateVisibility := store.Private
	memoUID := parentMemo.Name[len("memos/"):]
	storeMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.NotNil(t, storeMemo)
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: storeMemo.ID, Visibility: &privateVisibility}))

	activities, err = ts.Service.ListActivities(commenterCtx, &apiv1.ListActivitiesRequest{})
	require.NoError(t, err)
	require.Empty(t, activities.Activities)
}

func TestGetActivityHidesStaleMemoCommentPayload(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	memoOwner, err := ts.CreateRegularUser(ctx, "stale-activity-memo-owner")
	require.NoError(t, err)
	memoOwnerCtx := ts.CreateUserContext(ctx, memoOwner.ID)
	commenter, err := ts.CreateRegularUser(ctx, "stale-activity-commenter")
	require.NoError(t, err)
	commenterCtx := ts.CreateUserContext(ctx, commenter.ID)

	parentMemo, err := ts.Service.CreateMemo(memoOwnerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Content: "stale parent", Visibility: apiv1.Visibility_PUBLIC},
	})
	require.NoError(t, err)
	_, err = ts.Service.CreateMemoComment(commenterCtx, &apiv1.CreateMemoCommentRequest{
		Name: parentMemo.Name,
		Comment: &apiv1.Memo{
			Content:    "stale comment",
			Visibility: apiv1.Visibility_PUBLIC,
		},
	})
	require.NoError(t, err)

	activities, err := ts.Service.ListActivities(commenterCtx, &apiv1.ListActivitiesRequest{})
	require.NoError(t, err)
	require.Len(t, activities.Activities, 1)

	archivedStatus := store.Archived
	memoUID := parentMemo.Name[len("memos/"):]
	storeMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.NotNil(t, storeMemo)
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: storeMemo.ID, RowStatus: &archivedStatus}))

	_, err = ts.Service.GetActivity(commenterCtx, &apiv1.GetActivityRequest{Name: activities.Activities[0].Name})
	require.Error(t, err)
	require.Contains(t, err.Error(), "does not exist")
}
