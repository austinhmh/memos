package backup

import (
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestApplyRestoreS3ConfigUsesTargetInstanceConfig(t *testing.T) {
	sourceConfig := &storepb.StorageS3Config{Bucket: "source-bucket", Endpoint: "http://source.example"}
	targetConfig := &storepb.StorageS3Config{Bucket: "target-bucket", Endpoint: "http://target.example"}
	attachment := &store.Attachment{
		Payload: &storepb.AttachmentPayload{Payload: &storepb.AttachmentPayload_S3Object_{S3Object: &storepb.AttachmentPayload_S3Object{
			S3Config: sourceConfig,
			Key:      "assets/photo.png",
		}}},
	}

	s3Object, err := applyRestoreS3Config(attachment, targetConfig)

	require.NoError(t, err)
	require.Same(t, targetConfig, s3Object.S3Config)
	require.Same(t, targetConfig, attachment.Payload.GetS3Object().S3Config)
	require.Equal(t, "assets/photo.png", s3Object.Key)
}

func TestApplyRestoreS3ConfigRejectsInvalidPayload(t *testing.T) {
	targetConfig := &storepb.StorageS3Config{Bucket: "target-bucket"}

	_, err := applyRestoreS3Config(&store.Attachment{}, targetConfig)
	require.ErrorContains(t, err, "attachment payload is missing")

	_, err = applyRestoreS3Config(&store.Attachment{Payload: &storepb.AttachmentPayload{}}, targetConfig)
	require.ErrorContains(t, err, "S3 object payload is missing")

	_, err = applyRestoreS3Config(&store.Attachment{Payload: &storepb.AttachmentPayload{Payload: &storepb.AttachmentPayload_S3Object_{S3Object: &storepb.AttachmentPayload_S3Object{Key: "assets/photo.png"}}}}, nil)
	require.ErrorContains(t, err, "S3 config is missing")
}
