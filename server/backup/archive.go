package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	// FormatVersion is the current logical backup archive format version.
	FormatVersion = 1
	// CompressionTarGzipBest records the exact lossless high-compression format.
	CompressionTarGzipBest = "tar+gzip.best"
	manifestPath           = "manifest.json"
)

var dataFilePaths = map[string]string{
	"system_setting": "data/system_setting.json",
	"user":           "data/users.json",
	"user_setting":   "data/user_settings.json",
	"idp":            "data/idps.json",
	"memo":           "data/memos.json",
	"attachment":     "data/attachments.json",
	"memo_relation":  "data/memo_relations.json",
	"reaction":       "data/reactions.json",
	"inbox":          "data/inboxes.json",
	"activity":       "data/activities.json",
}

var protoJSONUnmarshaler = protojson.UnmarshalOptions{
	AllowPartial:   true,
	DiscardUnknown: true,
}

// Manifest describes the contents of a logical backup archive.
type Manifest struct {
	Version             int                  `json:"version"`
	SchemaVersion       string               `json:"schemaVersion"`
	CreatedAt           time.Time            `json:"createdAt"`
	Driver              string               `json:"driver"`
	Compression         string               `json:"compression"`
	EntityCounts        map[string]int       `json:"entityCounts"`
	Files               map[string]FileEntry `json:"files"`
	AttachmentChecksums map[string]FileEntry `json:"attachmentChecksums"`
}

// FileEntry records file size and sha256 checksum.
type FileEntry struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// AttachmentBlob contains one attachment binary payload for the archive.
type AttachmentBlob struct {
	UID    string
	Reader io.Reader
}

// Archive is a decoded logical backup archive.
type Archive struct {
	Manifest *Manifest
	Data     *store.BackupData
	Blobs    map[string][]byte
}

type userSettingJSON struct {
	UserID               int32                                    `json:"userId"`
	Key                  storepb.UserSetting_Key                  `json:"key"`
	General              *storepb.GeneralUserSetting              `json:"general,omitempty"`
	Shortcuts            *storepb.ShortcutsUserSetting            `json:"shortcuts,omitempty"`
	Webhooks             *storepb.WebhooksUserSetting             `json:"webhooks,omitempty"`
	RefreshTokens        *storepb.RefreshTokensUserSetting        `json:"refreshTokens,omitempty"`
	PersonalAccessTokens *storepb.PersonalAccessTokensUserSetting `json:"personalAccessTokens,omitempty"`
}

type attachmentJSON struct {
	ID          int32                         `json:"id"`
	UID         string                        `json:"uid"`
	CreatorID   int32                         `json:"creatorId"`
	CreatedTs   int64                         `json:"createdTs"`
	UpdatedTs   int64                         `json:"updatedTs"`
	Filename    string                        `json:"filename"`
	Blob        []byte                        `json:"blob,omitempty"`
	Type        string                        `json:"type"`
	Size        int64                         `json:"size"`
	StorageType storepb.AttachmentStorageType `json:"storageType"`
	Reference   string                        `json:"reference"`
	Payload     json.RawMessage               `json:"payload,omitempty"`
	MemoID      *int32                        `json:"memoId,omitempty"`
	MemoUID     *string                       `json:"memoUid,omitempty"`
}

// NewManifest creates a manifest with all stable defaults populated.
func NewManifest(profile *profile.Profile, data *store.BackupData, createdAt time.Time) *Manifest {
	driver := ""
	schemaVersion := ""
	if profile != nil {
		driver = profile.Driver
		schemaVersion = profile.Version
	}
	return &Manifest{
		Version:             FormatVersion,
		SchemaVersion:       schemaVersion,
		CreatedAt:           createdAt.UTC(),
		Driver:              driver,
		Compression:         CompressionTarGzipBest,
		EntityCounts:        data.EntityCounts(),
		Files:               map[string]FileEntry{},
		AttachmentChecksums: map[string]FileEntry{},
	}
}

