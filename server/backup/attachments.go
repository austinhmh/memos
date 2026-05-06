package backup

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/plugin/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func (s *Service) collectAttachmentBlobs(ctx context.Context, attachments []*store.Attachment) ([]AttachmentBlob, error) {
	blobs := []AttachmentBlob{}
	for _, attachment := range attachments {
		if attachment == nil {
			continue
		}
		content, ok, err := s.readExternalAttachmentBlob(ctx, attachment)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to read attachment blob %s", attachment.UID)
		}
		if !ok {
			continue
		}
		blobs = append(blobs, AttachmentBlob{UID: attachment.UID, Reader: bytes.NewReader(content)})
	}
	return blobs, nil
}

func (s *Service) readExternalAttachmentBlob(ctx context.Context, attachment *store.Attachment) ([]byte, bool, error) {
	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		attachmentPath, err := util.SafeJoinUnderBase(s.Profile.Data, attachment.Reference)
		if err != nil {
			return nil, false, errors.Wrap(err, "unsafe local attachment path")
		}
		if err := util.EnsurePathWithinBase(s.Profile.Data, attachmentPath); err != nil {
			return nil, false, errors.Wrap(err, "unsafe local attachment path")
		}
		content, err := os.ReadFile(attachmentPath)
		if err != nil {
			return nil, false, err
		}
		return content, true, nil
	case storepb.AttachmentStorageType_S3:
		if attachment.Payload == nil {
			return nil, false, errors.New("attachment payload is missing")
		}
		s3Object := attachment.Payload.GetS3Object()
		if s3Object == nil || s3Object.Key == "" {
			return nil, false, errors.New("S3 object payload is missing")
		}
		s3Config := s3Object.S3Config
		if s3Config == nil {
			storageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
			if err != nil {
				return nil, false, err
			}
			s3Config = storageSetting.S3Config
		}
		if s3Config == nil {
			return nil, false, errors.New("S3 config is missing")
		}
		client, err := s3.NewClient(ctx, s3Config)
		if err != nil {
			return nil, false, err
		}
		content, err := client.GetObject(ctx, s3Object.Key)
		if err != nil {
			return nil, false, err
		}
		return content, true, nil
	case storepb.AttachmentStorageType_EXTERNAL:
		return nil, false, nil
	default:
		return nil, false, nil
	}
}

func (s *Service) restoreAttachmentBlobs(ctx context.Context, archive *Archive) error {
	if archive == nil || archive.Data == nil {
		return errors.New("backup archive data is required")
	}
	for _, attachment := range archive.Data.Attachments {
		if attachment == nil {
			continue
		}
		content, ok := archive.Blobs[attachment.UID]
		if !ok {
			continue
		}
		if err := s.restoreAttachmentBlob(ctx, attachment, content); err != nil {
			return errors.Wrapf(err, "failed to restore attachment blob %s", attachment.UID)
		}
	}
	return nil
}

func (s *Service) restoreAttachmentBlob(ctx context.Context, attachment *store.Attachment, content []byte) error {
	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		return s.restoreLocalAttachmentBlob(attachment, content)
	case storepb.AttachmentStorageType_S3:
		return s.restoreS3AttachmentBlob(ctx, attachment, content)
	default:
		_, _ = io.Discard.Write(content)
		return nil
	}
}

func (s *Service) restoreLocalAttachmentBlob(attachment *store.Attachment, content []byte) error {
	attachmentPath, err := util.SafeJoinUnderBase(s.Profile.Data, attachment.Reference)
	if err != nil {
		return errors.Wrap(err, "unsafe local attachment path")
	}
	if err := os.MkdirAll(filepath.Dir(attachmentPath), 0750); err != nil {
		return err
	}
	if err := util.EnsureParentWithinBase(s.Profile.Data, attachmentPath); err != nil {
		return errors.Wrap(err, "unsafe local attachment parent path")
	}
	file, err := os.OpenFile(attachmentPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(content); err != nil {
		return err
	}
	return file.Close()
}

func (s *Service) restoreS3AttachmentBlob(ctx context.Context, attachment *store.Attachment, content []byte) error {
	storageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return err
	}
	s3Object, err := applyRestoreS3Config(attachment, storageSetting.S3Config)
	if err != nil {
		return err
	}
	client, err := s3.NewClient(ctx, s3Object.S3Config)
	if err != nil {
		return err
	}
	_, err = client.UploadObject(ctx, s3Object.Key, attachment.Type, bytes.NewReader(content))
	return err
}

func applyRestoreS3Config(attachment *store.Attachment, s3Config *storepb.StorageS3Config) (*storepb.AttachmentPayload_S3Object, error) {
	if attachment == nil || attachment.Payload == nil {
		return nil, errors.New("attachment payload is missing")
	}
	s3Object := attachment.Payload.GetS3Object()
	if s3Object == nil || s3Object.Key == "" {
		return nil, errors.New("S3 object payload is missing")
	}
	if s3Config == nil {
		return nil, errors.New("S3 config is missing")
	}
	s3Object.S3Config = s3Config
	return s3Object, nil
}
