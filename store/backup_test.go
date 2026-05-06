package store

import "testing"

func TestRewriteQueryForDialectPostgresQuotesOnlyUserTable(t *testing.T) {
	query := "INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?)"
	rewritten := rewriteQueryForDialect("postgres", query)
	want := "INSERT INTO user_setting (user_id, key, value) VALUES ($1, $2, $3)"
	if rewritten != want {
		t.Fatalf("rewriteQueryForDialect() = %q, want %q", rewritten, want)
	}
}

func TestRewriteQueryForDialectPostgresQuotesUserTable(t *testing.T) {
	query := "INSERT INTO user (id, created_ts, updated_ts, row_status, username, role, email, nickname, password_hash, avatar_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	rewritten := rewriteQueryForDialect("postgres", query)
	want := "INSERT INTO \"user\" (id, created_ts, updated_ts, row_status, username, role, email, nickname, password_hash, avatar_url, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
	if rewritten != want {
		t.Fatalf("rewriteQueryForDialect() = %q, want %q", rewritten, want)
	}
}

func TestRewriteQueryForDialectMySQLUserTimestampPlaceholders(t *testing.T) {
	query := "INSERT INTO user (id, created_ts, updated_ts, row_status, username, role, email, nickname, password_hash, avatar_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	rewritten := rewriteQueryForDialect("mysql", query)
	want := "INSERT INTO `user` (id, created_ts, updated_ts, row_status, username, role, email, nickname, password_hash, avatar_url, description) VALUES (?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?)"
	if rewritten != want {
		t.Fatalf("rewriteQueryForDialect() = %q, want %q", rewritten, want)
	}
}

func TestRewriteQueryForDialectMySQLMemoTimestampPlaceholders(t *testing.T) {
	query := "INSERT INTO memo (id, uid, creator_id, created_ts, updated_ts, row_status, content, visibility, pinned, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	rewritten := rewriteQueryForDialect("mysql", query)
	want := "INSERT INTO memo (id, uid, creator_id, created_ts, updated_ts, row_status, content, visibility, pinned, payload) VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?)"
	if rewritten != want {
		t.Fatalf("rewriteQueryForDialect() = %q, want %q", rewritten, want)
	}
}

func TestDialectIdentifier(t *testing.T) {
	tests := []struct {
		dialect string
		name    string
		want    string
	}{
		{dialect: "mysql", name: "user", want: "`user`"},
		{dialect: "postgres", name: "user", want: "\"user\""},
		{dialect: "postgres", name: "memo", want: "memo"},
		{dialect: "sqlite", name: "user", want: "\"user\""},
	}
	for _, test := range tests {
		if got := dialectIdentifier(test.dialect, test.name); got != test.want {
			t.Fatalf("dialectIdentifier(%q, %q) = %q, want %q", test.dialect, test.name, got, test.want)
		}
	}
}
