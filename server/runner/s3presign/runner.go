package s3presign

import (
	"context"
	"log/slog"
	"time"

	"github.com/usememos/memos/plugin/storage/s3"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

type Runner struct {
	Store *store.Store
}

func NewRunner(store *store.Store) *Runner {
	return &Runner{
		Store: store,
	}
}

// Schedule runner every 12 hours.
const runnerInterval = time.Hour * 12

func (r *Runner) Run(ctx context.Context) {
	ticker := time.NewTicker(runnerInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			r.RunOnce(ctx)
		case <-ctx.Done():
			return
		}
	}
}

func (r *Runner) RunOnce(ctx context.Context) {
	r.CheckAndPresign(ctx)
}

func (r *Runner) CheckAndPresign(ctx context.Context) {
	instanceStorageSetting, err := r.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return
	}

	s3StorageType := storepb.AttachmentStorageType_S3
	// Limit attachments to a reasonable batch size
	const batchSize = 100
	offset := 0

	for {
		limit := batchSize
		attachments, err := r.Store.ListAttachments(ctx, &store.FindAttachment{
			GetBlob:     false,
			StorageType: &s3StorageType,
			Limit:       &limit,
			Offset:      &offset,
		})
		if err != nil {
			slog.Error("Failed to list attachments for presigning", "error", err)
			return
		}

		// Break if no more attachments
		if len(attachments) == 0 {
			break
		}

		// Process batch of attachments.
		for _, attachment := range attachments {
			if attachment.Payload == nil {
				continue
			}
			s3ObjectPayload := attachment.Payload.GetS3Object()
			if s3ObjectPayload == nil {
				continue
			}

			if s3ObjectPayload.S3Config == nil {
				s3ObjectPayload.S3Config = instanceStorageSetting.GetS3Config()
			}
			if err := s3.ValidateAttachmentObjectKey(s3ObjectPayload.Key); err != nil {
				slog.Error("Skipping attachment with unsafe S3 key", "attachmentID", attachment.ID, "error", err)
				continue
			}
			if s3ObjectPayload.S3Config == nil {
				slog.Error("S3 config is not found", "attachmentID", attachment.ID)
				continue
			}

			if err := r.Store.UpdateAttachment(ctx, &store.UpdateAttachment{
				ID: attachment.ID,
				Payload: &storepb.AttachmentPayload{
					Payload: &storepb.AttachmentPayload_S3Object_{
						S3Object: s3ObjectPayload,
					},
				},
			}); err != nil {
				slog.Error("Failed to update attachment", "error", err, "attachmentID", attachment.ID)
				continue
			}
		}

		slog.Info("Checked batch of S3 attachments", "batchSize", len(attachments))

		// Move to next batch
		offset += len(attachments)
	}
}
