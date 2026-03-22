package v1

import (
	"context"
	"encoding/base64"
	"unicode"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

const (
	// DefaultPageSize is the default page size for requests.
	DefaultPageSize = 10
	// MaxPageSize is the maximum page size for requests.
	MaxPageSize = 1000
)

func convertStateFromStore(rowStatus store.RowStatus) v1pb.State {
	switch rowStatus {
	case store.Normal:
		return v1pb.State_NORMAL
	case store.Archived:
		return v1pb.State_ARCHIVED
	default:
		return v1pb.State_STATE_UNSPECIFIED
	}
}

func convertStateToStore(state v1pb.State) store.RowStatus {
	switch state {
	case v1pb.State_ARCHIVED:
		return store.Archived
	default:
		return store.Normal
	}
}

func getPageToken(limit int, offset int) (string, error) {
	return marshalPageToken(&v1pb.PageToken{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
}

func marshalPageToken(pageToken *v1pb.PageToken) (string, error) {
	b, err := proto.Marshal(pageToken)
	if err != nil {
		return "", errors.Wrapf(err, "failed to marshal page token")
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func unmarshalPageToken(s string, pageToken *v1pb.PageToken) error {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return errors.Wrapf(err, "failed to decode page token")
	}
	if err := proto.Unmarshal(b, pageToken); err != nil {
		return errors.Wrapf(err, "failed to unmarshal page token")
	}
	return nil
}

func isSuperUser(user *store.User) bool {
	return user.Role == store.RoleAdmin || user.Role == store.RoleHost
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters long")
	}
	// bcrypt silently truncates at 72 bytes
	if len(password) > 72 {
		return errors.New("password must not exceed 72 bytes")
	}
	var hasUpper, hasLower, hasDigit bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}
	if !hasUpper {
		return errors.New("password must contain at least one uppercase letter")
	}
	if !hasLower {
		return errors.New("password must contain at least one lowercase letter")
	}
	if !hasDigit {
		return errors.New("password must contain at least one digit")
	}
	return nil
}

// checkMemoVisibility checks if the current user has permission to view the memo.
func (s *APIV1Service) checkMemoVisibility(ctx context.Context, memo *store.Memo) error {
	if memo.Visibility == store.Public {
		return nil
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if memo.Visibility == store.Private && memo.CreatorID != user.ID && !isSuperUser(user) {
		return status.Errorf(codes.PermissionDenied, "permission denied")
	}
	return nil
}
