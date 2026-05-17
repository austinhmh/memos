import { useEffect, useRef, useState } from "react";
import { fetchBgImagesFromServer, STORAGE_KEY } from "@/components/Settings/BackgroundSection";
import type { User } from "@/types/proto/api/v1/user_service_pb";

interface BackgroundImage {
  url: string;
  name: string;
  filename: string;
}

interface Props {
  currentUser?: User;
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

const RandomBackground = ({ currentUser }: Props) => {
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const initializedRef = useRef(false);

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

    if (!currentUser) {
      setBgUrl(null);
      applyBgClass(null);
      initializedRef.current = false;
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      const cached = loadFromCache();
      if (cached.length > 0) {
        apply(cached);
      }
      fetchBgImagesFromServer()
        .then((serverImages) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(serverImages));
          apply(serverImages);
        })
        .catch((error) => {
          console.error("Failed to fetch background images:", error);
        });
    }

    const onSettingsChanged = () => {
      apply(loadFromCache());
    };
    window.addEventListener("background-images-changed", onSettingsChanged);
    return () => window.removeEventListener("background-images-changed", onSettingsChanged);
  }, [currentUser]);

  if (!bgUrl) return null;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" style={{ height: "100dvh" }}>
      <img src={bgUrl} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      <div className="absolute inset-0 bg-black/30 dark:bg-black/40 backdrop-blur-[1px]" />
    </div>
  );
};

export default RandomBackground;
