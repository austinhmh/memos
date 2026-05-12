package v1

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/base"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/plugin/filter"
	"github.com/usememos/memos/plugin/storage/s3"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	// The upload memory buffer is 32 MiB.
	// It should be kept low, so RAM usage doesn't get out of control.
	// This is unrelated to maximum upload size limit, which is now set through system setting.
	MaxUploadBufferSizeBytes = 32 << 20
	MebiByte                 = 1024 * 1024
	// ThumbnailCacheFolder is the folder name where the thumbnail images are stored.
	ThumbnailCacheFolder = ".thumbnail_cache"
)

var SupportedThumbnailMimeTypes = []string{
	"image/png",
	"image/jpeg",
}

func (s *APIV1Service) CreateAttachment(ctx context.Context, request *v1pb.CreateAttachmentRequest) (*v1pb.Attachment, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// Validate required fields
	if request.Attachment == nil {
		return nil, status.Errorf(codes.InvalidArgument, "attachment is required")
	}
	if request.Attachment.Filename == "" {
		return nil, status.Errorf(codes.InvalidArgument, "filename is required")
	}
	if !validateFilename(request.Attachment.Filename) {
		return nil, status.Errorf(codes.InvalidArgument, "filename contains invalid characters or format")
	}
	if request.Attachment.Type == "" {
		ext := filepath.Ext(request.Attachment.Filename)
		mimeType := mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = http.DetectContentType(request.Attachment.Content)
		}
		// ParseMediaType to strip parameters
		mediaType, _, err := mime.ParseMediaType(mimeType)
		if err == nil {
			request.Attachment.Type = mediaType
		}
	}
	if request.Attachment.Type == "" {
		request.Attachment.Type = "application/octet-stream"
	}
	serverDetectedType := detectAttachmentContentType(request.Attachment.Filename, request.Attachment.Content)
	if err := validateAttachmentContentType(request.Attachment.Type, serverDetectedType); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	request.Attachment.Type = serverDetectedType
	if !isValidMimeType(request.Attachment.Type) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid MIME type format")
	}
	if isDangerousMimeType(request.Attachment.Type) {
		return nil, status.Errorf(codes.InvalidArgument, "file type %q is not allowed for security reasons", request.Attachment.Type)
	}

	// Use provided attachment_id or generate a new one
	attachmentUID := strings.TrimSpace(request.AttachmentId)
	if attachmentUID == "" {
		attachmentUID = shortuuid.New()
	} else if !base.UIDMatcher.MatchString(attachmentUID) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment_id format")
	} else if len(attachmentUID) < 8 && !isSuperUser(user) {
		return nil, status.Errorf(codes.InvalidArgument, "custom attachment_id must be at least 8 characters")
	}

	create := &store.Attachment{
		UID:       attachmentUID,
		CreatorID: user.ID,
		Filename:  request.Attachment.Filename,
		Type:      request.Attachment.Type,
	}

	instanceStorageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance storage setting: %v", err)
	}
	size := len(request.Attachment.Content)
	uploadSizeLimit := int(instanceStorageSetting.UploadSizeLimitMb) * MebiByte
	if uploadSizeLimit == 0 {
		uploadSizeLimit = MaxUploadBufferSizeBytes
	}
	if size > uploadSizeLimit {
		return nil, status.Errorf(codes.InvalidArgument, "file size exceeds the limit")
	}
	create.Size = int64(size)
	create.Blob = request.Attachment.Content

	if request.Attachment.Memo != nil {
		memoUID, err := ExtractMemoUIDFromName(*request.Attachment.Memo)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
		}
		normalStatus := store.Normal
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID, RowStatus: &normalStatus, CreatorRowStatus: &normalStatus})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to find memo: %v", err)
		}
		if memo == nil {
			return nil, status.Errorf(codes.NotFound, "memo not found: %s", *request.Attachment.Memo)
		}
		if memo.CreatorID != user.ID && !isSuperUser(user) {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
		create.MemoID = &memo.ID
	}

	if err := SaveAttachmentBlob(ctx, s.Profile, s.Store, create); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save attachment blob: %v", err)
	}

	attachment, err := s.Store.CreateAttachment(ctx, create)
	if err != nil {
		if cleanupErr := cleanupAttachmentBlob(ctx, s.Profile, s.Store, create); cleanupErr != nil {
			return nil, status.Errorf(codes.Internal, "failed to create attachment and cleanup blob")
		}
		return nil, status.Errorf(codes.Internal, "failed to create attachment")
	}

	return convertAttachmentFromStore(attachment), nil
}

