import { useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useInstance } from "./contexts/InstanceContext";
import { MemoFilterProvider } from "./contexts/MemoFilterContext";
import useNavigateTo from "./hooks/useNavigateTo";
import { useUserLocale } from "./hooks/useUserLocale";
import { useUserTheme } from "./hooks/useUserTheme";
import { sanitizeImageUrl } from "./lib/sanitize-url";
import { cleanupExpiredOAuthState } from "./utils/oauth";

const App = () => {
  const navigateTo = useNavigateTo();
  const { profile: instanceProfile, generalSetting: instanceGeneralSetting } = useInstance();

  const redirectCount = useRef(0);

  // Apply user preferences reactively
  useUserLocale();
  useUserTheme();

  // Clean up expired OAuth states on app initialization
  useEffect(() => {
    cleanupExpiredOAuthState();
  }, []);

  // Redirect to sign up page if no instance owner
  useEffect(() => {
    // Check if there's actually no owner (null, undefined, or empty string)
    const needsOwner = !instanceProfile.owner || instanceProfile.owner === "";
    if (needsOwner && redirectCount.current === 0) {
      redirectCount.current += 1;
      navigateTo("/auth/signup");
    }
  }, [instanceProfile.owner, navigateTo]);

  useEffect(() => {
    if (!instanceGeneralSetting.additionalStyle) {
      return;
    }

    const styleEl = document.createElement("style");
    styleEl.textContent = instanceGeneralSetting.additionalStyle;
    styleEl.setAttribute("type", "text/css");
    document.body.insertAdjacentElement("beforeend", styleEl);

    return () => {
      styleEl.remove();
    };
  }, [instanceGeneralSetting.additionalStyle]);

  useEffect(() => {
    if (instanceGeneralSetting.additionalScript) {
      console.warn("additionalScript is ignored for security reasons.");
    }
  }, [instanceGeneralSetting.additionalScript]);

  // Dynamic update metadata with customized profile
  useEffect(() => {
    if (!instanceGeneralSetting.customProfile) {
      return;
    }

    document.title = instanceGeneralSetting.customProfile.title;
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    link.href = sanitizeImageUrl(instanceGeneralSetting.customProfile.logoUrl) || "/logo.webp";
  }, [instanceGeneralSetting.customProfile]);

  return (
    <MemoFilterProvider>
      <Outlet />
    </MemoFilterProvider>
  );
};

export default App;
