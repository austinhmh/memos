package store

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/base"
	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/plugin/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
)

type Attachment struct {
	// ID is the system generated unique identifier for the attachment.
	ID int32
	// UID is the user defined unique identifier for the attachment.
	UID string

	// Standard fields
	CreatorID int32
	CreatedTs int64
	UpdatedTs int64

	// Domain specific fields
	Filename    string
	Blob        []byte
	Type        string
	Size        int64
	StorageType storepb.AttachmentStorageType
	Reference   string
	Payload     *storepb.AttachmentPayload

	// The related memo ID.
	MemoID *int32

	// Composed field
	MemoUID *string
}

type FindAttachment struct {
	GetBlob        bool
	ID             *int32
	UID            *string
	CreatorID      *int32
	Filename       *string
	FilenameSearch *string
	MemoID         *int32
	MemoIDList     []int32
	HasRelatedMemo bool
	StorageType    *storepb.AttachmentStorageType
	Filters        []string
	Limit          *int
	Offset         *int
}

type UpdateAttachment struct {
	ID        int32
	UID       *string
	UpdatedTs *int64
	Filename  *string
	MemoID    *int32
	Reference *string
	Payload   *storepb.AttachmentPayload

	RequireMemoIDMatch bool
	ExpectedMemoID     *int32
}

type DeleteAttachment struct {
	ID     int32
	MemoID *int32
}

func (s *Store) CreateAttachment(ctx context.Context, create *Attachment) (*Attachment, error) {
	if !base.UIDMatcher.MatchString(create.UID) {
		return nil, errors.New("invalid uid")
	}
	return s.driver.CreateAttachment(ctx, create)
}

func (s *Store) ListAttachments(ctx context.Context, find *FindAttachment) ([]*Attachment, error) {
	// Set default limits to prevent loading too many attachments at once
	if find.Limit == nil && find.GetBlob {
		// When fetching blobs, we should be especially careful with limits
		defaultLimit := 10
		find.Limit = &defaultLimit
	} else if find.Limit == nil {
		// Even without blobs, let's default to a reasonable limit
		defaultLimit := 100
		find.Limit = &defaultLimit
	}

	return s.driver.ListAttachments(ctx, find)
}

func (s *Store) GetAttachment(ctx context.Context, find *FindAttachment) (*Attachment, error) {
	attachments, err := s.ListAttachments(ctx, find)
	if err != nil {
		return nil, err
	}

	if len(attachments) == 0 {
		return nil, nil
	}

	return attachments[0], nil
}

func (s *Store) UpdateAttachment(ctx context.Context, update *UpdateAttachment) error {
	if update.UID != nil && !base.UIDMatcher.MatchString(*update.UID) {
		return errors.New("invalid uid")
	}
	if err := s.driver.UpdateAttachment(ctx, update); err != nil {
		return err
	}
	if update.RequireMemoIDMatch {
		find := &FindAttachment{ID: &update.ID}
		if update.MemoID != nil {
			find.MemoID = update.MemoID
		} else if update.ExpectedMemoID != nil {
			find.MemoID = update.ExpectedMemoID
		}
		attachment, err := s.GetAttachment(ctx, find)
		if err != nil {
			return err
		}
		if attachment == nil {
			return errors.New("attachment not found")
		}
	}
	return nil
}

func deleteThumbnailCache(dataDir, uid string) {
	thumbnailCacheFolder, err := util.SafeJoinUnderBase(dataDir, ".thumbnail_cache")
	if err != nil {
		slog.Warn("Failed to resolve thumbnail cache folder", "uid", uid, "error", err)
		return
	}
	matches, err := filepath.Glob(filepath.Join(thumbnailCacheFolder, uid+".*"))
	if err != nil {
		slog.Warn("Failed to list thumbnail cache files", "uid", uid, "error", err)
		return
	}
	for _, match := range matches {
		if err := util.EnsurePathWithinBase(dataDir, match); err != nil {
			slog.Warn("Skipping unsafe thumbnail cache path", "uid", uid, "path", match, "error", err)
			continue
		}
		if err := os.Remove(match); err != nil && !os.IsNotExist(err) {
			slog.Warn("Failed to remove thumbnail cache file", "uid", uid, "path", match, "error", err)
		}
	}
}