func (s *APIV1Service) ListAttachments(ctx context.Context, request *v1pb.ListAttachmentsRequest) (*v1pb.ListAttachmentsResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// Set default page size
	pageSize := int(request.PageSize)
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 1000 {
		pageSize = 1000
	}

	// Parse page token for offset
	offset := 0
	if request.PageToken != "" {
		// Simple implementation: page token is the offset as string
		// In production, you might want to use encrypted tokens
		if parsed, err := fmt.Sscanf(request.PageToken, "%d", &offset); err != nil || parsed != 1 {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page token")
		}
		if offset < 0 {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page token")
		}
	}

	findAttachment := &store.FindAttachment{
		CreatorID: &user.ID,
		Limit:     &pageSize,
		Offset:    &offset,
	}

	// Parse filter if provided
	if request.Filter != "" {
		if err := s.validateAttachmentFilter(ctx, request.Filter); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid filter: %v", err)
		}
		findAttachment.Filters = append(findAttachment.Filters, request.Filter)
	}

	attachments, err := s.Store.ListAttachments(ctx, findAttachment)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list attachments: %v", err)
	}

	response := &v1pb.ListAttachmentsResponse{}

	for _, attachment := range attachments {
		if err := s.ensureAttachmentAccessible(ctx, attachment, user); err != nil {
			if status.Code(err) == codes.NotFound || status.Code(err) == codes.PermissionDenied || status.Code(err) == codes.Unauthenticated {
				continue
			}
			return nil, err
		}
		response.Attachments = append(response.Attachments, convertAttachmentFromStore(attachment))
	}

	// For simplicity, set total size to the number of returned attachments.
	// In a full implementation, you'd want a separate count query
	response.TotalSize = int32(len(response.Attachments))

	// Set next page token if we got the full page size (indicating there might be more)
	if len(attachments) == pageSize {
		response.NextPageToken = fmt.Sprintf("%d", offset+pageSize)
	}

	return response, nil
}

func (s *APIV1Service) GetAttachment(ctx context.Context, request *v1pb.GetAttachmentRequest) (*v1pb.Attachment, error) {
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}

	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}

	if err := s.ensureAttachmentAccessible(ctx, attachment, user); err != nil {
		return nil, err
	}

	return convertAttachmentFromStore(attachment), nil
}

func (s *APIV1Service) UpdateAttachment(ctx context.Context, request *v1pb.UpdateAttachmentRequest) (*v1pb.Attachment, error) {
	if request.Attachment == nil {
		return nil, status.Errorf(codes.InvalidArgument, "attachment is required")
	}
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Attachment.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update mask is required")
	}

	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}

	if attachment.MemoID != nil {
		if err := s.ensureBoundAttachmentMutable(ctx, attachment, user); err != nil {
			return nil, err
		}
	} else if attachment.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	currentTs := time.Now().Unix()
	update := &store.UpdateAttachment{
		ID:        attachment.ID,
		UpdatedTs: &currentTs,
	}
	if attachment.MemoID != nil {
		update.RequireMemoIDMatch = true
		update.ExpectedMemoID = attachment.MemoID
	}
	for _, field := range request.UpdateMask.Paths {
		switch field {
		case "filename":
			if !validateFilename(request.Attachment.Filename) {
				return nil, status.Errorf(codes.InvalidArgument, "filename contains invalid characters or format")
			}
			update.Filename = &request.Attachment.Filename
		default:
			return nil, status.Errorf(codes.InvalidArgument, "invalid update path: %s", field)
		}
	}

	if err := s.Store.UpdateAttachment(ctx, update); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update attachment: %v", err)
	}
	return s.GetAttachment(ctx, &v1pb.GetAttachmentRequest{
		Name: request.Attachment.Name,
	})
}

func (s *APIV1Service) DeleteAttachment(ctx context.Context, request *v1pb.DeleteAttachmentRequest) (*emptypb.Empty, error) {
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{
		UID: &attachmentUID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to find attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}
	if attachment.MemoID != nil {
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: attachment.MemoID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get attachment memo")
		}
		if memo == nil {
			return nil, status.Errorf(codes.NotFound, "attachment not found")
		}
		if memo.CreatorID != user.ID && !isSuperUser(user) {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
	} else if attachment.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	// Delete the attachment from the database.
	deleteAttachment := &store.DeleteAttachment{ID: attachment.ID}
	if attachment.MemoID != nil {
		deleteAttachment.MemoID = attachment.MemoID
	}
	if err := s.Store.DeleteAttachment(ctx, deleteAttachment); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete attachment: %v", err)
	}
	return &emptypb.Empty{}, nil
}

