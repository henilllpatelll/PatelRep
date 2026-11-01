import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkOrderSummary } from "@/lib/api/workOrders";
import type { WorkSummary } from "@/lib/engineering/workSummary";

interface Options {
  /** Hotel + person. A different scope never sees another's counts. */
  scope: string;
  enabled: boolean;
  fetchSummary?: (signal?: AbortSignal) => Promise<WorkSummary | null>;
}

export interface WorkSummaryHandle {
  /** null until the first answer arrives, and again whenever the scope changes. */
  summary: WorkSummary | null;
  /** The latest attempt failed or came back malformed; `summary` (if any) is from before it. */
  failed: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads the My Work tile counts. A result applies only if it is still the newest request for the same scope,
 * so a slow answer can neither overwrite a newer one nor show one hotel's or person's counts to another.
 */
export function useWorkSummary({ scope, enabled, fetchSummary = getWorkOrderSummary }: Options): WorkSummaryHandle {
  const [state, setState] = useState<{ scope: string; summary: WorkSummary | null; failed: boolean }>({ scope, summary: null, failed: false });
  const scopeRef = useRef(scope);
  const token = useRef(0);
  const fetchRef = useRef(fetchSummary);
  fetchRef.current = fetchSummary;

  useEffect(() => {
    scopeRef.current = scope;
    token.current += 1;
    setState({ scope, summary: null, failed: false });
  }, [scope]);

  const refresh = useCallback(async (): Promise<void> => {
    const myScope = scopeRef.current;
    const mine = (token.current += 1);
    const current = () => scopeRef.current === myScope && token.current === mine;
    try {
      const summary = await fetchRef.current();
      if (!current()) return;
      setState((prev) => (prev.scope === myScope ? { scope: myScope, summary: summary ?? prev.summary, failed: summary == null } : prev));
    } catch {
      if (!current()) return;
      setState((prev) => (prev.scope === myScope ? { ...prev, failed: true } : prev));
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, scope, refresh]);

  // Until the scope reset lands, nothing from the previous hotel/person is shown.
  return state.scope === scope ? { summary: state.summary, failed: state.failed, refresh } : { summary: null, failed: false, refresh };
}
