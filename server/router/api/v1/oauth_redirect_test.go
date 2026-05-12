package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/metadata"

	"github.com/usememos/memos/internal/profile"
)

func TestAllowedOAuthRedirectURI(t *testing.T) {
	service := &APIV1Service{Profile: &profile.Profile{Mode: "prod", InstanceURL: "https://example.com/base"}}
	redirectURI, err := service.allowedOAuthRedirectURI(t.Context())
	require.NoError(t, err)
	require.Equal(t, "https://example.com/auth/callback", redirectURI)

	originService := &APIV1Service{Profile: &profile.Profile{Mode: "dev"}}
	originCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("origin", "http://localhost:3000"))
	redirectURI, err = originService.allowedOAuthRedirectURI(originCtx)
	require.NoError(t, err)
	require.Equal(t, "http://localhost:3000/auth/callback", redirectURI)

	prodOriginService := &APIV1Service{Profile: &profile.Profile{Mode: "prod"}}
	_, err = prodOriginService.allowedOAuthRedirectURI(originCtx)
	require.Error(t, err)
	require.Contains(t, err.Error(), "instance URL is not configured")

	_, err = originService.allowedOAuthRedirectURI(t.Context())
	require.Error(t, err)
	require.Contains(t, err.Error(), "instance URL is not configured")
}

func TestValidateOAuthRedirectURIRequiresExactMatch(t *testing.T) {
	allowed := "https://example.com/auth/callback"
	require.NoError(t, validateOAuthRedirectURI(allowed, allowed))

	for _, redirectURI := range []string{
		"http://example.com/auth/callback",
		"https://evil.example/auth/callback",
		"https://example.com/auth/callback?next=https://evil.example",
		"https://example.com/auth/callback/extra",
		"https://example.com/Auth/Callback",
		"",
	} {
		t.Run(redirectURI, func(t *testing.T) {
			require.Error(t, validateOAuthRedirectURI(redirectURI, allowed))
		})
	}
}