func convertAttachmentFromStore(attachment *store.Attachment) *v1pb.Attachment {
	attachmentMessage := &v1pb.Attachment{
		Name:       fmt.Sprintf("%s%s", AttachmentNamePrefix, attachment.UID),
		CreateTime: timestamppb.New(time.Unix(attachment.CreatedTs, 0)),
		Filename:   attachment.Filename,
		Type:       attachment.Type,
		Size:       attachment.Size,
	}
	if attachment.MemoUID != nil && *attachment.MemoUID != "" {
		memoName := fmt.Sprintf("%s%s", MemoNamePrefix, *attachment.MemoUID)
		attachmentMessage.Memo = &memoName
	}
	if attachment.StorageType == storepb.AttachmentStorageType_EXTERNAL {
		attachmentMessage.ExternalLink = attachment.Reference
	}

	return attachmentMessage
}

// SaveAttachmentBlob save the blob of attachment based on the storage config.
func SaveAttachmentBlob(ctx context.Context, profile *profile.Profile, stores *store.Store, create *store.Attachment) error {
	instanceStorageSetting, err := stores.GetInstanceStorageSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "Failed to find instance storage setting")
	}

	if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_LOCAL {
		filepathTemplate := "assets/{timestamp}_{uuid}_{filename}"
		if instanceStorageSetting.FilepathTemplate != "" {
			filepathTemplate = instanceStorageSetting.FilepathTemplate
		}

		internalPath := filepathTemplate
		if !strings.Contains(internalPath, "{filename}") {
			internalPath = filepath.Join(internalPath, "{filename}")
		}
		internalPath = replaceFilenameWithPathTemplate(internalPath, create.Filename)
		internalPath = filepath.ToSlash(internalPath)

		// Ensure the directory exists.
		osPath, err := util.SafeJoinUnderBase(profile.Data, internalPath)
		if err != nil {
			return errors.Wrap(err, "unsafe attachment path")
		}
		dir := filepath.Dir(osPath)
		if err = os.MkdirAll(dir, 0750); err != nil {
			return errors.Wrap(err, "Failed to create directory")
		}
		if err := util.EnsureParentWithinBase(profile.Data, osPath); err != nil {
			return errors.Wrap(err, "unsafe attachment parent path")
		}

		file, err := os.OpenFile(osPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if err != nil {
			return errors.Wrap(err, "Failed to create file")
		}
		defer file.Close()
		if _, err := file.Write(create.Blob); err != nil {
			return errors.Wrap(err, "Failed to write file")
		}
		if err := file.Close(); err != nil {
			return errors.Wrap(err, "Failed to close file")
		}
		create.Reference = internalPath
		create.Blob = nil
		create.StorageType = storepb.AttachmentStorageType_LOCAL
	} else if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_S3 {
		s3Config := instanceStorageSetting.S3Config
		if s3Config == nil {
			return errors.Errorf("No activated external storage found")
		}
		s3Client, err := s3.NewClient(ctx, s3Config)
		if err != nil {
			return errors.Wrap(err, "Failed to create s3 client")
		}

		filepathTemplate := instanceStorageSetting.FilepathTemplate
		if filepathTemplate == "" {
			filepathTemplate = "assets/{timestamp}_{uuid}_{filename}"
		}
		if !strings.Contains(filepathTemplate, "{filename}") {
			filepathTemplate = filepath.Join(filepathTemplate, "{filename}")
		}
		filepathTemplate = replaceFilenameWithPathTemplate(filepathTemplate, create.Filename)
		key, err := s3.NormalizeAttachmentObjectKeyTemplate(filepathTemplate)
		if err != nil {
			return errors.Wrap(err, "unsafe S3 attachment key")
		}
		key, err = s3Client.UploadObject(ctx, key, create.Type, bytes.NewReader(create.Blob))
		if err != nil {
			return errors.Wrap(err, "Failed to upload via s3 client")
		}

		create.Reference = key
		create.Blob = nil
		create.StorageType = storepb.AttachmentStorageType_S3
		create.Payload = &storepb.AttachmentPayload{
			Payload: &storepb.AttachmentPayload_S3Object_{
				S3Object: &storepb.AttachmentPayload_S3Object{
					Key: key,
				},
			},
		}
	}

	return nil
}

