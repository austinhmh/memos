package backup

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/pkg/errors"

	backupsvc "github.com/usememos/memos/server/backup"
)

type backupService interface {
	UploadArchive(ctx context.Context) (*backupsvc.Object, error)
	DeleteExpiredBackups(ctx context.Context, retentionDays int) ([]string, error)
}

// Runner periodically uploads logical backups and applies retention.
type Runner struct {
	Service backupService
	running atomic.Bool
}

const runnerInterval = 24 * time.Hour

// NewRunner creates a daily logical backup runner.
func NewRunner(service *backupsvc.Service) *Runner {
	return &Runner{Service: service}
}

// Run waits for daily ticks and does not force a backup at startup.
func (r *Runner) Run(ctx context.Context) {
	ticker := time.NewTicker(runnerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := r.RunOnce(ctx); err != nil {
				slog.Warn("daily backup skipped or failed", "error", err)
			}
		case <-ctx.Done():
			return
		}
	}
}

// RunOnce uploads one backup and deletes expired backup objects.
func (r *Runner) RunOnce(ctx context.Context) error {
	if r.Service == nil {
		return errors.New("backup service is required")
	}
	if !r.running.CompareAndSwap(false, true) {
		return errors.New("backup already running")
	}
	defer r.running.Store(false)
	object, err := r.Service.UploadArchive(ctx)
	if err != nil {
		return err
	}
	deleted, err := r.Service.DeleteExpiredBackups(ctx, backupsvc.DefaultRetentionDay)
	if err != nil {
		return err
	}
	slog.Info("daily backup completed", "key", object.Key, "deletedExpired", len(deleted))
	return nil
}