// WriteTarGz writes a standard tar.gz archive using gzip.BestCompression.
func WriteTarGz(ctx context.Context, writer io.Writer, manifest *Manifest, data *store.BackupData, blobs []AttachmentBlob) error {
	if manifest == nil {
		return errors.New("manifest is required")
	}
	if data == nil {
		return errors.New("backup data is required")
	}
	if err := validateManifestBasics(manifest); err != nil {
		return err
	}

	gzipWriter, err := gzip.NewWriterLevel(writer, gzip.BestCompression)
	if err != nil {
		return err
	}
	defer gzipWriter.Close()
	tarWriter := tar.NewWriter(gzipWriter)
	defer tarWriter.Close()

	manifest.Files = map[string]FileEntry{}
	manifest.AttachmentChecksums = map[string]FileEntry{}

	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["system_setting"], data.SystemSettings); err != nil {
		return err
	}
	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["user"], data.Users); err != nil {
		return err
	}
	if err := writeUserSettingsEntry(ctx, tarWriter, manifest, dataFilePaths["user_setting"], data.UserSettings); err != nil {
		return err
	}
	if err := writeProtoJSONSliceEntry(ctx, tarWriter, manifest, dataFilePaths["idp"], identityProvidersToMessages(data.IdentityProviders)); err != nil {
		return err
	}
	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["memo"], data.Memos); err != nil {
		return err
	}
	if err := writeAttachmentsEntry(ctx, tarWriter, manifest, dataFilePaths["attachment"], data.Attachments); err != nil {
		return err
	}
	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["memo_relation"], data.MemoRelations); err != nil {
		return err
	}
	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["reaction"], data.Reactions); err != nil {
		return err
	}
	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["inbox"], data.Inboxes); err != nil {
		return err
	}
	if err := writeJSONEntry(ctx, tarWriter, manifest, dataFilePaths["activity"], data.Activities); err != nil {
		return err
	}

	for _, blob := range blobs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if blob.UID == "" {
			return errors.New("attachment blob uid is required")
		}
		blobPath := AttachmentBlobPath(blob.UID)
		entry, err := writeStreamEntry(tarWriter, blobPath, blob.Reader)
		if err != nil {
			return err
		}
		manifest.AttachmentChecksums[blob.UID] = entry
	}

	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := writeBytesEntry(tarWriter, manifestPath, manifestBytes); err != nil {
		return err
	}
	return nil
}

// ReadTarGz reads, validates, and decodes a logical backup archive.
func ReadTarGz(ctx context.Context, reader io.Reader) (*Archive, error) {
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, errors.Wrap(err, "invalid gzip backup")
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)

	files := map[string][]byte{}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errors.Wrap(err, "invalid tar backup")
		}
		if header.FileInfo().IsDir() {
			continue
		}
		if err := validateArchivePath(header.Name); err != nil {
			return nil, err
		}
		content, err := io.ReadAll(tarReader)
		if err != nil {
			return nil, err
		}
		files[header.Name] = content
	}

	manifestBytes, ok := files[manifestPath]
	if !ok {
		return nil, errors.New("backup manifest is missing")
	}
	manifest := &Manifest{}
	if err := json.Unmarshal(manifestBytes, manifest); err != nil {
		return nil, errors.Wrap(err, "invalid manifest")
	}
	if err := validateManifestBasics(manifest); err != nil {
		return nil, err
	}

	data := &store.BackupData{}
	if err := readJSONFile(files, manifest, dataFilePaths["system_setting"], &data.SystemSettings); err != nil {
		return nil, err
	}
	if err := readJSONFile(files, manifest, dataFilePaths["user"], &data.Users); err != nil {
		return nil, err
	}
	if err := readUserSettingsFile(files, manifest, dataFilePaths["user_setting"], &data.UserSettings); err != nil {
		return nil, err
	}
	if err := readProtoJSONSliceFile(files, manifest, dataFilePaths["idp"], func() proto.Message { return &storepb.IdentityProvider{} }, func(message proto.Message) {
		data.IdentityProviders = append(data.IdentityProviders, message.(*storepb.IdentityProvider))
	}); err != nil {
		return nil, err
	}
	if err := readJSONFile(files, manifest, dataFilePaths["memo"], &data.Memos); err != nil {
		return nil, err
	}
	if err := readAttachmentsFile(files, manifest, dataFilePaths["attachment"], &data.Attachments); err != nil {
		return nil, err
	}
	if err := readJSONFile(files, manifest, dataFilePaths["memo_relation"], &data.MemoRelations); err != nil {
		return nil, err
	}
	if err := readJSONFile(files, manifest, dataFilePaths["reaction"], &data.Reactions); err != nil {
		return nil, err
	}
	if err := readJSONFile(files, manifest, dataFilePaths["inbox"], &data.Inboxes); err != nil {
		return nil, err
	}
	if err := readJSONFile(files, manifest, dataFilePaths["activity"], &data.Activities); err != nil {
		return nil, err
	}
	if err := validateEntityCounts(manifest, data); err != nil {
		return nil, err
	}

	blobs := map[string][]byte{}
	for uid, entry := range manifest.AttachmentChecksums {
		blobPath := AttachmentBlobPath(uid)
		content, ok := files[blobPath]
		if !ok {
			return nil, errors.Errorf("attachment blob %s is missing", uid)
		}
		if err := validateFileEntry(blobPath, content, entry); err != nil {
			return nil, err
		}
		blobs[uid] = content
	}
	return &Archive{Manifest: manifest, Data: data, Blobs: blobs}, nil
}

