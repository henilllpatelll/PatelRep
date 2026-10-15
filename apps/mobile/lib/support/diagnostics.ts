/**
 * What "App Diagnostics" can show and what a report may carry. This is an explicit allowlist, built field by
 * field: the app store, the offline queues and the logs are never serialised. The keys are the same ones the
 * server accepts (routers/feedback.py MOBILE_DIAGNOSTIC_KEYS); it drops anything else.
 */

export const DIAGNOSTIC_KEYS = [
  "app_version",
  "build",
  "platform",
  "os_version",
  "role",
  "language",
  "online",
  "last_synced_at",
  "pending_changes",
  "failed_changes",
  "sync_status",
] as const;
export type DiagnosticKey = (typeof DIAGNOSTIC_KEYS)[number];

export interface DiagnosticEntry {
  key: DiagnosticKey;
  value: string | number | boolean;
}

export interface DiagnosticsInput {
  appVersion?: string | null;
  build?: string | number | null;
  platform?: string | null;
  osVersion?: string | number | null;
  role?: string | null;
  language?: string | null;
  online?: boolean | null;
  lastSyncedAt?: string | null;
  pending?: number | null;
  failed?: number | null;
  syncStatus?: string | null;
}

/** Fields that are unknown are left out; nothing is guessed. */
export function buildDiagnostics(input: DiagnosticsInput): DiagnosticEntry[] {
  const candidates: [DiagnosticKey, string | number | boolean | null | undefined][] = [
    ["app_version", input.appVersion],
    ["build", input.build],
    ["platform", input.platform],
    ["os_version", input.osVersion],
    ["role", input.role],
    ["language", input.language],
    ["online", input.online],
    ["last_synced_at", input.lastSyncedAt],
    ["pending_changes", input.pending],
    ["failed_changes", input.failed],
    ["sync_status", input.syncStatus],
  ];
  const entries: DiagnosticEntry[] = [];
  for (const [key, raw] of candidates) {
    if (raw === null || raw === undefined || raw === "") continue;
    entries.push({ key, value: typeof raw === "string" ? raw.slice(0, 80) : typeof raw === "number" && !Number.isFinite(raw) ? 0 : raw });
  }
  return entries;
}

export function diagnosticsToContext(entries: DiagnosticEntry[]): Record<string, string | number | boolean> {
  const context: Record<string, string | number | boolean> = {};
  for (const entry of entries) context[entry.key] = entry.value;
  return context;
}

/** Plain text for the share sheet: exactly the previewed rows, one per line. */
export function diagnosticsToText(entries: DiagnosticEntry[], label: (key: DiagnosticKey) => string, display: (entry: DiagnosticEntry) => string): string {
  return entries.map((entry) => `${label(entry.key)}: ${display(entry)}`).join("\n");
}
