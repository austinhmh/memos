import { lazy, type ComponentType } from "react";

const RETRY_STORAGE_PREFIX = "memos:lazy-retry:";
const RETRYABLE_CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [^ ]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /text\/html.*valid JavaScript MIME type/i,
  /expected a JavaScript module script/i,
];

const isRetryableChunkError = (error: unknown): boolean => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return RETRYABLE_CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const lazyWithRetry = <T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  key: string,
) =>
  lazy(async () => {
    try {
      const module = await importer();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(`${RETRY_STORAGE_PREFIX}${key}`);
      }
      return module;
    } catch (error) {
      if (typeof window === "undefined" || !isRetryableChunkError(error)) {
        throw error;
      }

      const storageKey = `${RETRY_STORAGE_PREFIX}${key}`;
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const lastRetriedLocation = sessionStorage.getItem(storageKey);

      if (lastRetriedLocation === currentLocation) {
        sessionStorage.removeItem(storageKey);
        throw error;
      }

      sessionStorage.setItem(storageKey, currentLocation);
      window.location.reload();
      return new Promise<{ default: T }>(() => {});
    }
  });