// AttachmentBlobPath returns the stable tar path for an attachment payload.
func AttachmentBlobPath(uid string) string {
	return path.Join("blobs/attachments", uid)
}

func writeJSONEntry(ctx context.Context, tarWriter *tar.Writer, manifest *Manifest, name string, value any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	content, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	entry, err := writeBytesEntryWithChecksum(tarWriter, name, content)
	if err != nil {
		return err
	}
	manifest.Files[name] = entry
	return nil
}

func writeProtoJSONSliceEntry(ctx context.Context, tarWriter *tar.Writer, manifest *Manifest, name string, values []proto.Message) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	content, err := marshalProtoJSONSlice(values)
	if err != nil {
		return err
	}
	entry, err := writeBytesEntryWithChecksum(tarWriter, name, content)
	if err != nil {
		return err
	}
	manifest.Files[name] = entry
	return nil
}

func writeUserSettingsEntry(ctx context.Context, tarWriter *tar.Writer, manifest *Manifest, name string, values []*storepb.UserSetting) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	content, err := marshalUserSettingsJSON(values)
	if err != nil {
		return err
	}
	entry, err := writeBytesEntryWithChecksum(tarWriter, name, content)
	if err != nil {
		return err
	}
	manifest.Files[name] = entry
	return nil
}

func writeAttachmentsEntry(ctx context.Context, tarWriter *tar.Writer, manifest *Manifest, name string, values []*store.Attachment) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	content, err := marshalAttachmentsJSON(values)
	if err != nil {
		return err
	}
	entry, err := writeBytesEntryWithChecksum(tarWriter, name, content)
	if err != nil {
		return err
	}
	manifest.Files[name] = entry
	return nil
}

func marshalUserSettingsJSON(values []*storepb.UserSetting) ([]byte, error) {
	items := make([]*userSettingJSON, 0, len(values))
	for _, value := range values {
		items = append(items, userSettingToJSON(value))
	}
	return json.MarshalIndent(items, "", "  ")
}