func cleanupAttachmentBlob(ctx context.Context, profile *profile.Profile, stores *store.Store, attachment *store.Attachment) error {
	if attachment == nil {
		return nil
	}
	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		if attachment.Reference == "" {
			return nil
		}
		p, err := util.SafeJoinUnderBase(profile.Data, attachment.Reference)
		if err != nil {
			return err
		}
		if err := util.EnsurePathWithinBase(profile.Data, p); err != nil {
			return err
		}
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
	case storepb.AttachmentStorageType_S3:
		if attachment.Payload == nil {
			return nil
		}
		s3Object := attachment.Payload.GetS3Object()
		if s3Object == nil || s3Object.Key == "" {
			return nil
		}
		if err := s3.ValidateAttachmentObjectKey(s3Object.Key); err != nil {
			return err
		}
		storageSetting, err := stores.GetInstanceStorageSetting(ctx)
		if err != nil {
			return err
		}
		if storageSetting.S3Config == nil {
			return nil
		}
		client, err := s3.NewClient(ctx, storageSetting.S3Config)
		if err != nil {
			return err
		}
		return client.DeleteObject(ctx, s3Object.Key)
	}
	return nil
}

func (s *APIV1Service) GetAttachmentBlob(ctx context.Context, attachment *store.Attachment) ([]byte, error) {
	// For local storage, read the file from the local disk.
	if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
		attachmentPath, err := util.SafeJoinUnderBase(s.Profile.Data, attachment.Reference)
		if err != nil {
			return nil, errors.Wrap(err, "unsafe attachment path")
		}
		if err := util.EnsurePathWithinBase(s.Profile.Data, attachmentPath); err != nil {
			return nil, errors.Wrap(err, "unsafe attachment path")
		}

		file, err := os.Open(attachmentPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, errors.Wrap(err, "file not found")
			}
			return nil, errors.Wrap(err, "failed to open the file")
		}
		defer file.Close()
		blob, err := io.ReadAll(file)
		if err != nil {
			return nil, errors.Wrap(err, "failed to read the file")
		}
		return blob, nil
	}
	// For S3 storage, download the file from S3.
	if attachment.StorageType == storepb.AttachmentStorageType_S3 {
		if attachment.Payload == nil {
			return nil, errors.New("attachment payload is missing")
		}
		s3Object := attachment.Payload.GetS3Object()
		if s3Object == nil {
			return nil, errors.New("S3 object payload is missing")
		}
		if s3Object.Key == "" {
			return nil, errors.New("S3 object key is missing")
		}
		if err := s3.ValidateAttachmentObjectKey(s3Object.Key); err != nil {
			return nil, err
		}

		s3Config := s3Object.S3Config
		if s3Config == nil {
			instanceStorageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
			if err != nil {
				return nil, errors.Wrap(err, "failed to get instance storage setting")
			}
			s3Config = instanceStorageSetting.GetS3Config()
		}
		if s3Config == nil {
			return nil, errors.New("S3 config is missing")
		}

		s3Client, err := s3.NewClient(ctx, s3Config)
		if err != nil {
			return nil, errors.Wrap(err, "failed to create S3 client")
		}

		blob, err := s3Client.GetObject(ctx, s3Object.Key)
		if err != nil {
			return nil, errors.Wrap(err, "failed to get object from S3")
		}
		return blob, nil
	}
	// For database storage, return the blob from the database.
	return attachment.Blob, nil
}

var fileKeyPattern = regexp.MustCompile(`\{[a-z]{1,9}\}`)

func replaceFilenameWithPathTemplate(path, filename string) string {
	t := time.Now()
	path = fileKeyPattern.ReplaceAllStringFunc(path, func(s string) string {
		switch s {
		case "{filename}":
			return filename
		case "{timestamp}":
			return fmt.Sprintf("%d", t.Unix())
		case "{year}":
			return fmt.Sprintf("%d", t.Year())
		case "{month}":
			return fmt.Sprintf("%02d", t.Month())
		case "{day}":
			return fmt.Sprintf("%02d", t.Day())
		case "{hour}":
			return fmt.Sprintf("%02d", t.Hour())
		case "{minute}":
			return fmt.Sprintf("%02d", t.Minute())
		case "{second}":
			return fmt.Sprintf("%02d", t.Second())
		case "{uuid}":
			return util.GenUUID()
		default:
			return s
		}
	})
	return path
}

