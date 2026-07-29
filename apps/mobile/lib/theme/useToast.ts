import { useMemo } from "react";
import { useToastActions } from "./ToastProvider";

export function useToast() {
  const { show } = useToastActions();

  return useMemo(
    () => ({
      success: (message: string) => show("success", message),
      error: (message: string) => show("error", message),
      info: (message: string) => show("info", message),
    }),
    [show],
  );
}