func marshalAttachmentsJSON(values []*store.Attachment) ([]byte, error) {
	items := make([]*attachmentJSON, 0, len(values))
	for _, value := range values {
		item, err := attachmentToJSON(value)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return json.MarshalIndent(items, "", "  ")
}

func marshalProtoJSONSlice(values []proto.Message) ([]byte, error) {
	builder := &strings.Builder{}
	builder.WriteString("[\n")
	for i, value := range values {
		if i > 0 {
			builder.WriteString(",\n")
		}
		if value == nil {
			builder.WriteString("  null")
			continue
		}
		content, err := protojson.MarshalOptions{Indent: "  "}.Marshal(value)
		if err != nil {
			return nil, err
		}
		builder.WriteString(indentJSON(content, "  "))
	}
	builder.WriteString("\n]")
	return []byte(builder.String()), nil
}

func indentJSON(content []byte, prefix string) string {
	lines := strings.Split(string(content), "\n")
	for i, line := range lines {
		if line != "" {
			lines[i] = prefix + line
		}
	}
	return strings.Join(lines, "\n")
}

func writeStreamEntry(tarWriter *tar.Writer, name string, reader io.Reader) (FileEntry, error) {
	content, err := io.ReadAll(reader)
	if err != nil {
		return FileEntry{}, err
	}
	return writeBytesEntryWithChecksum(tarWriter, name, content)
}

func writeBytesEntryWithChecksum(tarWriter *tar.Writer, name string, content []byte) (FileEntry, error) {
	entry := checksum(content)
	return entry, writeBytesEntry(tarWriter, name, content)
}

func writeBytesEntry(tarWriter *tar.Writer, name string, content []byte) error {
	if err := validateArchivePath(name); err != nil {
		return err
	}
	header := &tar.Header{
		Name:    name,
		Mode:    0600,
		Size:    int64(len(content)),
		ModTime: time.Unix(0, 0).UTC(),
	}
	if err := tarWriter.WriteHeader(header); err != nil {
		return err
	}
	_, err := tarWriter.Write(content)
	return err
}

func readJSONFile(files map[string][]byte, manifest *Manifest, name string, target any) error {
	content, err := readCheckedFile(files, manifest, name)
	if err != nil {
		return err
	}
	return json.Unmarshal(content, target)
}

func readProtoJSONSliceFile(files map[string][]byte, manifest *Manifest, name string, newMessage func() proto.Message, appendMessage func(proto.Message)) error {
	content, err := readCheckedFile(files, manifest, name)
	if err != nil {
		return err
	}
	var raws []json.RawMessage
	if err := json.Unmarshal(content, &raws); err != nil {
		return err
	}
	for _, raw := range raws {
		if string(raw) == "null" {
			appendMessage(nil)
			continue
		}
		message := newMessage()
		if err := protoJSONUnmarshaler.Unmarshal(raw, message); err != nil {
			return err
		}
		appendMessage(message)
	}
	return nil
}

func readUserSettingsFile(files map[string][]byte, manifest *Manifest, name string, target *[]*storepb.UserSetting) error {
	content, err := readCheckedFile(files, manifest, name)
	if err != nil {
		return err
	}
	var raws []json.RawMessage
	if err := json.Unmarshal(content, &raws); err != nil {
		return err
	}
	settings := []*storepb.UserSetting{}
	for _, raw := range raws {
		if string(raw) == "null" {
			settings = append(settings, nil)
			continue
		}
		settingJSON := &userSettingJSON{}
		if err := json.Unmarshal(raw, settingJSON); err != nil {
			return err
		}
		setting := &storepb.UserSetting{UserId: settingJSON.UserID, Key: settingJSON.Key}
		switch setting.Key {
		case storepb.UserSetting_GENERAL:
			setting.Value = &storepb.UserSetting_General{General: settingJSON.General}
		case storepb.UserSetting_SHORTCUTS:
			setting.Value = &storepb.UserSetting_Shortcuts{Shortcuts: settingJSON.Shortcuts}
		case storepb.UserSetting_WEBHOOKS:
			setting.Value = &storepb.UserSetting_Webhooks{Webhooks: settingJSON.Webhooks}
		case storepb.UserSetting_REFRESH_TOKENS:
			setting.Value = &storepb.UserSetting_RefreshTokens{RefreshTokens: settingJSON.RefreshTokens}
		case storepb.UserSetting_PERSONAL_ACCESS_TOKENS:
			setting.Value = &storepb.UserSetting_PersonalAccessTokens{PersonalAccessTokens: settingJSON.PersonalAccessTokens}
		default:
			return errors.Errorf("unsupported user setting key: %v", setting.Key)
		}
		settings = append(settings, setting)
	}
	*target = settings
	return nil
}

func readAttachmentsFile(files map[string][]byte, manifest *Manifest, name string, target *[]*store.Attachment) error {
	content, err := readCheckedFile(files, manifest, name)
	if err != nil {
		return err
	}
	var items []*attachmentJSON
	if err := json.Unmarshal(content, &items); err != nil {
		return err
	}
	attachments := make([]*store.Attachment, 0, len(items))
	for _, item := range items {
		attachment, err := attachmentFromJSON(item)
		if err != nil {
			return err
		}
		attachments = append(attachments, attachment)
	}
	*target = attachments
	return nil
}

func readCheckedFile(files map[string][]byte, manifest *Manifest, name string) ([]byte, error) {
	content, ok := files[name]
	if !ok {
		return nil, errors.Errorf("backup data file %s is missing", name)
	}
	entry, ok := manifest.Files[name]
	if !ok {
		return nil, errors.Errorf("manifest entry for %s is missing", name)
	}
	if err := validateFileEntry(name, content, entry); err != nil {
		return nil, err
	}
	return content, nil
}

func validateManifestBasics(manifest *Manifest) error {
	if manifest.Version != FormatVersion {
		return errors.Errorf("unsupported backup manifest version %d", manifest.Version)
	}
	if manifest.Compression != CompressionTarGzipBest {
		return errors.Errorf("unsupported backup compression %q", manifest.Compression)
	}
	if manifest.EntityCounts == nil {
		return errors.New("manifest entityCounts is required")
	}
	if manifest.Files == nil {
		return errors.New("manifest files is required")
	}
	if manifest.AttachmentChecksums == nil {
		manifest.AttachmentChecksums = map[string]FileEntry{}
	}
	return nil
}

func validateEntityCounts(manifest *Manifest, data *store.BackupData) error {
	actual := data.EntityCounts()
	for key, expected := range manifest.EntityCounts {
		if actual[key] != expected {
			return errors.Errorf("entity count mismatch for %s: manifest=%d actual=%d", key, expected, actual[key])
		}
	}
	return nil
}

func validateFileEntry(name string, content []byte, entry FileEntry) error {
	actual := checksum(content)
	if actual.Size != entry.Size {
		return errors.Errorf("file %s size mismatch", name)
	}
	if actual.SHA256 != entry.SHA256 {
		return errors.Errorf("file %s sha256 mismatch", name)
	}
	return nil
}

func checksum(content []byte) FileEntry {
	sum := sha256.Sum256(content)
	return FileEntry{Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:])}
}

