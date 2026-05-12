package s3

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/stretchr/testify/require"
)

type readCloser struct {
	io.Reader
}

func (readCloser) Close() error { return nil }

func TestValidateAttachmentObjectKey(t *testing.T) {
	validKeys := []string{
		"assets/photo.png",
		"assets/nested/photo.png",
	}
	for _, key := range validKeys {
		t.Run("valid/"+key, func(t *testing.T) {
			require.NoError(t, ValidateAttachmentObjectKey(key))
		})
	}

	invalidKeys := []string{
		"",
		"backups/memos-backup.tar.gz",
		"other/photo.png",
		"/assets/photo.png",
		"assets/../backups/archive.tar.gz",
		"assets\\..\\backups\\archive.tar.gz",
		"assets/",
	}
	for _, key := range invalidKeys {
		t.Run("invalid/"+key, func(t *testing.T) {
			require.Error(t, ValidateAttachmentObjectKey(key))
		})
	}
}

func TestNormalizeAttachmentObjectKey(t *testing.T) {
	key, err := NormalizeAttachmentObjectKey("photo.png")
	require.NoError(t, err)
	require.Equal(t, "assets/photo.png", key)

	key, err = NormalizeAttachmentObjectKey("assets/photo.png")
	require.NoError(t, err)
	require.Equal(t, "assets/photo.png", key)

	_, err = NormalizeAttachmentObjectKey("../backups/archive.tar.gz")
	require.Error(t, err)
}

func TestNormalizeAttachmentObjectKeyTemplate(t *testing.T) {
	key, err := NormalizeAttachmentObjectKeyTemplate("assets/photo.png")
	require.NoError(t, err)
	require.Equal(t, "assets/photo.png", key)

	_, err = NormalizeAttachmentObjectKeyTemplate("photo.png")
	require.ErrorContains(t, err, "outside attachment prefix")
}

func TestReadObjectWithLimitErrorsOnOverflow(t *testing.T) {
	content := bytes.Repeat([]byte("a"), int(MaxGetObjectBytes)+1)
	_, err := ReadObjectWithLimit(context.Background(), "assets/too-large.bin", readCloser{Reader: bytes.NewReader(content)})
	require.ErrorContains(t, err, "exceeds size limit")
}

func TestReadObjectWithLimitReadsWithinLimit(t *testing.T) {
	content := []byte("ok")
	got, err := ReadObjectWithLimit(context.Background(), "assets/ok.txt", readCloser{Reader: bytes.NewReader(content)})
	require.NoError(t, err)
	require.Equal(t, content, got)
}
