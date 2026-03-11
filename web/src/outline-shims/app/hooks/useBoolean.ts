import { useCallback, useState } from "react";

export default function useBoolean(initial = false) {
  const [value, setValue] = useState(initial);
  const setTrue = useCallback(() => setValue(true), []);
  const setFalse = useCallback(() => setValue(false), []);
  const toggle = useCallback(() => setValue((v) => !v), []);
  return [value, { setTrue, setFalse, toggle }] as const;
}
