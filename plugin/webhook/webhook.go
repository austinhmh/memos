package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/pkg/errors"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

var (
	timeout        = 30 * time.Second
	maxResponseSize int64 = 1 * 1024 * 1024 // 1 MiB
)

type WebhookRequestPayload struct {
	URL          string   `json:"url"`
	ActivityType string   `json:"activityType"`
	Creator      string   `json:"creator"`
	Memo         *v1pb.Memo `json:"memo"`
}

var safeTransport = &http.Transport{
	DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, errors.Wrap(err, "invalid address")
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, errors.Wrap(err, "DNS resolution failed")
		}
		for _, ip := range ips {
			if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
				return nil, errors.Errorf("webhook target resolves to internal/private IP %s", ip.String())
			}
		}
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	},
}

// Post posts the message to webhook endpoint.
func Post(requestPayload *WebhookRequestPayload) error {
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return errors.Wrapf(err, "failed to marshal webhook request to %s", requestPayload.URL)
	}

	req, err := http.NewRequest("POST", requestPayload.URL, bytes.NewBuffer(body))
	if err != nil {
		return errors.Wrapf(err, "failed to construct webhook request to %s", requestPayload.URL)
	}

	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{
		Timeout:   timeout,
		Transport: safeTransport,
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.Wrapf(err, "failed to post webhook to %s", requestPayload.URL)
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return errors.Wrapf(err, "failed to read webhook response from %s", requestPayload.URL)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return errors.Errorf("failed to post webhook %s, status code: %d, response body: %s", requestPayload.URL, resp.StatusCode, b)
	}

	response := &struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}{}
	if err := json.Unmarshal(b, response); err != nil {
		return errors.Wrapf(err, "failed to unmarshal webhook response from %s", requestPayload.URL)
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
			// Since we're in a goroutine, we can only log the error
			slog.Warn("Failed to dispatch webhook asynchronously",
				slog.String("url", requestPayload.URL),
				slog.String("activityType", requestPayload.ActivityType),
				slog.Any("err", err))
		}
	}()
}
