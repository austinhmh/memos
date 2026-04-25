package v1

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/sync/semaphore"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/plugin/markdown"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

type APIV1Service struct {
	v1pb.UnimplementedInstanceServiceServer
	v1pb.UnimplementedAuthServiceServer
	v1pb.UnimplementedUserServiceServer
	v1pb.UnimplementedMemoServiceServer
	v1pb.UnimplementedAttachmentServiceServer
	v1pb.UnimplementedShortcutServiceServer
	v1pb.UnimplementedActivityServiceServer
	v1pb.UnimplementedIdentityProviderServiceServer

	Secret          string
	Profile         *profile.Profile
	Store           *store.Store
	MarkdownService markdown.Service

	// thumbnailSemaphore limits concurrent thumbnail generation to prevent memory exhaustion
	thumbnailSemaphore *semaphore.Weighted
	// signInLimiter rate limits sign-in attempts to prevent brute force
	signInLimiter *RateLimiter
	// createUserMu serializes first-user registration to avoid concurrent HOST bootstrap races.
	createUserMu sync.Mutex
}

func NewAPIV1Service(secret string, profile *profile.Profile, store *store.Store) *APIV1Service {
	markdownService := markdown.NewService(
		markdown.WithTagExtension(),
	)
	return &APIV1Service{
		Secret:             secret,
		Profile:            profile,
		Store:              store,
		MarkdownService:    markdownService,
		thumbnailSemaphore: semaphore.NewWeighted(3),
		signInLimiter:      NewRateLimiter(5, 5*time.Minute),
	}
}

// RegisterGateway registers the gRPC-Gateway and Connect handlers with the given Echo instance.
func (s *APIV1Service) RegisterGateway(ctx context.Context, echoServer *echo.Echo) error {
	// Auth middleware for gRPC-Gateway - runs after routing, has access to method name.
	// Uses the same PublicMethods config as the Connect AuthInterceptor.
	authenticator := auth.NewAuthenticator(s.Store, s.Secret)
	gatewayAuthMiddleware := func(next runtime.HandlerFunc) runtime.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request, pathParams map[string]string) {
			ctx := r.Context()

			// Extract credentials from HTTP headers
			authHeader := r.Header.Get("Authorization")

			result := authenticator.Authenticate(ctx, authHeader)

			// Enforce authentication using exact HTTP method+path allowlist.
			// runtime.RPCMethod(ctx) is not populated reliably at this middleware point.
			isPublic := isPublicGatewayPath(r.Method, r.URL.Path)
			if result == nil && !isPublic {
				http.Error(w, `{"code": 16, "message": "authentication required"}`, http.StatusUnauthorized)
				return
			}

			// Set context based on auth result (may be nil for public endpoints)
			if result != nil {
				if result.Claims != nil {
					// Access Token V2 - stateless, use claims
					ctx = auth.SetUserClaimsInContext(ctx, result.Claims)
					ctx = context.WithValue(ctx, auth.UserIDContextKey, result.Claims.UserID)
				} else if result.User != nil {
					// PAT - have full user
					ctx = auth.SetUserInContext(ctx, result.User, result.AccessToken)
				}
				r = r.WithContext(ctx)
			}

			next(w, r, pathParams)
		}
	}

	// Create gRPC-Gateway mux with auth middleware.
	gwMux := runtime.NewServeMux(
		runtime.WithMiddlewares(gatewayAuthMiddleware),
		runtime.WithIncomingHeaderMatcher(gatewayIncomingHeaderMatcher),
		runtime.WithOutgoingHeaderMatcher(gatewayOutgoingHeaderMatcher),
	)
	if err := v1pb.RegisterInstanceServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterAuthServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterUserServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterMemoServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterAttachmentServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterShortcutServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterActivityServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	if err := v1pb.RegisterIdentityProviderServiceHandlerServer(ctx, gwMux, s); err != nil {
		return err
	}
	gwGroup := echoServer.Group("")
	gwGroup.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOriginFunc:  s.corsAllowOrigin,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{"Authorization", "Content-Type", "Cookie", "Origin"},
		AllowCredentials: true,
	}))
	handler := echo.WrapHandler(gwMux)

	gwGroup.Any("/api/v1/*", handler)
	gwGroup.Any("/file/*", handler)

	// Connect handlers for browser clients (replaces grpc-web).
	logStacktraces := s.Profile.IsDev()
	connectInterceptors := connect.WithInterceptors(
		NewMetadataInterceptor(), // Convert HTTP headers to gRPC metadata first
		NewLoggingInterceptor(logStacktraces),
		NewRecoveryInterceptor(logStacktraces),
		NewAuthInterceptor(s.Store, s.Secret),
	)
	connectMux := http.NewServeMux()
	connectHandler := NewConnectServiceHandler(s)
	connectHandler.RegisterConnectHandlers(connectMux, connectInterceptors)

	// Wrap with CORS for browser access.
	// In dev mode, allow all origins for local development.
	// In production, restrict allowed origins.
	corsHandler := middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOriginFunc:  s.corsAllowOrigin,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowHeaders:     []string{"Authorization", "Content-Type", "Connect-Protocol-Version", "Connect-Timeout-Ms"},
		AllowCredentials: true,
	})
	connectGroup := echoServer.Group("", corsHandler)
	connectGroup.Any("/memos.api.v1.*", echo.WrapHandler(connectMux))

	return nil
}

func gatewayIncomingHeaderMatcher(key string) (string, bool) {
	switch strings.ToLower(key) {
	case "cookie":
		return "cookie", true
	case "user-agent":
		return "user-agent", true
	}
	return "", false
}

func gatewayOutgoingHeaderMatcher(key string) (string, bool) {
	if strings.EqualFold(key, "set-cookie") {
		return "Set-Cookie", true
	}
	return "", false
}

func (s *APIV1Service) corsAllowOrigin(origin string) (bool, error) {
	if s.Profile.IsDev() {
		return strings.HasPrefix(origin, "http://localhost:") ||
			strings.HasPrefix(origin, "http://127.0.0.1:") ||
			origin == "http://localhost" ||
			origin == "http://127.0.0.1", nil
	}
	if s.Profile.InstanceURL != "" {
		return origin == s.Profile.InstanceURL, nil
	}
	return false, nil
}
