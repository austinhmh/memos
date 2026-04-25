package v1

import (
	"context"
	"slices"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) SetMemoAttachments(ctx context.Context, request *v1pb.SetMemoAttachmentsRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
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
	attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{
		MemoID: &memo.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list attachments")
	}

	requestAttachmentByUID := map[string]*store.Attachment{}
	requestAttachmentUIDs := []string{}
	for _, requestAttachment := range request.Attachments {
		attachmentUID, err := ExtractAttachmentUIDFromName(requestAttachment.Name)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid attachment name: %v", err)
		}
		if _, ok := requestAttachmentByUID[attachmentUID]; ok {
			continue
		}
		tempAttachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get attachment")
		}
		if tempAttachment == nil {
			return nil, status.Errorf(codes.NotFound, "attachment not found")
		}
		if tempAttachment.CreatorID != user.ID && !isSuperUser(user) {
			return nil, status.Errorf(codes.PermissionDenied, "cannot attach resources owned by other users")
		}
		if err := s.ensureAttachmentCanMoveToMemo(ctx, tempAttachment, memo.ID, user); err != nil {
			return nil, err
		}
		requestAttachmentByUID[attachmentUID] = tempAttachment
		requestAttachmentUIDs = append(requestAttachmentUIDs, attachmentUID)
	}

	// Delete attachments that are not in the validated request.
	for _, attachment := range attachments {
		if _, found := requestAttachmentByUID[attachment.UID]; !found {
			if err = s.Store.DeleteAttachment(ctx, &store.DeleteAttachment{
				ID:     int32(attachment.ID),
				MemoID: &memo.ID,
			}); err != nil {
				return nil, status.Errorf(codes.Internal, "failed to delete attachment")
			}
		}
	}

	slices.Reverse(requestAttachmentUIDs)
	// Update attachments' memo_id in the request.
	for index, attachmentUID := range requestAttachmentUIDs {
		tempAttachment := requestAttachmentByUID[attachmentUID]
		expectedMemoID := tempAttachment.MemoID
		updatedTs := time.Now().Unix() + int64(index)
		if err := s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{
			ID:                 tempAttachment.ID,
			MemoID:             &memo.ID,
			UpdatedTs:          &updatedTs,
			RequireMemoIDMatch: true,
			ExpectedMemoID:     expectedMemoID,
		}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to update attachment: %v", err)
		}
	}

	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) ListMemoAttachments(ctx context.Context, request *v1pb.ListMemoAttachmentsRequest) (*v1pb.ListMemoAttachmentsResponse, error) {
	memoUID, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if err := s.checkMemoVisibility(ctx, memo); err != nil {
		return nil, err
	}
	attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{
		MemoID: &memo.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list attachments: %v", err)
	}

	response := &v1pb.ListMemoAttachmentsResponse{
		Attachments: []*v1pb.Attachment{},
	}
	for _, attachment := range attachments {
		response.Attachments = append(response.Attachments, convertAttachmentFromStore(attachment))
	}
	return response, nil
}
