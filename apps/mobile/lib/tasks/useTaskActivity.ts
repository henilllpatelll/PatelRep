import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTaskActivity, type TaskActivity } from "@/lib/api/tasks";

/* Authoritative task + persisted activity for ONE task, loaded when a sheet opens.
   A failed load is reported (never shown as "no activity"); a failed reload keeps the last good data.
   Responses for a task/sheet that is no longer current are dropped. `reload` can be called after a
   mutation or a conflict to pick up what the server now says. */

export type ActivityStatus = "idle" | "loading" | "ready" | "error";

export interface UseTaskActivity {
  data: TaskActivity | null;
  status: ActivityStatus;
  /** The last reload failed; `data` is the previous good copy. */
  stale: boolean;
  /** The server no longer lets this employee read the task (removed / reassigned away). */
  gone: boolean;
  reload: () => Promise<TaskActivity | null>;
}

function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

export function useTaskActivity(taskId: string | null): UseTaskActivity {
  const [data, setData] = useState<TaskActivity | null>(null);
  const [status, setStatus] = useState<ActivityStatus>("idle");
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const token = useRef(0);
  const current = useRef<string | null>(null);

  const load = useCallback(async (id: string | null): Promise<TaskActivity | null> => {
    const mine = ++token.current;
    if (!id) return null;
    try {
      const result = await fetchTaskActivity(id);
      if (mine !== token.current) return null;
      setData(result);
      setStatus("ready");
      setStale(false);
      setGone(false);
      return result;
    } catch (error) {
      if (mine !== token.current) return null;
      const code = httpStatus(error);
      if (code === 404 || code === 403) {
        setGone(true);
        setStatus("ready");
        return null;
      }
      setStale(true);
      setStatus((prev) => (prev === "ready" ? "ready" : "error"));
      return null;
    }
  }, []);

  useEffect(() => {
    current.current = taskId;
    setData(null);
    setStale(false);
    setGone(false);
    setStatus(taskId ? "loading" : "idle");
    void load(taskId);
    return () => {
      token.current += 1; // drop anything still in flight for the previous task
    };
  }, [taskId, load]);

  const reload = useCallback(() => load(current.current), [load]);
  return { data, status, stale, gone, reload };
}
