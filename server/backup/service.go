package backup

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"regexp"
	"sort"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/plugin/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	BackupObjectPrefix  = "backups/"
	DefaultRetentionDay = 30
	backupContentType   = "application/gzip"
)

var backupObjectKeyPattern = regexp.MustCompile("^backups/memos-backup-[0-9]{8}-[0-9]{6}(-[a-f0-9-]{36})?\\.tar\\.gz$")

type Object struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
}

type Service struct {
	Profile *profile.Profile
	Store   *store.Store
	now     func() time.Time
}

type Option func(*Service)

func WithNow(now func() time.Time) Option {
	return func(s *Service) {
		s.now = now
	}
}

func NewService(profile *profile.Profile, stores *store.Store, options ...Option) *Service {
	service := &Service{Profile: profile, Store: stores, now: time.Now}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) BuildArchive(ctx context.Context, writer io.Writer) (*Manifest, error) {
	data, err := s.Store.ExportBackupData(ctx)
	if err != nil {
		return nil, err
	}
	blobs, err := s.collectAttachmentBlobs(ctx, data.Attachments)
	if err != nil {
		return nil, err
	}
	manifest := NewManifest(s.Profile, data, s.now())
	if err := WriteTarGz(ctx, writer, manifest, data, blobs); err != nil {
		return nil, err
	}
	return manifest, nil
}

func (s *Service) UploadArchive(ctx context.Context) (*Object, error) {
	var archive bytes.Buffer
	if _, err := s.BuildArchive(ctx, &archive); err != nil {
		return nil, err
	}
	client, err := s.backupS3Client(ctx)
	if err != nil {
		return nil, err
	}
	key := backupObjectKey(s.now())
	uploadedKey, err := client.UploadObject(ctx, key, backupContentType, bytes.NewReader(archive.Bytes()))
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload backup archive")
	}
	return &Object{Key: uploadedKey, Size: int64(archive.Len()), LastModified: s.now().UTC()}, nil
}

func (s *Service) ListBackups(ctx context.Context) ([]*Object, error) {
	client, err := s.backupS3Client(ctx)
	if err != nil {
		return nil, err
	}
	objects, err := client.ListObjects(ctx, BackupObjectPrefix)
	if err != nil {
		return nil, err
	}
	backups := []*Object{}
	for _, object := range objects {
		if !isBackupObjectKey(object.Key) {
			continue
		}
		backups = append(backups, &Object{Key: object.Key, Size: object.Size, LastModified: object.LastModified})
	}
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].LastModified.After(backups[j].LastModified)
	})
	return backups, nil
}

func (s *Service) RestoreArchive(ctx context.Context, reader io.Reader) error {
	empty, err := s.Store.IsEmptyForRestore(ctx)
	if err != nil {
		return err
	}
	if !empty {
		return errors.New("restore target is not empty")
	}
	archive, err := ReadTarGz(ctx, reader)
	if err != nil {
		return err
	}
	if err := s.restoreAttachmentBlobs(ctx, archive); err != nil {
		return err
	}
	return s.Store.ImportBackupData(ctx, archive.Data)
}

func (s *Service) DeleteExpiredBackups(ctx context.Context, retentionDays int) ([]string, error) {
	if retentionDays <= 0 {
		retentionDays = DefaultRetentionDay
	}
	client, err := s.backupS3Client(ctx)
	if err != nil {
		return nil, err
	}
	objects, err := client.ListObjects(ctx, BackupObjectPrefix)
	if err != nil {
		return nil, err
	}
	cutoff := s.now().AddDate(0, 0, -retentionDays)
	deleted := []string{}
	for _, object := range objects {
		if !isBackupObjectKey(object.Key) || object.LastModified.IsZero() || !object.LastModified.Before(cutoff) {
			continue
		}
		if err := client.DeleteObject(ctx, object.Key); err != nil {
			return deleted, err
		}
		deleted = append(deleted, object.Key)
	}
	return deleted, nil
}

func (s *Service) backupS3Client(ctx context.Context) (*s3.Client, error) {
	storageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return nil, err
	}
	if storageSetting.StorageType != storepb.InstanceStorageSetting_S3 || storageSetting.S3Config == nil {
		return nil, errors.New("S3 storage is not configured")
	}
	return s3.NewClient(ctx, storageSetting.S3Config)
}

func backupObjectKey(now time.Time) string {
	return fmt.Sprintf("%smemos-backup-%s-%s.tar.gz", BackupObjectPrefix, now.UTC().Format("20060102-150405"), util.GenUUID())
}

func isBackupObjectKey(key string) bool {
	return backupObjectKeyPattern.MatchString(key)
}
