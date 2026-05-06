package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/base"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// BackupData contains all logical business rows exported from a Memos instance.
type BackupData struct {
	SystemSettings    []*InstanceSetting          `json:"systemSettings"`
	Users             []*User                     `json:"users"`
	UserSettings      []*storepb.UserSetting      `json:"userSettings"`
	IdentityProviders []*storepb.IdentityProvider `json:"identityProviders"`
	Memos             []*Memo                     `json:"memos"`
	Attachments       []*Attachment               `json:"attachments"`
	MemoRelations     []*MemoRelation             `json:"memoRelations"`
	Reactions         []*Reaction                 `json:"reactions"`
	Inboxes           []*Inbox                    `json:"inboxes"`
	Activities        []*Activity                 `json:"activities"`
}

// EntityCounts returns stable entity counts for backup manifest validation.
func (d *BackupData) EntityCounts() map[string]int {
	if d == nil {
		return map[string]int{}
	}
	return map[string]int{
		"system_setting": len(d.SystemSettings),
		"user":           len(d.Users),
		"user_setting":   len(d.UserSettings),
		"idp":            len(d.IdentityProviders),
		"memo":           len(d.Memos),
		"attachment":     len(d.Attachments),
		"memo_relation":  len(d.MemoRelations),
		"reaction":       len(d.Reactions),
		"inbox":          len(d.Inboxes),
		"activity":       len(d.Activities),
	}
}

