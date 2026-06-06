import "@github/relative-time-element";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { RouterProvider } from "react-router-dom";
import "@fontsource/fira-code/300.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/fira-code/700.css";
import "./i18n";
import "./index.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Spinner from "@/components/Spinner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InstanceProvider, useInstance } from "@/contexts/InstanceContext";
import { ViewProvider } from "@/contexts/ViewContext";
import { useAppFontScale } from "@/hooks/useAppFontScale";
import { queryClient } from "@/lib/query-client";
import router from "./router";
import { applyLocaleEarly } from "./utils/i18n";
import { applyThemeEarly } from "./utils/theme";
import "leaflet/dist/leaflet.css";
import "katex/dist/katex.min.css";

// Apply theme and locale early to prevent flash
applyThemeEarly();
applyLocaleEarly();

// Inner component that initializes contexts
function AppInitializer({ children }: { children: React.ReactNode }) {
  const { isInitialized: authInitialized, initialize: initAuth } = useAuth();
  const { isInitialized: instanceInitialized, initialize: initInstance } = useInstance();
  const initStartedRef = useRef(false);

  // Initialize on mount - run in parallel for better performance
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const init = async () => {
      await Promise.all([initInstance(), initAuth()]);
    };
    init();
  }, [initAuth, initInstance]);

  if (!authInitialized || !instanceInitialized) {
    return (
      <div className="w-full min-h-svh flex items-center justify-center bg-transparent">
        <Spinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}

function Main() {
  useAppFontScale();

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <AuthProvider>
            <ViewProvider>
              <AppInitializer>
                <RouterProvider router={router} />
                <Toaster position="top-right" />
              </AppInitializer>
            </ViewProvider>
          </AuthProvider>
        </InstanceProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const container = document.getElementById("root");

if (import.meta.env.DEV && window.location.pathname === "/__e2e__/blog-editor-table") {
  import("@/components/BlogEditor/e2e/TableE2EPage");
} else {
  const root = createRoot(container as HTMLElement);
  root.render(<Main />);
}