func validateFilename(filename string) bool {
	if !utf8.ValidString(filename) || len(filename) > 255 {
		return false
	}
	for _, r := range filename {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}

	// Reject path traversal attempts and make sure no additional directories are created
	if !filepath.IsLocal(filename) || strings.ContainsAny(filename, "/\\") {
		return false
	}

	// Reject filenames starting or ending with spaces or periods
	if strings.HasPrefix(filename, " ") || strings.HasSuffix(filename, " ") ||
		strings.HasPrefix(filename, ".") || strings.HasSuffix(filename, ".") {
		return false
	}

	// Reject dangerous file extensions regardless of MIME type
	ext := strings.ToLower(filepath.Ext(filename))
	dangerousExts := map[string]bool{
		".php": true, ".phtml": true, ".php3": true, ".php4": true, ".php5": true,
		".jsp": true, ".jspx": true, ".asp": true, ".aspx": true,
		".exe": true, ".bat": true, ".cmd": true, ".com": true, ".msi": true,
		".sh": true, ".bash": true, ".csh": true, ".ksh": true,
		".py": true, ".pl": true, ".rb": true, ".cgi": true,
		".htaccess": true, ".htpasswd": true,
		".hta": true, ".shtml": true,
	}
	if dangerousExts[ext] {
		return false
	}

	return true
}

func detectAttachmentContentType(filename string, content []byte) string {
	detected := http.DetectContentType(content)
	mediaType, _, err := mime.ParseMediaType(detected)
	if err == nil && mediaType != "" && mediaType != "application/octet-stream" {
		return mediaType
	}
	extType := mime.TypeByExtension(filepath.Ext(filename))
	mediaType, _, err = mime.ParseMediaType(extType)
	if err == nil && mediaType != "" {
		return mediaType
	}
	if mediaType != "" {
		return mediaType
	}
	return "application/octet-stream"
}

func validateAttachmentContentType(clientType string, serverType string) error {
	clientType = strings.ToLower(strings.TrimSpace(clientType))
	serverType = strings.ToLower(strings.TrimSpace(serverType))
	if clientType == "" || serverType == "" || clientType == serverType || serverType == "application/octet-stream" || clientType == "application/octet-stream" {
		return nil
	}
	if strings.HasPrefix(serverType, "text/") && strings.HasPrefix(clientType, "text/") {
		return nil
	}
	if strings.HasPrefix(serverType, "image/jpeg") && clientType == "image/jpg" {
		return nil
	}
	return errors.Errorf("MIME type %q does not match detected content type %q", clientType, serverType)
}

func isValidMimeType(mimeType string) bool {
	// Reject empty or excessively long MIME types
	if mimeType == "" || len(mimeType) > 255 {
		return false
	}

	// MIME type must match the pattern: type/subtype
	// Allow common characters in MIME types per RFC 2045
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}$`, mimeType)
	return matched
}

func (s *APIV1Service) validateAttachmentFilter(ctx context.Context, filterStr string) error {
	if filterStr == "" {
		return errors.New("filter cannot be empty")
	}

	engine, err := filter.DefaultAttachmentEngine()
	if err != nil {
		return err
	}

	var dialect filter.DialectName
	switch s.Profile.Driver {
	case "mysql":
		dialect = filter.DialectMySQL
	case "postgres":
		dialect = filter.DialectPostgres
	default:
		dialect = filter.DialectSQLite
	}

	if _, err := engine.CompileToStatement(ctx, filterStr, filter.RenderOptions{Dialect: dialect}); err != nil {
		return errors.Wrap(err, "failed to compile filter")
	}
	return nil
}

func isDangerousMimeType(mimeType string) bool {
	dangerousTypes := []string{
		"text/html",
		"text/javascript",
		"text/xml",
		"text/x-php",
		"text/x-python",
		"text/x-perl",
		"text/x-ruby",
		"application/javascript",
		"application/x-javascript",
		"application/xhtml+xml",
		"application/xml",
		"image/svg+xml",
		"application/x-msdownload",
		"application/x-executable",
		"application/x-dosexec",
		"application/x-msdos-program",
		"application/x-httpd-php",
		"application/x-php",
		"application/batch",
		"application/x-sh",
		"application/x-csh",
		"application/x-bash",
		"application/x-python",
		"application/x-perl",
		"application/x-ruby",
		"application/hta",
		"application/x-hta",
	}
	lower := strings.ToLower(mimeType)
	for _, t := range dangerousTypes {
		if lower == t {
			return true
		}
	}
	return false
}
