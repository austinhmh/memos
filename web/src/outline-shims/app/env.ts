const env = {
  URL: typeof window !== "undefined" ? window.location.origin : "",
  CDN_URL: "",
  COLLABORATION_URL: "",
  DEPLOYMENT: "self-hosted",
  ENVIRONMENT: "production",
  SENTRY_DSN: "",
  SENTRY_TUNNEL: "",
  APP_NAME: "Memos",
  ROOT_SHARE_ID: "",
  OIDC_DISPLAY_NAME: "",
};

export default env;
