package s3

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/pkg/errors"

	storepb "github.com/usememos/memos/proto/gen/store"
)

const (
	// AttachmentObjectPrefix is the only S3 prefix managed by attachment storage.
	AttachmentObjectPrefix = "assets/"
	// DefaultMaxGetObjectBytes is the fallback maximum object size read into memory.
	DefaultMaxGetObjectBytes int64 = 256 << 20
)

type Client struct {
	Client *s3.Client
	Bucket *string
}

// Object describes an object listed from S3.
type Object struct {
	Key          string
	Size         int64
	LastModified time.Time
}

func NewClient(ctx context.Context, s3Config *storepb.StorageS3Config) (*Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(s3Config.AccessKeyId, s3Config.AccessKeySecret, "")),
		config.WithRegion(s3Config.Region),
	)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load s3 config")
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(s3Config.Endpoint)
		o.UsePathStyle = s3Config.UsePathStyle
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	})
	return &Client{
		Client: client,
		Bucket: aws.String(s3Config.Bucket),
	}, nil
}

// ValidateAttachmentObjectKey validates that key is an application-managed attachment object key.
func ValidateAttachmentObjectKey(key string) error {
	if key == "" {
		return errors.New("S3 object key is missing")
	}
	cleanKey := path.Clean(strings.ReplaceAll(key, "\\", "/"))
	if cleanKey != key || strings.HasPrefix(cleanKey, "../") || strings.HasPrefix(cleanKey, "/") || cleanKey == ".." {
		return fmt.Errorf("unsafe S3 object key %q", key)
	}
	if !strings.HasPrefix(key, AttachmentObjectPrefix) || key == AttachmentObjectPrefix {
		return fmt.Errorf("S3 object key %q is outside attachment prefix", key)
	}
	return nil
}

// NormalizeAttachmentObjectKey converts a restored attachment object key into a safe key.
func NormalizeAttachmentObjectKey(key string) (string, error) {
	key = strings.TrimLeft(strings.ReplaceAll(key, "\\", "/"), "/")
	if key == "" || key == "." {
		return "", errors.New("S3 object key is missing")
	}
	if !strings.HasPrefix(key, AttachmentObjectPrefix) {
		key = path.Join(AttachmentObjectPrefix, key)
	}
	if err := ValidateAttachmentObjectKey(key); err != nil {
		return "", err
	}
	return key, nil
}

// NormalizeAttachmentObjectKeyTemplate validates a configured attachment key template output without prefix fallback.
func NormalizeAttachmentObjectKeyTemplate(key string) (string, error) {
	key = strings.TrimLeft(strings.ReplaceAll(key, "\\", "/"), "/")
	if key == "" || key == "." {
		return "", errors.New("S3 object key is missing")
	}
	if !strings.HasPrefix(key, AttachmentObjectPrefix) {
		return "", fmt.Errorf("S3 object key %q is outside attachment prefix", key)
	}
	if err := ValidateAttachmentObjectKey(key); err != nil {
		return "", err
	}
	return key, nil
}

// UploadObject uploads an object to S3.
func (c *Client) UploadObject(ctx context.Context, key string, fileType string, content io.Reader) (string, error) {
	putInput := s3.PutObjectInput{
		Bucket:      c.Bucket,
		Key:         aws.String(key),
		ContentType: aws.String(fileType),
		Body:        content,
	}
	result, err := c.Client.PutObject(ctx, &putInput)
	if err != nil {
		return "", err
	}

	if result == nil {
		return "", errors.New("failed to upload object")
	}
	return key, nil
}

// PresignGetObject presigns an object in S3.
func (c *Client) PresignGetObject(ctx context.Context, key string) (string, error) {
	presignClient := s3.NewPresignClient(c.Client)
	presignResult, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(*c.Bucket),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		// Set the expiration time of the presigned URL to 5 days.
		// Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
		opts.Expires = time.Duration(5 * 24 * time.Hour)
	})
	if err != nil {
		return "", errors.Wrap(err, "failed to presign put object")
	}
	return presignResult.URL, nil
}

// GetObject retrieves an object from S3.
func (c *Client) GetObject(ctx context.Context, key string) ([]byte, error) {
	return c.GetObjectWithLimit(ctx, key, DefaultMaxGetObjectBytes)
}

// GetObjectWithLimit retrieves an object from S3 with a caller-provided memory limit.
func (c *Client) GetObjectWithLimit(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	reader, err := c.GetObjectStream(ctx, key)
	if err != nil {
		return nil, err
	}
	return ReadObjectWithLimit(ctx, key, reader, maxBytes)
}

// ReadObjectWithLimit reads an object stream and fails if it exceeds maxBytes.
func ReadObjectWithLimit(ctx context.Context, key string, reader io.ReadCloser, maxBytes int64) ([]byte, error) {
	defer reader.Close()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if maxBytes <= 0 {
		maxBytes = DefaultMaxGetObjectBytes
	}
	limitedReader := &io.LimitedReader{R: reader, N: maxBytes + 1}
	content, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}
	if limitedReader.N == 0 {
		return nil, errors.Errorf("S3 object %q exceeds size limit", key)
	}
	return content, nil
}

// GetObjectStream retrieves an object from S3 as a stream.
func (c *Client) GetObjectStream(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := c.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: c.Bucket,
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get object")
	}
	return output.Body, nil
}

// DeleteObject deletes an object in S3.
func (c *Client) DeleteObject(ctx context.Context, key string) error {
	_, err := c.Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: c.Bucket,
		Key:    aws.String(key),
	})
	if err != nil {
		return errors.Wrap(err, "failed to delete object")
	}
	return nil
}

// ListObjects lists objects in S3 matching a prefix.
func (c *Client) ListObjects(ctx context.Context, prefix string) ([]Object, error) {
	paginator := s3.NewListObjectsV2Paginator(c.Client, &s3.ListObjectsV2Input{
		Bucket: c.Bucket,
		Prefix: aws.String(prefix),
	})
	objects := []Object{}
	for paginator.HasMorePages() {
		output, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, errors.Wrap(err, "failed to list objects")
		}
		for _, object := range output.Contents {
			if object.Key == nil || *object.Key == "" {
				continue
			}
			listedObject := Object{Key: *object.Key}
			if object.Size != nil {
				listedObject.Size = *object.Size
			}
			if object.LastModified != nil {
				listedObject.LastModified = *object.LastModified
			}
			objects = append(objects, listedObject)
		}
	}
	return objects, nil
}
