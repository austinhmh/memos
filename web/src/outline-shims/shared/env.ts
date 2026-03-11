const env: Record<string, any> = (typeof window !== "undefined" && (window as any).env) || {
  URL: typeof window !== "undefined" ? window.location.origin : "",
  CDN_URL: "",
  COLLABORATION_URL: "",
  DEPLOYMENT: "self-hosted",
  ENVIRONMENT: "production",
  APP_NAME: "Memos",
};

export default env;
