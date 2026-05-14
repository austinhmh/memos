package v1

import (
	"context"
	"net"
	"strings"

	"connectrpc.com/connect"
	"google.golang.org/grpc/peer"

	"github.com/usememos/memos/server/auth"
)

type requestIPContextKey struct{}

func contextWithRequestIP(ctx context.Context, remoteAddr string) context.Context {
	ip := remoteIPFromAddr(remoteAddr)
	if ip == "" {
		return ctx
	}
	return context.WithValue(ctx, requestIPContextKey{}, ip)
}

func requestIPFromContext(ctx context.Context) string {
	if ip, ok := ctx.Value(requestIPContextKey{}).(string); ok && ip != "" {
		return ip
	}
	if callInfo, ok := connect.CallInfoForHandlerContext(ctx); ok {
		return remoteIPFromAddr(callInfo.Peer().Addr)
	}
	if peerInfo, ok := peer.FromContext(ctx); ok && peerInfo.Addr != nil {
		return remoteIPFromAddr(peerInfo.Addr.String())
	}
	return ""
}

func remoteIPFromAddr(remoteAddr string) string {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	if ip := net.ParseIP(remoteAddr); ip != nil {
		return ip.String()
	}
	return remoteAddr
}

func (s *APIV1Service) contextWithAuthenticatedUser(ctx context.Context, authHeader string) context.Context {
	if auth.GetUserID(ctx) != 0 {
		return ctx
	}
	authResult := auth.NewAuthenticator(s.Store, s.Secret).Authenticate(ctx, authHeader)
	if authResult == nil {
		return ctx
	}
	if authResult.Claims != nil {
		ctx = auth.SetUserClaimsInContext(ctx, authResult.Claims)
		return context.WithValue(ctx, auth.UserIDContextKey, authResult.Claims.UserID)
	}
	if authResult.User != nil {
		return auth.SetUserInContext(ctx, authResult.User, authResult.AccessToken)
	}
	return ctx
}