func validateArchivePath(name string) error {
	if name == "" {
		return errors.New("archive path is empty")
	}
	clean := path.Clean(name)
	if clean != name || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || clean == ".." {
		return fmt.Errorf("unsafe archive path %q", name)
	}
	if name != manifestPath && !strings.HasPrefix(name, "data/") && !strings.HasPrefix(name, "blobs/attachments/") {
		return fmt.Errorf("unexpected archive path %q", name)
	}
	return nil
}

func userSettingToJSON(setting *storepb.UserSetting) *userSettingJSON {
	if setting == nil {
		return nil
	}
	message := &userSettingJSON{UserID: setting.UserId, Key: setting.Key}
	switch setting.Key {
	case storepb.UserSetting_GENERAL:
		message.General = setting.GetGeneral()
	case storepb.UserSetting_SHORTCUTS:
		message.Shortcuts = setting.GetShortcuts()
	case storepb.UserSetting_WEBHOOKS:
		message.Webhooks = setting.GetWebhooks()
	case storepb.UserSetting_REFRESH_TOKENS:
		message.RefreshTokens = setting.GetRefreshTokens()
	case storepb.UserSetting_PERSONAL_ACCESS_TOKENS:
		message.PersonalAccessTokens = setting.GetPersonalAccessTokens()
	}
	return message
}

func attachmentToJSON(attachment *store.Attachment) (*attachmentJSON, error) {
	if attachment == nil {
		return nil, nil
	}
	item := &attachmentJSON{
		ID:          attachment.ID,
		UID:         attachment.UID,
		CreatorID:   attachment.CreatorID,
		CreatedTs:   attachment.CreatedTs,
		UpdatedTs:   attachment.UpdatedTs,
		Filename:    attachment.Filename,
		Blob:        attachment.Blob,
		Type:        attachment.Type,
		Size:        attachment.Size,
		StorageType: attachment.StorageType,
		Reference:   attachment.Reference,
		MemoID:      attachment.MemoID,
		MemoUID:     attachment.MemoUID,
	}
	if attachment.Payload != nil {
		payload, err := protojson.MarshalOptions{Indent: "  "}.Marshal(attachment.Payload)
		if err != nil {
			return nil, err
		}
		item.Payload = payload
	}
	return item, nil
}

func attachmentFromJSON(item *attachmentJSON) (*store.Attachment, error) {
	if item == nil {
		return nil, nil
	}
	attachment := &store.Attachment{
		ID:          item.ID,
		UID:         item.UID,
		CreatorID:   item.CreatorID,
		CreatedTs:   item.CreatedTs,
		UpdatedTs:   item.UpdatedTs,
		Filename:    item.Filename,
		Blob:        item.Blob,
		Type:        item.Type,
		Size:        item.Size,
		StorageType: item.StorageType,
		Reference:   item.Reference,
		MemoID:      item.MemoID,
		MemoUID:     item.MemoUID,
		Payload:     &storepb.AttachmentPayload{},
	}
	if len(item.Payload) > 0 && string(item.Payload) != "null" {
		if err := protoJSONUnmarshaler.Unmarshal(item.Payload, attachment.Payload); err != nil {
			return nil, err
		}
	}
	return attachment, nil
}

func identityProvidersToMessages(values []*storepb.IdentityProvider) []proto.Message {
	messages := make([]proto.Message, 0, len(values))
	for _, value := range values {
		messages = append(messages, value)
	}
	return messages
}
