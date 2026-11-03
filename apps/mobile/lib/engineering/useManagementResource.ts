import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { classifyLoadFailure, type LoadFailure } from "./loadState";

export interface ManagementResource<T> {
  data: T | null;
  loading: boolean;
  failure: LoadFailure | null;
  reload: () => Promise<void>;
}

/**
 * One management read. A newer request supersedes an older one (its answer is dropped), a different person or property
 * starts empty instead of showing the previous one's numbers, and a failed refresh keeps the last good data and reports
 * the failure - it never turns into a confirmed zero.
 */
export function useManagementResource<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true): ManagementResource<T> {
  const user = useAppStore((s) => s.user);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const [state, setState] = useState<{ scope: string | null; data: T | null }>({ scope, data: null });
  const [loading, setLoading] = useState(enabled);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const ticket = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const reload = useCallback(async () => {
    if (!enabled) return;
    const mine = ++ticket.current;
    const requestScope = scopeRef.current;
    setLoading(true);
    try {
      const data = await loadRef.current();
      if (mine !== ticket.current || requestScope !== scopeRef.current) return;
      setState({ scope: requestScope, data });
      setFailure(null);
    } catch (err) {
      if (mine !== ticket.current || requestScope !== scopeRef.current) return;
      setFailure(classifyLoadFailure(err));
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data: state.scope === scope ? state.data : null, loading, failure, reload };
}
