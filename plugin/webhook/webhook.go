package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/netutil"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

var (
	timeout               = 30 * time.Second
	maxResponseSize int64 = 1 * 1024 * 1024 // 1 MiB
)

type WebhookRequestPayload struct {
	URL          string     `json:"url"`
	ActivityType string     `json:"activityType"`
	Creator      string     `json:"creator"`
	Memo         *v1pb.Memo `json:"memo"`
}

func validateWebhookURL(rawURL string) (*url.URL, error) {
	validated, err := netutil.ValidateExternalURL(context.Background(), rawURL)
	if err != nil {
		return nil, errors.Wrap(err, "invalid webhook URL")
	}
	return validated.URL, nil
}

func safeURLForLog(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "<invalid>"
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// Post posts the message to webhook endpoint.
func Post(requestPayload *WebhookRequestPayload) error {
	if requestPayload == nil {
		return errors.New("webhook request payload is required")
	}
	targetURL, err := validateWebhookURL(requestPayload.URL)
	if err != nil {
		return err
	}
	logURL := safeURLForLog(targetURL.String())
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return errors.Wrapf(err, "failed to marshal webhook request to %s", logURL)
	}

	req, err := http.NewRequest("POST", targetURL.String(), bytes.NewBuffer(body))
	if err != nil {
		return errors.Wrapf(err, "failed to construct webhook request to %s", logURL)
	}

	req.Header.Set("Content-Type", "application/json")
	client := netutil.NewExternalHTTPClient(timeout)
	resp, err := client.Do(req)
	if err != nil {
		return errors.Wrapf(err, "failed to post webhook to %s", logURL)
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return errors.Wrapf(err, "failed to read webhook response from %s", logURL)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return errors.Errorf("failed to post webhook %s, status code: %d", logURL, resp.StatusCode)
	}

	response := &struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}{}
	if err := json.Unmarshal(b, response); err != nil {
		return errors.Wrapf(err, "failed to unmarshal webhook response from %s", logURL)
	}

	if response.Code != 0 {
		return errors.Errorf("receive error code sent by webhook server, code %d, msg: %s", response.Code, response.Message)
	}

	return nil
}

// PostAsync posts the message to webhook endpoint asynchronously.
// It spawns a new goroutine to handle the request and does not wait for the response.
func PostAsync(requestPayload *WebhookRequestPayload) {
	go func() {
		if err := Post(requestPayload); err != nil {
			logURL := "<nil>"
			activityType := ""
			if requestPayload != nil {
				logURL = safeURLForLog(requestPayload.URL)
				activityType = requestPayload.ActivityType
			}
			// Since we're in a goroutine, we can only log the error
			slog.Warn("Failed to dispatch webhook asynchronously",
				slog.String("url", logURL),
				slog.String("activityType", activityType),
				slog.Any("err", err))
		}
	}()
}
