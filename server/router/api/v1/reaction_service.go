package v1

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) ListMemoReactions(ctx context.Context, request *v1pb.ListMemoReactionsRequest) (*v1pb.ListMemoReactionsResponse, error) {
	memoUID, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	normalStatus := store.Normal
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if err := s.checkMemoVisibility(ctx, memo); err != nil {
		return nil, err
	}

	reactions, err := s.Store.ListReactions(ctx, &store.FindReaction{
		ContentID:        &request.Name,
		CreatorRowStatus: &normalStatus,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list reactions")
	}

	response := &v1pb.ListMemoReactionsResponse{
		Reactions: []*v1pb.Reaction{},
	}
	for _, reaction := range reactions {
		reactionMessage := convertReactionFromStore(reaction)
		response.Reactions = append(response.Reactions, reactionMessage)
	}
	return response, nil
}

func (s *APIV1Service) UpsertMemoReaction(ctx context.Context, request *v1pb.UpsertMemoReactionRequest) (*v1pb.Reaction, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// Check memo visibility before allowing reaction
	memoUID, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	normalStatus := store.Normal
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if err := s.checkMemoVisibility(ctx, memo); err != nil {
		return nil, err
	}

	// Validate reaction type against allowed list
	instanceMemoRelatedSetting, err := s.Store.GetInstanceMemoRelatedSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance setting")
	}
	if len(instanceMemoRelatedSetting.Reactions) > 0 {
		allowed := false
		for _, r := range instanceMemoRelatedSetting.Reactions {
			if r == request.Reaction.ReactionType {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, status.Errorf(codes.InvalidArgument, "invalid reaction type")
		}
	}

	reaction, err := s.Store.UpsertReaction(ctx, &store.Reaction{
		CreatorID:    user.ID,
		ContentID:    request.Name,
		ReactionType: request.Reaction.ReactionType,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to upsert reaction")
	}

	reactionMessage := convertReactionFromStore(reaction)

	return reactionMessage, nil
}

func (s *APIV1Service) DeleteMemoReaction(ctx context.Context, request *v1pb.DeleteMemoReactionRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	memoUID, reactionID, err := ExtractMemoReactionIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid reaction name: %v", err)
	}
	normalStatus := store.Normal
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	if err := s.checkMemoVisibility(ctx, memo); err != nil {
		if status.Code(err) == codes.NotFound || status.Code(err) == codes.PermissionDenied || status.Code(err) == codes.Unauthenticated {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
		return nil, err
	}
	contentID := fmt.Sprintf("%s%s", MemoNamePrefix, memoUID)

	// Get reaction and check ownership.
	reaction, err := s.Store.GetReaction(ctx, &store.FindReaction{
		ID:               &reactionID,
		ContentID:        &contentID,
		CreatorRowStatus: &normalStatus,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get reaction")
	}
	if reaction == nil {
		// Return permission denied to avoid revealing if reaction exists.
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if reaction.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if err := s.Store.DeleteReaction(ctx, &store.DeleteReaction{
		ID: reactionID,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete reaction")
	}

	return &emptypb.Empty{}, nil
}

func convertReactionFromStore(reaction *store.Reaction) *v1pb.Reaction {
	reactionUID := fmt.Sprintf("%d", reaction.ID)
	// Generate nested resource name: memos/{memo}/reactions/{reaction}
	// reaction.ContentID already contains "memos/{memo}"
	return &v1pb.Reaction{
		Name:         fmt.Sprintf("%s/%s%s", reaction.ContentID, ReactionNamePrefix, reactionUID),
		Creator:      fmt.Sprintf("%s%d", UserNamePrefix, reaction.CreatorID),
		ContentId:    reaction.ContentID,
		ReactionType: reaction.ReactionType,
		CreateTime:   timestamppb.New(time.Unix(reaction.CreatedTs, 0)),
	}
}
