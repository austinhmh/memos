package v1

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) ListActivities(ctx context.Context, request *v1pb.ListActivitiesRequest) (*v1pb.ListActivitiesResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	pageSize := normalizePageSize(request.PageSize)
	offset := 0
	if request.PageToken != "" {
		pageToken := &v1pb.PageToken{}
		if err := unmarshalPageToken(request.PageToken, pageToken); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page token")
		}
		if pageToken.Offset < 0 {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page token")
		}
		offset = int(pageToken.Offset)
	}

	limit := pageSize + 1
	findActivity := &store.FindActivity{Limit: &limit, Offset: &offset}
	if !isSuperUser(user) {
		findActivity.CreatorID = &user.ID
	}

	activities, err := s.Store.ListActivities(ctx, findActivity)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list activities: %v", err)
	}

	hasMore := len(activities) == limit
	if hasMore {
		activities = activities[:pageSize]
	}
	var activityMessages []*v1pb.Activity
	for _, activity := range activities {
		activityMessage, err := s.convertActivityFromStore(ctx, activity)
		if err != nil {
			if status.Code(err) == codes.NotFound || status.Code(err) == codes.PermissionDenied || status.Code(err) == codes.Unauthenticated {
				continue
			}
			return nil, status.Errorf(codes.Internal, "failed to convert activity from store: %v", err)
		}
		activityMessages = append(activityMessages, activityMessage)
	}

	nextPageToken := ""
	if hasMore {
		var err error
		nextPageToken, err = getPageToken(pageSize, offset+pageSize)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to generate next page token")
		}
	}

	return &v1pb.ListActivitiesResponse{
		Activities:    activityMessages,
		NextPageToken: nextPageToken,
	}, nil
}

func (s *APIV1Service) GetActivity(ctx context.Context, request *v1pb.GetActivityRequest) (*v1pb.Activity, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	activityID, err := ExtractActivityIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid activity name: %v", err)
	}
	activity, err := s.Store.GetActivity(ctx, &store.FindActivity{
		ID: &activityID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get activity")
	}
	if activity == nil {
		return nil, status.Errorf(codes.NotFound, "activity not found")
	}

	if activity.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	activityMessage, err := s.convertActivityFromStore(ctx, activity)
	if err != nil {
		return nil, err
	}
	return activityMessage, nil
}

// convertActivityFromStore converts a storage-layer activity to an API activity.
// This handles the mapping between internal activity representation and the public API,
// including proper type and level conversions.
func (s *APIV1Service) convertActivityFromStore(ctx context.Context, activity *store.Activity) (*v1pb.Activity, error) {
	payload, err := s.convertActivityPayloadFromStore(ctx, activity.Payload)
	if err != nil {
		return nil, err
	}

	// Convert store activity type to proto enum
	var activityType v1pb.Activity_Type
	switch activity.Type {
	case store.ActivityTypeMemoComment:
		activityType = v1pb.Activity_MEMO_COMMENT
	default:
		activityType = v1pb.Activity_TYPE_UNSPECIFIED
	}

	// Convert store activity level to proto enum
	var activityLevel v1pb.Activity_Level
	switch activity.Level {
	case store.ActivityLevelInfo:
		activityLevel = v1pb.Activity_INFO
	default:
		activityLevel = v1pb.Activity_LEVEL_UNSPECIFIED
	}

	return &v1pb.Activity{
		Name:       fmt.Sprintf("%s%d", ActivityNamePrefix, activity.ID),
		Creator:    fmt.Sprintf("%s%d", UserNamePrefix, activity.CreatorID),
		Type:       activityType,
		Level:      activityLevel,
		CreateTime: timestamppb.New(time.Unix(activity.CreatedTs, 0)),
		Payload:    payload,
	}, nil
}

// convertActivityPayloadFromStore converts a storage-layer activity payload to an API payload.
// This resolves references (e.g., memo IDs) to resource names for the API.
func (s *APIV1Service) convertActivityPayloadFromStore(ctx context.Context, payload *storepb.ActivityPayload) (*v1pb.ActivityPayload, error) {
	v2Payload := &v1pb.ActivityPayload{}
	if payload.MemoComment != nil {
		normalStatus := store.Normal
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{
			ID:               &payload.MemoComment.MemoId,
			RowStatus:        &normalStatus,
			CreatorRowStatus: &normalStatus,
			ExcludeContent:   true,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
		}
		if memo == nil {
			return nil, status.Errorf(codes.NotFound, "memo does not exist")
		}

		relatedMemo, err := s.Store.GetMemo(ctx, &store.FindMemo{
			ID:               &payload.MemoComment.RelatedMemoId,
			RowStatus:        &normalStatus,
			CreatorRowStatus: &normalStatus,
			ExcludeContent:   true,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get related memo: %v", err)
		}
		if relatedMemo == nil {
			return nil, status.Errorf(codes.NotFound, "related memo does not exist")
		}
		if err := s.checkMemoVisibility(ctx, relatedMemo); err != nil {
			return nil, err
		}

		v2Payload.Payload = &v1pb.ActivityPayload_MemoComment{
			MemoComment: &v1pb.ActivityMemoCommentPayload{
				Memo:        fmt.Sprintf("%s%s", MemoNamePrefix, memo.UID),
				RelatedMemo: fmt.Sprintf("%s%s", MemoNamePrefix, relatedMemo.UID),
			},
		}
	}
	return v2Payload, nil
}
