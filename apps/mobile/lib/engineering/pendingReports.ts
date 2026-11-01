/* ─── Reports saved on this device ──────────────────────────────────────────
   An issue reported offline is only *saved*, not accepted: it is a row in the shared sync queue until the server
   answers. This module tells the truth about those reports on the Work tab:
     · queued    — still on this phone, waiting to sync (read from the queue itself);
     · synced    — the server accepted it; we keep the real work order number it returned until dismissed;
     · refused   — the server said no and it can never succeed, so the sync dropped it and recorded why.
   Kept per signed-in person on this phone; holds a title and a work order number, never photos or other content. */

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPendingSyncQueue } from "@/lib/offline/db";
import { getQueueOwner } from "@/lib/offline/queueOwner";

/** Marks an engineering report in the shared queue (entity_id). Housekeeping's own maintenance reports are not marked. */
export const REPORT_QUEUE_MARK = "eng-report:";

export interface ReportRecord {
  requestId: string;
  kind: "synced" | "refused";
  title: string;
  workOrderId?: string | null;
  workOrderNumber?: string | null;
  /** Why the server refused it. Only set for `refused`. */
  message?: string | null;
  at: string;
}

const MAX_RECORDS = 10;
const storageKey = (owner: string) => `engineering.reportRecords.v1:${owner}`;

let loadedFor: string | null = null;
let records: ReportRecord[] = [];
const listeners = new Set<(next: ReportRecord[]) => void>();

function publish(): void {
  const snapshot = [...records];
  listeners.forEach((listener) => listener(snapshot));
}

async function persist(owner: string): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(owner), JSON.stringify(records));
  } catch {
    // The in-memory list still serves this session.
  }
}

export async function loadReportRecords(): Promise<ReportRecord[]> {
  const owner = getQueueOwner();
  if (!owner) {
    loadedFor = null;
    records = [];
    publish();
    return [];
  }
  if (loadedFor !== owner) {
    loadedFor = owner;
    records = [];
    try {
      const raw = await AsyncStorage.getItem(storageKey(owner));
      const parsed = raw ? (JSON.parse(raw) as ReportRecord[]) : [];
      if (getQueueOwner() === owner && Array.isArray(parsed)) records = parsed.slice(0, MAX_RECORDS);
    } catch {
      records = [];
    }
    publish();
  }
  return [...records];
}

export async function recordReport(record: Omit<ReportRecord, "at">): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  await loadReportRecords();
  if (getQueueOwner() !== owner) return;
  records = [{ ...record, at: new Date().toISOString() }, ...records.filter((r) => r.requestId !== record.requestId)].slice(0, MAX_RECORDS);
  publish();
  await persist(owner);
}

export async function dismissReportRecord(requestId: string): Promise<void> {
  const owner = getQueueOwner();
  records = records.filter((r) => r.requestId !== requestId);
  publish();
  if (owner) await persist(owner);
}

export function useReportRecords(): ReportRecord[] {
  const [list, setList] = useState<ReportRecord[]>(records);
  useEffect(() => {
    listeners.add(setList);
    void loadReportRecords();
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

export interface QueuedReport {
  requestId: string;
  title: string;
}

/** The engineering reports still waiting in the queue for the signed-in person. */
export async function listQueuedReports(): Promise<QueuedReport[]> {
  const rows = (await getPendingSyncQueue()) as Array<{ entity_type: string; action: string; entity_id?: string | null; payload: string }>;
  const out: QueuedReport[] = [];
  for (const row of rows) {
    if (row.entity_type !== "work_order" || row.action !== "create" || !row.entity_id?.startsWith(REPORT_QUEUE_MARK)) continue;
    try {
      const payload = JSON.parse(row.payload) as { title?: string };
      out.push({ requestId: row.entity_id.slice(REPORT_QUEUE_MARK.length), title: payload.title ?? "" });
    } catch {
      out.push({ requestId: row.entity_id.slice(REPORT_QUEUE_MARK.length), title: "" });
    }
  }
  return out;
}

export function useQueuedReports(refreshKey: unknown): QueuedReport[] {
  const [list, setList] = useState<QueuedReport[]>([]);
  useEffect(() => {
    let cancelled = false;
    listQueuedReports()
      .then((next) => {
        if (!cancelled) setList(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return list;
}

/** A queued create that the server will never accept as written (a 4xx other than "try later"). */
export function isTerminalReportFailure(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
