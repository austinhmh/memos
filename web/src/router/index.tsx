import type { ComponentType } from "react";
import { Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import App from "@/App";
import Spinner from "@/components/Spinner";
import MainLayout from "@/layouts/MainLayout";
import RootLayout from "@/layouts/RootLayout";
import Home from "@/pages/Home";

const AdminSignIn = lazyWithRetry(() => import("@/pages/AdminSignIn"), "AdminSignIn");
const Archived = lazyWithRetry(() => import("@/pages/Archived"), "Archived");
const AuthCallback = lazyWithRetry(() => import("@/pages/AuthCallback"), "AuthCallback");
const BlogDetail = lazyWithRetry(() => import("@/pages/BlogDetail"), "BlogDetailRoute");
const BlogHome = lazyWithRetry(() => import("@/pages/BlogHome"), "BlogHome");
const BlogLayout = lazyWithRetry(() => import("@/layouts/BlogLayout"), "BlogLayout");
const Explore = lazyWithRetry(() => import("@/pages/Explore"), "Explore");
const Inboxes = lazyWithRetry(() => import("@/pages/Inboxes"), "Inboxes");
const MemoDetail = lazyWithRetry(() => import("@/pages/MemoDetail"), "MemoDetailRoute");
const NotFound = lazyWithRetry(() => import("@/pages/NotFound"), "NotFound");
const PermissionDenied = lazyWithRetry(() => import("@/pages/PermissionDenied"), "PermissionDenied");
const Attachments = lazyWithRetry(() => import("@/pages/Attachments"), "Attachments");
const Setting = lazyWithRetry(() => import("@/pages/Setting"), "Setting");
const SignIn = lazyWithRetry(() => import("@/pages/SignIn"), "SignIn");
const SignUp = lazyWithRetry(() => import("@/pages/SignUp"), "SignUp");
const UserProfile = lazyWithRetry(() => import("@/pages/UserProfile"), "UserProfile");
const MemoDetailRedirect = lazyWithRetry(() => import("./MemoDetailRedirect"), "MemoDetailRedirect");

import { lazyWithRetry } from "./lazyWithRetry";
import { ROUTES } from "./routes";

// Backward compatibility alias
export const Routes = ROUTES;
export { ROUTES };

// Helper component to reduce Suspense boilerplate for lazy routes
const LazyRoute = ({ component: Component }: { component: ComponentType }) => (
  <Suspense
    fallback={
      <div className="w-full h-64 flex items-center justify-center bg-transparent">
        <Spinner size="lg" />
      </div>
    }
  >
    <Component />
  </Suspense>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: Routes.AUTH,
        children: [
          { path: "", element: <LazyRoute component={SignIn} /> },
          { path: "admin", element: <LazyRoute component={AdminSignIn} /> },
          { path: "signup", element: <LazyRoute component={SignUp} /> },
          { path: "callback", element: <LazyRoute component={AuthCallback} /> },
        ],
      },
      {
        path: Routes.ROOT,
        element: <RootLayout />,
        children: [
          {
            element: <MainLayout />,
            children: [
              { path: "", element: <Home /> },
              { path: Routes.EXPLORE, element: <LazyRoute component={Explore} /> },
              { path: Routes.ARCHIVED, element: <LazyRoute component={Archived} /> },
              { path: "u/:username", element: <LazyRoute component={UserProfile} /> },
            ],
          },
          { path: Routes.ATTACHMENTS, element: <LazyRoute component={Attachments} /> },
          { path: Routes.INBOX, element: <LazyRoute component={Inboxes} /> },
          { path: Routes.SETTING, element: <LazyRoute component={Setting} /> },
          { path: "memos/:uid", element: <LazyRoute component={MemoDetail} /> },
          {
            path: "blog",
            element: <LazyRoute component={BlogLayout} />,
            children: [
              { path: "", element: <LazyRoute component={BlogHome} /> },
              { path: ":uid", element: <LazyRoute component={BlogDetail} /> },
            ],
          },
          // Redirect old path to new path
          { path: "m/:uid", element: <LazyRoute component={MemoDetailRedirect} /> },
          { path: "403", element: <LazyRoute component={PermissionDenied} /> },
          { path: "404", element: <LazyRoute component={NotFound} /> },
          { path: "*", element: <LazyRoute component={NotFound} /> },
        ],
      },
    ],
  },
]);

export default router;