// ExportBackupData exports all business rows using the store abstraction.
func (s *Store) ExportBackupData(ctx context.Context) (*BackupData, error) {
	attachmentsLimit := 100000
	data := &BackupData{}

	settings, err := s.driver.ListInstanceSettings(ctx, &FindInstanceSetting{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list instance settings")
	}
	data.SystemSettings = settings

	users, err := s.ListUsers(ctx, &FindUser{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list users")
	}
	data.Users = users

	userSettings, err := s.ListUserSettings(ctx, &FindUserSetting{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list user settings")
	}
	data.UserSettings = userSettings

	identityProviders, err := s.ListIdentityProviders(ctx, &FindIdentityProvider{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list identity providers")
	}
	data.IdentityProviders = identityProviders

	memos, err := s.ListMemos(ctx, &FindMemo{OrderByTimeAsc: true})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memos")
	}
	data.Memos = memos

	attachments, err := s.ListAttachments(ctx, &FindAttachment{GetBlob: true, Limit: &attachmentsLimit})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list attachments")
	}
	data.Attachments = attachments

	memoRelations, err := s.ListMemoRelations(ctx, &FindMemoRelation{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memo relations")
	}
	data.MemoRelations = memoRelations

	reactions, err := s.ListReactions(ctx, &FindReaction{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list reactions")
	}
	data.Reactions = reactions

	inboxes, err := s.ListInboxes(ctx, &FindInbox{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list inboxes")
	}
	data.Inboxes = inboxes

	activities, err := s.ListActivities(ctx, &FindActivity{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list activities")
	}
	data.Activities = activities

	return data, nil
}

// IsEmptyForRestore returns true when the instance has no business data except bootstrap settings or one user.
func (s *Store) IsEmptyForRestore(ctx context.Context) (bool, error) {
	db := s.driver.GetDB()
	dialect := s.profile.Driver
	for _, table := range []string{"memo", "attachment", "memo_relation", "reaction", "inbox", "activity", "idp"} {
		count, err := countTable(ctx, db, dialect, table)
		if err != nil {
			return false, err
		}
		if count > 0 {
			return false, nil
		}
	}
	userCount, err := countTable(ctx, db, dialect, "user")
	if err != nil {
		return false, err
	}
	return userCount <= 1, nil
}

// ImportBackupData replaces bootstrap rows with backup rows inside a transaction.
func (s *Store) ImportBackupData(ctx context.Context, data *BackupData) error {
	if data == nil {
		return errors.New("backup data is required")
	}
	if err := validateBackupData(data); err != nil {
		return err
	}
	empty, err := s.IsEmptyForRestore(ctx)
	if err != nil {
		return err
	}
	if !empty {
		return errors.New("restore target is not empty")
	}

	tx, err := s.driver.GetDB().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	dialect := s.profile.Driver
	if err := clearBackupTables(ctx, tx, dialect); err != nil {
		return err
	}
	if err := insertBackupData(ctx, tx, dialect, data); err != nil {
		return err
	}
	if err := resetBackupSequences(ctx, tx, dialect); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.clearCaches(ctx)
	return nil
}

func (s *Store) clearCaches(ctx context.Context) {
	s.instanceSettingCache.Clear(ctx)
	s.userCache.Clear(ctx)
	s.userSettingCache.Clear(ctx)
}

func validateBackupData(data *BackupData) error {
	for _, memo := range data.Memos {
		if !base.UIDMatcher.MatchString(memo.UID) {
			return errors.Errorf("invalid memo uid %q", memo.UID)
		}
	}
	for _, attachment := range data.Attachments {
		if !base.UIDMatcher.MatchString(attachment.UID) {
			return errors.Errorf("invalid attachment uid %q", attachment.UID)
		}
	}
	return nil
}

func countTable(ctx context.Context, db *sql.DB, dialect string, table string) (int, error) {
	var count int
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s", dialectIdentifier(dialect, table))
	if err := db.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0, errors.Wrapf(err, "failed to count %s", table)
	}
	return count, nil
}

func clearBackupTables(ctx context.Context, tx *sql.Tx, dialect string) error {
	if dialect == "postgres" {
		if _, err := tx.ExecContext(ctx, `TRUNCATE TABLE reaction, inbox, activity, memo_relation, attachment, memo, user_setting, idp, "user", system_setting RESTART IDENTITY`); err != nil {
			return errors.Wrap(err, "failed to truncate backup tables")
		}
		return nil
	}
	for _, table := range []string{"reaction", "inbox", "activity", "memo_relation", "attachment", "memo", "user_setting", "idp", "user", "system_setting"} {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s", dialectIdentifier(dialect, table))); err != nil {
			return errors.Wrapf(err, "failed to clear %s", table)
		}
	}
	return nil
}

func insertBackupData(ctx context.Context, tx *sql.Tx, dialect string, data *BackupData) error {
	for _, setting := range data.SystemSettings {
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO system_setting (name, value, description) VALUES (?, ?, ?)", setting.Name, setting.Value, setting.Description); err != nil {
			return errors.Wrap(err, "failed to insert system setting")
		}
	}
	for _, user := range data.Users {
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO user (id, created_ts, updated_ts, row_status, username, role, email, nickname, password_hash, avatar_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", user.ID, toDBTime(dialect, user.CreatedTs), toDBTime(dialect, user.UpdatedTs), user.RowStatus, user.Username, user.Role, user.Email, user.Nickname, user.PasswordHash, user.AvatarURL, user.Description); err != nil {
			return errors.Wrap(err, "failed to insert user")
		}
	}
	for _, userSetting := range data.UserSettings {
		raw, err := convertUserSettingToRaw(userSetting)
		if err != nil {
			return err
		}
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?)", raw.UserID, raw.Key.String(), raw.Value); err != nil {
			return errors.Wrap(err, "failed to insert user setting")
		}
	}
	for _, idp := range data.IdentityProviders {
		raw, err := convertIdentityProviderToRaw(idp)
		if err != nil {
			return err
		}
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO idp (id, name, type, identifier_filter, config) VALUES (?, ?, ?, ?, ?)", raw.ID, raw.Name, raw.Type.String(), raw.IdentifierFilter, raw.Config); err != nil {
			return errors.Wrap(err, "failed to insert idp")
		}
	}
	for _, memo := range data.Memos {
		payload, err := marshalProtoJSON(memo.Payload)
		if err != nil {
			return err
		}
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO memo (id, uid, creator_id, created_ts, updated_ts, row_status, content, visibility, pinned, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", memo.ID, memo.UID, memo.CreatorID, toDBTime(dialect, memo.CreatedTs), toDBTime(dialect, memo.UpdatedTs), memo.RowStatus, memo.Content, memo.Visibility, memo.Pinned, payload); err != nil {
			return errors.Wrap(err, "failed to insert memo")
		}
	}
	for _, attachment := range data.Attachments {
		payload, err := marshalProtoJSON(attachment.Payload)
		if err != nil {
			return err
		}
		storageType := ""
		if attachment.StorageType != storepb.AttachmentStorageType_ATTACHMENT_STORAGE_TYPE_UNSPECIFIED {
			storageType = attachment.StorageType.String()
		}
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO attachment (id, uid, creator_id, created_ts, updated_ts, filename, blob, type, size, memo_id, storage_type, reference, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", attachment.ID, attachment.UID, attachment.CreatorID, toDBTime(dialect, attachment.CreatedTs), toDBTime(dialect, attachment.UpdatedTs), attachment.Filename, attachment.Blob, attachment.Type, attachment.Size, attachment.MemoID, storageType, attachment.Reference, payload); err != nil {
			return errors.Wrap(err, "failed to insert attachment")
		}
	}
	for _, relation := range data.MemoRelations {
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO memo_relation (memo_id, related_memo_id, type) VALUES (?, ?, ?)", relation.MemoID, relation.RelatedMemoID, relation.Type); err != nil {
			return errors.Wrap(err, "failed to insert memo relation")
		}
	}
	for _, reaction := range data.Reactions {
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO reaction (id, created_ts, creator_id, content_id, reaction_type) VALUES (?, ?, ?, ?, ?)", reaction.ID, toDBTime(dialect, reaction.CreatedTs), reaction.CreatorID, reaction.ContentID, reaction.ReactionType); err != nil {
			return errors.Wrap(err, "failed to insert reaction")
		}
	}
	for _, inbox := range data.Inboxes {
		message, err := marshalProtoJSON(inbox.Message)
		if err != nil {
			return err
		}
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO inbox (id, created_ts, sender_id, receiver_id, status, message) VALUES (?, ?, ?, ?, ?, ?)", inbox.ID, toDBTime(dialect, inbox.CreatedTs), inbox.SenderID, inbox.ReceiverID, inbox.Status, message); err != nil {
			return errors.Wrap(err, "failed to insert inbox")
		}
	}
	for _, activity := range data.Activities {
		payload, err := marshalProtoJSON(activity.Payload)
		if err != nil {
			return err
		}
		if _, err := execInsert(ctx, tx, dialect, "INSERT INTO activity (id, creator_id, created_ts, type, level, payload) VALUES (?, ?, ?, ?, ?, ?)", activity.ID, activity.CreatorID, toDBTime(dialect, activity.CreatedTs), activity.Type, activity.Level, payload); err != nil {
			return errors.Wrap(err, "failed to insert activity")
		}
	}
	return nil
}

