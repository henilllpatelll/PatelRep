import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTemplates, type ShiftTemplate } from "@/lib/api/schedulingManage";
import { useAppStore } from "@/stores/appStore";

/* The hotel's shift templates, read from the server (never hard-coded). A failed refresh keeps the last good list and
   says so (`error`), and an answer that lands after the signed-in hotel/person changed is discarded. */

export type TemplatesState =
  | { status: "loading"; templates: null; unreadable: 0; error: false }
  | { status: "ready"; templates: ShiftTemplate[]; unreadable: number; error: boolean }
  | { status: "failed"; templates: null; unreadable: 0; error: true };

export function useTemplates({ includeArchived = false, enabled = true }: { includeArchived?: boolean; enabled?: boolean } = {}) {
  const tenantId = useAppStore((state) => state.user?.tenant_id ?? null);
  const userId = useAppStore((state) => state.user?.id ?? null);
  const scope = tenantId && userId ? `${tenantId}:${userId}:${includeArchived}` : null;
  const [state, setState] = useState<TemplatesState>({ status: "loading", templates: null, unreadable: 0, error: false });
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!scope) return;
    const mine = ++seq.current;
    try {
      const list = await fetchTemplates(includeArchived);
      if (mine !== seq.current) return;
      setState({ status: "ready", templates: list.templates, unreadable: list.unreadable, error: false });
      setLoadedScope(scope);
    } catch {
      if (mine !== seq.current) return;
      setState((held) => (held.status === "ready" && loadedScope === scope ? { ...held, error: true } : { status: "failed", templates: null, unreadable: 0, error: true }));
    }
  }, [scope, includeArchived, loadedScope]);

  useEffect(() => {
    if (!enabled || !scope) return;
    setState((held) => (loadedScope === scope && held.status === "ready" ? held : { status: "loading", templates: null, unreadable: 0, error: false }));
    void reload();
    // reload changes with loadedScope; the scope itself is what should restart the load
  }, [enabled, scope]);

  useEffect(
    () => () => {
      seq.current += 1;
    },
    [],
  );

  return { state, reload };
}
