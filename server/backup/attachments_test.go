package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestApplyRestoreS3ConfigRegeneratesTargetKey(t *testing.T) {
	sourceConfig := &storepb.StorageS3Config{Bucket: "source-bucket", Endpoint: "http://source.example"}
	targetConfig := &storepb.StorageS3Config{Bucket: "target-bucket", Endpoint: "http://target.example"}
	attachment := &store.Attachment{
		Reference: "backups/source.tar.gz",
		Payload: &storepb.AttachmentPayload{Payload: &storepb.AttachmentPayload_S3Object_{S3Object: &storepb.AttachmentPayload_S3Object{
			S3Config: sourceConfig,
			Key:      "backups/source.tar.gz",
		}}},
	}

	s3Object, err := applyRestoreS3Config(attachment, targetConfig, "assets/restored.png")

	require.NoError(t, err)
	require.Same(t, targetConfig, s3Object.S3Config)
	require.Equal(t, "assets/restored.png", s3Object.Key)
	require.Equal(t, "assets/restored.png", attachment.Reference)
	require.Equal(t, "assets/restored.png", attachment.Payload.GetS3Object().Key)
}

func TestApplyRestoreS3ConfigRejectsInvalidTarget(t *testing.T) {
	targetConfig := &storepb.StorageS3Config{Bucket: "target-bucket"}

	_, err := applyRestoreS3Config(nil, targetConfig, "assets/photo.png")
	require.ErrorContains(t, err, "attachment is missing")

	_, err = applyRestoreS3Config(&store.Attachment{}, nil, "assets/photo.png")
	require.ErrorContains(t, err, "S3 config is missing")

	_, err = applyRestoreS3Config(&store.Attachment{}, targetConfig, "assets/../backups/archive.tar.gz")
	require.Error(t, err)
}

func TestRestoreAttachmentBlobsRequiresArchiveBlobForManagedStorage(t *testing.T) {
	service := &Service{}
	archive := &Archive{Data: &store.BackupData{Attachments: []*store.Attachment{{
		UID:         "local-missing-blob",
		StorageType: storepb.AttachmentStorageType_LOCAL,
	}}}, Blobs: map[string][]byte{}}

	err := service.restoreAttachmentBlobs(context.Background(), archive)
	require.ErrorContains(t, err, "attachment blob local-missing-blob is missing")
}

func TestRestoreLocalAttachmentBlobRegeneratesReference(t *testing.T) {
	dataDir := t.TempDir()
	service := &Service{
		Profile: &profile.Profile{Data: dataDir},
		now:     func() time.Time { return time.Unix(1700000000, 0) },
	}
	attachment := &store.Attachment{
		UID:       "local-restore",
		Filename:  "photo.png",
		Reference: "../evil/photo.png",
	}

	err := service.restoreLocalAttachmentBlob(attachment, []byte("content"))

	require.NoError(t, err)
	require.Contains(t, attachment.Reference, "assets/")
	require.NotContains(t, attachment.Reference, "..")
	content, err := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(attachment.Reference)))
	require.NoError(t, err)
	require.Equal(t, []byte("content"), content)
}
