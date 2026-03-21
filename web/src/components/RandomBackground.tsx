import { useEffect, useRef, useState } from "react";
import { STORAGE_KEY } from "@/components/Settings/BackgroundSection";

interface BackgroundImage {
  url: string;
  name: string;
  filename: string;
}

const pickRandom = (images: BackgroundImage[]): string | null => {
  if (images.length === 0) return null;
  return images[Math.floor(Math.random() * images.length)].url;
};

const RandomBackground = () => {
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const prevPathRef = useRef(window.location.pathname);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const images: BackgroundImage[] = raw ? JSON.parse(raw) : [];
        setBgUrl(pickRandom(images));
      } catch {
        setBgUrl(null);
      }
    };

    load();

    const handler = () => load();
    window.addEventListener("background-images-changed", handler);

    const onPopState = () => {
      if (window.location.pathname !== prevPathRef.current) {
        prevPathRef.current = window.location.pathname;
        load();
      }
    };
    window.addEventListener("popstate", onPopState);

    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      origPushState(...args);
      if (window.location.pathname !== prevPathRef.current) {
        prevPathRef.current = window.location.pathname;
        load();
      }
    };

    history.replaceState = (...args) => {
      origReplaceState(...args);
      if (window.location.pathname !== prevPathRef.current) {
        prevPathRef.current = window.location.pathname;
        load();
      }
    };

    return () => {
      window.removeEventListener("background-images-changed", handler);
      window.removeEventListener("popstate", onPopState);
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
    };
  }, []);

  if (!bgUrl) return null;

  return (
    <div
      className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat bg-fixed transition-opacity duration-1000"
      style={{
        backgroundImage: `url(${bgUrl})`,
      }}
    >
      <div className="absolute inset-0 bg-background/70 dark:bg-background/80 backdrop-blur-[2px]" />
    </div>
  );
};

export default RandomBackground;
