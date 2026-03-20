package v1

// PublicMethods defines API endpoints that don't require authentication.
// All other endpoints require a valid session or access token.
//
// This is the SINGLE SOURCE OF TRUTH for public endpoints.
// Both Connect interceptor and gRPC-Gateway interceptor use this map.
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

	// User Service - public user profiles and stats
	"/memos.api.v1.UserService/CreateUser":       {}, // Allow first user registration
	"/memos.api.v1.UserService/GetUser":          {},
	"/memos.api.v1.UserService/GetUserAvatar":    {},
	"/memos.api.v1.UserService/GetUserStats":     {},
	"/memos.api.v1.UserService/ListAllUserStats": {},
	"/memos.api.v1.UserService/SearchUsers":      {},

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
		"/api/v1/auth/signin":       true,
		"/api/v1/auth/refreshToken": true,
		"/api/v1/users":            true, // CreateUser (first-time setup / open registration)
	},
	"GET": {
		"/api/v1/instance/profile": true,
		"/api/v1/memos":           true,
		"/api/v1/identityProviders": true,
	},
}

// publicGatewayPrefixes matches paths that have dynamic segments.
var publicGatewayPrefixes = map[string][]string{
	"GET": {
		"/api/v1/users/",             // GetUser, GetUserAvatar, GetUserStats
		"/api/v1/memos/",             // GetMemo, ListMemoComments
		"/api/v1/instance/settings/", // GetInstanceSetting
	},
}

// isPublicGatewayPath checks if an HTTP method+path is a public endpoint.
func isPublicGatewayPath(method, path string) bool {
	if paths, ok := publicGatewayPaths[method]; ok {
		if paths[path] {
			return true
		}
	}
	if prefixes, ok := publicGatewayPrefixes[method]; ok {
		for _, prefix := range prefixes {
			if len(path) > len(prefix) && path[:len(prefix)] == prefix {
				return true
			}
		}
	}
	return false
}
