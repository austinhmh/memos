export const ROUTES = {
  ROOT: "/",
  BLOG: "/blog",
  ATTACHMENTS: "/attachments",
  INBOX: "/inbox",
  TODO: "/todo",
  ARCHIVED: "/archived",
  SETTING: "/setting",
  EXPLORE: "/explore",
  AUTH: "/auth",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];
