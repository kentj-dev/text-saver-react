import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(duration = 1900) {
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback(
    (message: string) => {
      clearTimeout(timer.current);
      setToast(message);
      timer.current = setTimeout(() => setToast(""), duration);
    },
    [duration],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, showToast };
}
