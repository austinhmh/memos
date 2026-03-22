import { useEffect, useRef, useState } from "react";
import { STORAGE_KEY, fetchBgImagesFromServer } from "@/components/Settings/BackgroundSection";

interface BackgroundImage {
  url: string;
  name: string;
  filename: string;
}

const pickRandom = (images: BackgroundImage[]): string | null => {
  if (images.length === 0) return null;
  return images[Math.floor(Math.random() * images.length)].url;
};

const applyBgClass = (url: string | null) => {
  if (url) {
    document.documentElement.classList.add("has-bg-image");
  } else {
    document.documentElement.classList.remove("has-bg-image");
  }
};

const RandomBackground = () => {
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const prevPathRef = useRef(window.location.pathname);
  const serverFetchedRef = useRef(false);

  useEffect(() => {
    const loadFromCache = (): BackgroundImage[] => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    };

    const apply = (images: BackgroundImage[]) => {
      const url = pickRandom(images);
      setBgUrl(url);
      applyBgClass(url);
    };

    const load = () => {
      apply(loadFromCache());
    };

    // Initial: try cache first, then fetch from server to sync
    load();

    if (!serverFetchedRef.current) {
      serverFetchedRef.current = true;
      fetchBgImagesFromServer().then((serverImages) => {
        if (serverImages.length > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(serverImages));
          apply(serverImages);
        }
      });
    }

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
      <div className="absolute inset-0 bg-black/30 dark:bg-black/40 backdrop-blur-[1px]" />
    </div>
  );
};

export default RandomBackground;