func execInsert(ctx context.Context, tx *sql.Tx, dialect string, query string, args ...any) (sql.Result, error) {
	query = rewriteQueryForDialect(dialect, query)
	return tx.ExecContext(ctx, query, args...)
}

func rewriteQueryForDialect(dialect string, query string) string {
	if dialect == "mysql" {
		query = strings.ReplaceAll(query, "INSERT INTO user ", "INSERT INTO `user` ")
		return rewriteMySQLTimestampPlaceholders(query)
	}
	if dialect == "postgres" {
		query = strings.ReplaceAll(query, "INSERT INTO user (", `INSERT INTO "user" (`)
		index := 1
		var builder strings.Builder
		for _, r := range query {
			if r == '?' {
				builder.WriteString(fmt.Sprintf("$%d", index))
				index++
			} else {
				builder.WriteRune(r)
			}
		}
		return builder.String()
	}
	return query
}

func rewriteMySQLTimestampPlaceholders(query string) string {
	if strings.Contains(query, "INSERT INTO `user`") {
		return strings.Replace(query, "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "VALUES (?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?)", 1)
	}
	if strings.Contains(query, "INSERT INTO memo") {
		return strings.Replace(query, "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?)", 1)
	}
	if strings.Contains(query, "INSERT INTO attachment") {
		return strings.Replace(query, "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?)", 1)
	}
	if strings.Contains(query, "INSERT INTO reaction") {
		return strings.Replace(query, "VALUES (?, ?, ?, ?, ?)", "VALUES (?, FROM_UNIXTIME(?), ?, ?, ?)", 1)
	}
	if strings.Contains(query, "INSERT INTO inbox") {
		return strings.Replace(query, "VALUES (?, ?, ?, ?, ?, ?)", "VALUES (?, FROM_UNIXTIME(?), ?, ?, ?, ?)", 1)
	}
	if strings.Contains(query, "INSERT INTO activity") {
		return strings.Replace(query, "VALUES (?, ?, ?, ?, ?, ?)", "VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?)", 1)
	}
	return query
}

func toDBTime(_ string, timestamp int64) any {
	return timestamp
}

func marshalProtoJSON(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	message, ok := value.(proto.Message)
	if !ok {
		return "{}", nil
	}
	bytes, err := protojson.Marshal(message)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func resetBackupSequences(ctx context.Context, tx *sql.Tx, dialect string) error {
	switch dialect {
	case "sqlite":
		for _, table := range []string{"user", "memo", "attachment", "activity", "idp", "inbox", "reaction"} {
			statement := fmt.Sprintf("UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM %s), 0) WHERE name = '%s'", dialectIdentifier(dialect, table), table)
			if _, err := tx.ExecContext(ctx, statement); err != nil && !strings.Contains(err.Error(), "sqlite_sequence") {
				return err
			}
		}
	case "mysql":
		for _, table := range []string{"user", "memo", "attachment", "activity", "idp", "inbox", "reaction"} {
			var maxID int
			if err := tx.QueryRowContext(ctx, fmt.Sprintf("SELECT COALESCE(MAX(id), 0) FROM %s", dialectIdentifier(dialect, table))).Scan(&maxID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s AUTO_INCREMENT = %d", dialectIdentifier(dialect, table), maxID+1)); err != nil {
				return err
			}
		}
	case "postgres":
		for _, table := range []string{"user", "memo", "attachment", "activity", "idp", "inbox", "reaction"} {
			sequenceTable := table
			if table == "user" {
				sequenceTable = `"user"`
			}
			statement := fmt.Sprintf("SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE((SELECT MAX(id) FROM %s), 1), true)", sequenceTable, dialectIdentifier(dialect, table))
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
	}
	return nil
}

func dialectIdentifier(dialect string, name string) string {
	if dialect == "mysql" {
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
	if dialect == "postgres" {
		if name == "user" {
			return `"user"`
		}
		return name
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
