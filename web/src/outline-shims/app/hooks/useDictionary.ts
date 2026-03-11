import { useMemo } from "react";

export type Dictionary = Record<string, string> & ((key: string, data?: Record<string, string>) => string);

export default function useDictionary(): Dictionary {
  return useMemo(() => {
    const fn = ((key: string) => key) as Dictionary;
    return new Proxy(fn, {
      get(_target, prop: string) {
        if (prop === "apply" || prop === "call" || prop === "bind" || typeof prop === "symbol") {
          return Reflect.get(_target, prop);
        }
        return prop;
      },
    });
  }, []);
}
