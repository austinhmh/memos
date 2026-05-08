package v1

import "testing"

func TestExtractAttachmentUID(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{
			name: "relative attachment url",
			url:  "/file/attachments/paste-image/pasted.png",
			want: "paste-image",
		},
		{
			name: "relative attachment url with query",
			url:  "/file/attachments/paste-image/pasted.png?thumbnail=true",
			want: "paste-image",
		},
		{
			name: "absolute attachment url",
			url:  "http://localhost:3001/file/attachments/paste-image/pasted.png",
			want: "paste-image",
		},
		{
			name: "absolute attachment url with query",
			url:  "https://example.com/file/attachments/paste-image/pasted.png?thumbnail=true",
			want: "paste-image",
		},
		{
			name: "external image url",
			url:  "https://example.com/images/pasted.png",
			want: "",
		},
		{
			name: "malformed url falls back to raw path",
			url:  "://bad/file/attachments/paste-image/pasted.png",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractAttachmentUID(tt.url); got != tt.want {
				t.Fatalf("extractAttachmentUID(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}
