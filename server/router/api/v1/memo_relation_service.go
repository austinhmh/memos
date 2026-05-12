package v1

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) SetMemoRelations(ctx context.Context, request *v1pb.SetMemoRelationsRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
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
	if memo.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	pendingRelations := []*store.MemoRelation{}
	for _, relation := range request.Relations {
		if relation.Memo != nil && relation.Memo.Name != "" && relation.Memo.Name != request.Name {
			return nil, status.Errorf(codes.InvalidArgument, "relation memo must match request name")
		}
		if relation.RelatedMemo == nil || relation.RelatedMemo.Name == "" {
			return nil, status.Errorf(codes.InvalidArgument, "related memo is required")
		}
		// Ignore reflexive relations.
		if request.Name == relation.RelatedMemo.Name {
			continue
		}
		// Ignore comment relations as there's no need to update a comment's relation.
		// Inserting/Deleting a comment is handled elsewhere.
		if relation.Type == v1pb.MemoRelation_COMMENT {
			continue
		}
		relatedMemoUID, err := ExtractMemoUIDFromName(relation.RelatedMemo.Name)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid related memo name: %v", err)
		}
		relatedMemo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &relatedMemoUID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get related memo")
		}
		if relatedMemo == nil {
			return nil, status.Errorf(codes.NotFound, "related memo not found")
		}
		if err := s.checkMemoVisibility(ctx, relatedMemo); err != nil {
			if status.Code(err) == codes.PermissionDenied {
				return nil, status.Errorf(codes.NotFound, "related memo not found")
			}
			return nil, err
		}
		pendingRelations = append(pendingRelations, &store.MemoRelation{
			MemoID:        memo.ID,
			RelatedMemoID: relatedMemo.ID,
			Type:          convertMemoRelationTypeToStore(relation.Type),
		})
	}

	referenceType := store.MemoRelationReference
	// Delete all reference relations after validating the complete replacement set.
	if err := s.Store.DeleteMemoRelation(ctx, &store.DeleteMemoRelation{
		MemoID: &memo.ID,
		Type:   &referenceType,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete memo relation")
	}

	for _, relation := range pendingRelations {
		if _, err := s.Store.UpsertMemoRelation(ctx, relation); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to upsert memo relation")
		}
	}

	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) ListMemoRelations(ctx context.Context, request *v1pb.ListMemoRelationsRequest) (*v1pb.ListMemoRelationsResponse, error) {
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

	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	var memoFilter string
	if currentUser == nil {
		memoFilter = `visibility == "PUBLIC"`
	} else {
		memoFilter = fmt.Sprintf(`creator_id == %d || visibility in ["PUBLIC", "PROTECTED"]`, currentUser.ID)
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
	relationFind := &store.FindMemoRelation{
		MemoID:                  &memo.ID,
		MemoFilter:              &memoFilter,
		MemoRowStatus:           &normalStatus,
		MemoCreatorRowStatus:    &normalStatus,
		RelatedRowStatus:        &normalStatus,
		RelatedCreatorRowStatus: &normalStatus,
		Limit:                   &limit,
		Offset:                  &offset,
	}
	relationList := []*v1pb.MemoRelation{}
	tempList, err := s.Store.ListMemoRelations(ctx, relationFind)
	if err != nil {
		return nil, err
	}
	hasMore := len(tempList) == limit
	if hasMore {
		tempList = tempList[:pageSize]
	}
	for _, raw := range tempList {
		relation, err := s.convertMemoRelationFromStore(ctx, raw)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to convert memo relation")
		}
		relationList = append(relationList, relation)
	}
	if !hasMore {
		relationFind = &store.FindMemoRelation{
			RelatedMemoID:           &memo.ID,
			MemoFilter:              &memoFilter,
			MemoRowStatus:           &normalStatus,
			MemoCreatorRowStatus:    &normalStatus,
			RelatedRowStatus:        &normalStatus,
			RelatedCreatorRowStatus: &normalStatus,
			Limit:                   &limit,
			Offset:                  &offset,
		}
		tempList, err = s.Store.ListMemoRelations(ctx, relationFind)
		if err != nil {
			return nil, err
		}
		hasMore = len(tempList) == limit
		if hasMore {
			tempList = tempList[:pageSize]
		}
		for _, raw := range tempList {
			relation, err := s.convertMemoRelationFromStore(ctx, raw)
			if err != nil {
				return nil, status.Errorf(codes.Internal, "failed to convert memo relation")
			}
			relationList = append(relationList, relation)
		}
	}

	nextPageToken := ""
	if hasMore {
		var err error
		nextPageToken, err = getPageToken(pageSize, offset+pageSize)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to generate next page token")
		}
	}

	response := &v1pb.ListMemoRelationsResponse{
		Relations:     relationList,
		NextPageToken: nextPageToken,
	}
	return response, nil
}

func (s *APIV1Service) convertMemoRelationFromStore(ctx context.Context, memoRelation *store.MemoRelation) (*v1pb.MemoRelation, error) {
	normalStatus := store.Normal
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoRelation.MemoID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
	if err != nil {
		return nil, err
	}
	if memo == nil {
		return nil, errors.New("memo not found")
	}
	memoSnippet, err := s.getMemoContentSnippet(memo.Content)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get memo content snippet")
	}
	relatedMemo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoRelation.RelatedMemoID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
	if err != nil {
		return nil, err
	}
	if relatedMemo == nil {
		return nil, errors.New("related memo not found")
	}
	relatedMemoSnippet, err := s.getMemoContentSnippet(relatedMemo.Content)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get related memo content snippet")
	}
	return &v1pb.MemoRelation{
		Memo: &v1pb.MemoRelation_Memo{
			Name:    fmt.Sprintf("%s%s", MemoNamePrefix, memo.UID),
			Snippet: memoSnippet,
		},
		RelatedMemo: &v1pb.MemoRelation_Memo{
			Name:    fmt.Sprintf("%s%s", MemoNamePrefix, relatedMemo.UID),
			Snippet: relatedMemoSnippet,
		},
		Type: convertMemoRelationTypeFromStore(memoRelation.Type),
	}, nil
}

func convertMemoRelationTypeFromStore(relationType store.MemoRelationType) v1pb.MemoRelation_Type {
	switch relationType {
	case store.MemoRelationReference:
		return v1pb.MemoRelation_REFERENCE
	case store.MemoRelationComment:
		return v1pb.MemoRelation_COMMENT
	default:
		return v1pb.MemoRelation_TYPE_UNSPECIFIED
	}
}

func convertMemoRelationTypeToStore(relationType v1pb.MemoRelation_Type) store.MemoRelationType {
	switch relationType {
	case v1pb.MemoRelation_COMMENT:
		return store.MemoRelationComment
	default:
		return store.MemoRelationReference
	}
}