func (s *Store) DeleteAttachment(ctx context.Context, delete *DeleteAttachment) error {
	find := &FindAttachment{ID: &delete.ID}
	if delete.MemoID != nil {
		find.MemoID = delete.MemoID
	}
	attachment, err := s.GetAttachment(ctx, find)
	if err != nil {
		return errors.Wrap(err, "failed to get attachment")
	}
	if attachment == nil {
		return errors.New("attachment not found")
	}

	slog.Debug("Deleting attachment",
		"attachment_id", delete.ID,
		"attachment_uid", attachment.UID,
		"storage_type", attachment.StorageType,
		"filename", attachment.Filename)

	if err := s.driver.DeleteAttachment(ctx, delete); err != nil {
		return errors.Wrap(err, "failed to delete attachment from database")
	}

	if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
		if err := func() error {
			p, err := util.SafeJoinUnderBase(s.profile.Data, attachment.Reference)
			if err != nil {
				return errors.Wrap(err, "unsafe local file path")
			}
			if err := util.EnsurePathWithinBase(s.profile.Data, p); err != nil {
				return errors.Wrap(err, "unsafe local file path")
			}
			slog.Debug("Deleting local file",
				"attachment_id", attachment.ID,
				"path", p)
			err = os.Remove(p)
			if err != nil {
				if os.IsNotExist(err) {
					slog.Warn("Local attachment file already missing; continuing with DB deletion",
						"attachment_id", attachment.ID,
						"attachment_uid", attachment.UID,
						"reference", attachment.Reference,
						"path", p)
					return nil
				}
				return errors.Wrap(err, "failed to delete local file")
			}
			return nil
		}(); err != nil {
			slog.Warn("Failed to delete local attachment file (continuing with DB deletion)",
				"attachment_id", attachment.ID,
				"attachment_uid", attachment.UID,
				"reference", attachment.Reference,
				"error", err)
		}
		deleteThumbnailCache(s.profile.Data, attachment.UID)
	} else if attachment.StorageType == storepb.AttachmentStorageType_S3 {
		if err := func() error {
			if attachment.Payload == nil {
				return errors.Errorf("attachment payload is missing")
			}
			s3ObjectPayload := attachment.Payload.GetS3Object()
			if s3ObjectPayload == nil {
				return errors.Errorf("No s3 object found")
			}
			if err := s3.ValidateAttachmentObjectKey(s3ObjectPayload.Key); err != nil {
				return err
			}
			instanceStorageSetting, err := s.GetInstanceStorageSetting(ctx)
			if err != nil {
				return errors.Wrap(err, "failed to get instance storage setting")
			}
			s3Config := s3ObjectPayload.S3Config
			if s3Config == nil {
				if instanceStorageSetting.S3Config == nil {
					return errors.Errorf("S3 config is not found")
				}
				s3Config = instanceStorageSetting.S3Config
			}

			slog.Info("Deleting S3 object",
				"attachment_id", attachment.ID,
				"s3_key", s3ObjectPayload.Key,
				"bucket", s3Config.Bucket)

			s3Client, err := s3.NewClient(ctx, s3Config)
			if err != nil {
				return errors.Wrap(err, "Failed to create s3 client")
			}
			if err := s3Client.DeleteObject(ctx, s3ObjectPayload.Key); err != nil {
				return errors.Wrap(err, "Failed to delete s3 object")
			}
			return nil
		}(); err != nil {
			var s3Key string
			if attachment.Payload != nil && attachment.Payload.GetS3Object() != nil {
				s3Key = attachment.Payload.GetS3Object().Key
			}
			slog.Warn("Failed to delete S3 object (continuing with DB deletion)",
				"attachment_id", attachment.ID,
				"attachment_uid", attachment.UID,
				"reference", attachment.Reference,
				"s3_key", s3Key,
				"error", err)
		}
	}

	slog.Info("Successfully deleted attachment",
		"attachment_id", delete.ID,
		"storage_type", attachment.StorageType)

	return nil
}
