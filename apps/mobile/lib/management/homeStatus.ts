import type { SourceStatus } from "./useSource";

/* One honest line about how current a dashboard is, from its sources. Never "all good" while data is missing. */

export type HomeStatusKind = "loading" | "live" | "stale" | "partial" | "failed" | "offline" | "offlineEmpty";

export interface SourceSnapshot {
  status: SourceStatus;
  stale: boolean;
  fetchedAt: number | null;
}

export interface HomeStatus {
  kind: HomeStatusKind;
  /** Oldest successful fetch across the sources that have data (ms), for "Updated 3:42 PM". */
  updatedAt: number | null;
}

export function homeStatus(online: boolean, sources: readonly SourceSnapshot[]): HomeStatus {
  const withData = sources.filter((s) => s.fetchedAt !== null);
  const updatedAt = withData.length ? Math.min(...withData.map((s) => s.fetchedAt as number)) : null;
  if (!online) return { kind: withData.length ? "offline" : "offlineEmpty", updatedAt };
  const loading = sources.some((s) => s.status === "idle" || s.status === "loading");
  if (loading && withData.length === 0) return { kind: "loading", updatedAt };
  const errored = sources.filter((s) => s.status === "error");
  if (errored.length === sources.length && sources.length > 0) return { kind: "failed", updatedAt };
  if (errored.length > 0) return { kind: "partial", updatedAt };
  if (sources.some((s) => s.stale)) return { kind: "stale", updatedAt };
  return { kind: "live", updatedAt };
}
