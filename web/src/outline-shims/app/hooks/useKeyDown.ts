import { useEffect, useRef } from "react";

export type KeyFilter = ((event: KeyboardEvent) => boolean) | string;

export default function useKeyDown(
  key: KeyFilter,
  fn: (event: KeyboardEvent) => void,
  options?: { allowInInput?: boolean }
) {
  const predicate =
    typeof key === "function"
      ? key
      : (event: KeyboardEvent) => event.key === key;

  const savedHandler = useRef(fn);
  savedHandler.current = fn;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (predicate(event)) {
        if (!options?.allowInInput) {
          const target = event.target as HTMLElement;
          if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
            return;
          }
        }
        savedHandler.current(event);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [predicate, options?.allowInInput]);
}
