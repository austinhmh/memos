package v1

import (
	"net/url"
	"strings"
)

// PublicMethods defines API endpoints that don't require authentication.
// All other endpoints require a valid session or access token.
//
// This is the source of truth for Connect/gRPC public endpoints.
// The REST gateway mirrors this policy with exact HTTP method+path rules below.
//
// Format: Full gRPC procedure path as returned by req.Spec().Procedure (Connect)
// or info.FullMethod (gRPC interceptor).
var PublicMethods = map[string]struct{}{
	// Auth Service - login/token endpoints must be accessible without auth
	"/memos.api.v1.AuthService/SignIn":       {},
	"/memos.api.v1.AuthService/RefreshToken": {}, // Token refresh uses cookie, must be accessible when access token expired

	// Instance Service - needed before login to show instance info
	"/memos.api.v1.InstanceService/GetInstanceProfile": {},
	"/memos.api.v1.InstanceService/GetInstanceSetting": {},

	// User Service - public user profiles and aggregated stats
	"/memos.api.v1.UserService/CreateUser":       {}, // Allow first user registration
	"/memos.api.v1.UserService/GetUser":          {},
	"/memos.api.v1.UserService/GetUserStats":     {},
	"/memos.api.v1.UserService/ListAllUserStats": {},

	// Identity Provider Service - SSO buttons on login page
	"/memos.api.v1.IdentityProviderService/ListIdentityProviders": {},

	// Memo Service - public memos (visibility filtering done in service layer)
	"/memos.api.v1.MemoService/GetMemo":          {},
	"/memos.api.v1.MemoService/ListMemos":        {},
	"/memos.api.v1.MemoService/ListMemoComments": {},
}

// IsPublicMethod checks if a procedure path is public (no authentication required).
// Returns true for public methods, false for protected methods.
func IsPublicMethod(procedure string) bool {
	_, ok := PublicMethods[procedure]
	return ok
}

// publicGatewayPaths maps gRPC-Gateway HTTP paths to public access.
// These must be kept in sync with PublicMethods above.
var publicGatewayPaths = map[string]map[string]bool{
	"POST": {
		"/api/v1/auth/signin":  true,
		"/api/v1/auth/refresh": true,
		"/api/v1/users":        true, // CreateUser (first-time setup / open registration)
	},
	"GET": {
		"/api/v1/instance/profile":   true,
		"/api/v1/memos":              true,
		"/api/v1/identity-providers": true,
		"/api/v1/users:stats":        true,
	},
}

// isPublicGatewayPath checks if an HTTP method+path is a public endpoint.
func isPublicGatewayPath(method, path string) bool {
	method = strings.ToUpper(method)
	decoded := false
	for range 5 {
		if hasUnsafeGatewayPath(path) {
			return false
		}
		parsedPath, err := url.PathUnescape(path)
		if err != nil {
			return false
		}
		if parsedPath == path {
			break
		}
		decoded = true
		path = parsedPath
	}
	if hasUnsafeGatewayPath(path) || containsEncodedPathSeparator(path) || (decoded && strings.Contains(path, "%")) {
		return false
	}
	path = strings.TrimRight(path, "/")

	if paths, ok := publicGatewayPaths[method]; ok {
		if paths[path] {
			return true
		}
	}
	if method != "GET" {
		return false
	}

	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(segments) < 3 || segments[0] != "api" || segments[1] != "v1" {
		return false
	}

	switch segments[2] {
	case "users":
		return isPublicGatewayUserPath(segments)
	case "memos":
		return isPublicGatewayMemoPath(segments)
	case "instance":
		return isPublicGatewayInstancePath(segments)
	default:
		return false
	}
}

func hasUnsafeGatewayPath(path string) bool {
	if strings.Contains(path, "\\") || containsEncodedPathSeparator(path) {
		return true
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return true
		}
	}
	return false
}

func containsEncodedPathSeparator(path string) bool {
	lowerPath := strings.ToLower(path)
	return strings.Contains(lowerPath, "%2f") || strings.Contains(lowerPath, "%5c")
}

func isPublicGatewayUserPath(segments []string) bool {
	if len(segments) != 4 {
		return false
	}
	if segments[3] == "" {
		return false
	}
	if strings.HasSuffix(segments[3], ":getStats") {
		return strings.TrimSuffix(segments[3], ":getStats") != ""
	}
	return !strings.Contains(segments[3], ":")
}

func isPublicGatewayInstancePath(segments []string) bool {
	if len(segments) != 5 || segments[3] != "settings" {
		return false
	}
	switch segments[4] {
	case "GENERAL", "MEMO_RELATED":
		return true
	default:
		return false
	}
}

func isPublicGatewayMemoPath(segments []string) bool {
	if len(segments) == 4 {
		return segments[3] != "" && !strings.Contains(segments[3], ":")
	}
	return len(segments) == 5 && segments[3] != "" && segments[4] == "comments"
}
