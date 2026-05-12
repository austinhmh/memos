package backup

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

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
		if err := s3.ValidateAttachmentObjectKey(s3Object.Key); err != nil {
			return nil, false, err
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
			if requiresAttachmentBlob(attachment) {
				return errors.Errorf("attachment blob %s is missing", attachment.UID)
			}
			continue
		}
		if err := s.restoreAttachmentBlob(ctx, attachment, content); err != nil {
			return errors.Wrapf(err, "failed to restore attachment blob %s", attachment.UID)
		}
	}
	return nil
}

func requiresAttachmentBlob(attachment *store.Attachment) bool {
	if attachment == nil {
		return false
	}
	return attachment.StorageType == storepb.AttachmentStorageType_LOCAL || attachment.StorageType == storepb.AttachmentStorageType_S3
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
	attachment.Reference = filepath.ToSlash(filepath.Join("assets", fmt.Sprintf("%d_%s_%s", s.now().Unix(), util.GenUUID(), safeRestoreFilename(attachment.Filename))))
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
	s3Object, err := applyRestoreS3Config(attachment, storageSetting.S3Config, s.restoreAttachmentS3Key(attachment))
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

func (s *Service) restoreAttachmentS3Key(attachment *store.Attachment) string {
	return fmt.Sprintf("%s%d_%s_%s", s3.AttachmentObjectPrefix, s.now().Unix(), util.GenUUID(), safeRestoreFilename(attachment.Filename))
}

func safeRestoreFilename(filename string) string {
	filename = filepath.Base(filepath.FromSlash(strings.ReplaceAll(filename, "\\", "/")))
	if filename == "" || filename == "." || filename == string(filepath.Separator) {
		return "attachment"
	}
	return filename
}

func applyRestoreS3Config(attachment *store.Attachment, s3Config *storepb.StorageS3Config, key string) (*storepb.AttachmentPayload_S3Object, error) {
	if attachment == nil {
		return nil, errors.New("attachment is missing")
	}
	if s3Config == nil {
		return nil, errors.New("S3 config is missing")
	}
	key, err := s3.NormalizeAttachmentObjectKey(key)
	if err != nil {
		return nil, err
	}
	s3Object := &storepb.AttachmentPayload_S3Object{
		S3Config: s3Config,
		Key:      key,
	}
	attachment.Reference = key
	attachment.Payload = &storepb.AttachmentPayload{
		Payload: &storepb.AttachmentPayload_S3Object_{
			S3Object: s3Object,
		},
	}
	return s3Object, nil
}
