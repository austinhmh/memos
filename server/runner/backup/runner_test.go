package backup

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	backupsvc "github.com/usememos/memos/server/backup"
)

type fakeBackupService struct {
	uploads       atomic.Int32
	retentionDays atomic.Int32
	uploadBlock   chan struct{}
}

func (s *fakeBackupService) UploadArchive(ctx context.Context) (*backupsvc.Object, error) {
	s.uploads.Add(1)
	if s.uploadBlock != nil {
		select {
		case <-s.uploadBlock:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return &backupsvc.Object{Key: "backups/memos-backup-20260102-030405-00000000-0000-0000-0000-000000000000.tar.gz"}, nil
}

func (s *fakeBackupService) DeleteExpiredBackups(_ context.Context, retentionDays int) ([]string, error) {
	s.retentionDays.Store(int32(retentionDays))
	return []string{"backups/old.tar.gz"}, nil
}

func TestRunOnceUsesDefaultRetention(t *testing.T) {
	runner := &Runner{Service: &fakeBackupService{}}

	err := runner.RunOnce(context.Background())

	require.NoError(t, err)
	service := runner.Service.(*fakeBackupService)
	require.Equal(t, int32(1), service.uploads.Load())
	require.Equal(t, int32(backupsvc.DefaultRetentionDay), service.retentionDays.Load())
}

func TestRunOnceRejectsConcurrentRuns(t *testing.T) {
	service := &fakeBackupService{uploadBlock: make(chan struct{})}
	runner := &Runner{Service: service}
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- runner.RunOnce(context.Background())
	}()
	deadline := time.After(2 * time.Second)
	for service.uploads.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for first backup run")
		default:
			time.Sleep(time.Millisecond)
		}
	}

	err := runner.RunOnce(context.Background())

	require.ErrorContains(t, err, "backup already running")
	close(service.uploadBlock)
	require.NoError(t, <-firstDone)
}
