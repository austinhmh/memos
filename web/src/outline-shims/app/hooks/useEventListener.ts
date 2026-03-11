import { useEffect, useRef } from "react";

export default function useEventListener(
  eventName: string,
  handler: (event: any) => void,
  element: EventTarget | null = typeof window !== "undefined" ? window : null,
  options?: AddEventListenerOptions
) {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  useEffect(() => {
    if (!element) return;
    const listener = (event: Event) => savedHandler.current(event);
    element.addEventListener(eventName, listener, options);
    return () => element.removeEventListener(eventName, listener, options);
  }, [eventName, element, options]);
}
