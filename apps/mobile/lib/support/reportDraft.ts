import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReportArea } from "@/lib/api/support";
import { REPORT_AREAS } from "@/lib/api/support";

/**
 * An unsent problem report, kept on this phone for the signed-in person + hotel only (`${tenant}:${user}`), so a
 * failed or offline attempt is not lost. It is a draft, not a queue: nothing is ever sent from here until the person
 * presses Submit again, and the same `requestId` is reused so a retry cannot file the report twice.
 */

export interface ReportDraft {
  area: ReportArea | null;
  message: string;
  blocking: boolean;
  includeDiagnostics: boolean;
  requestId: string;
}

export const MIN_REPORT_LENGTH = 10;
export const MAX_REPORT_LENGTH = 1000;

const key = (scope: string) => `@patelrep/mobile/report-draft:${scope}`;

export function parseDraft(raw: string | null): ReportDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ReportDraft>;
    if (typeof d.requestId !== "string" || typeof d.message !== "string") return null;
    return {
      area: REPORT_AREAS.includes(d.area as ReportArea) ? (d.area as ReportArea) : null,
      message: d.message.slice(0, MAX_REPORT_LENGTH),
      blocking: d.blocking === true,
      includeDiagnostics: d.includeDiagnostics === true,
      requestId: d.requestId,
    };
  } catch {
    return null;
  }
}

/** A draft worth keeping or warning about: the person wrote something. */
export function isMeaningful(draft: Pick<ReportDraft, "message">): boolean {
  return draft.message.trim().length > 0;
}

export type DraftError = "empty" | "tooShort" | "noArea" | null;

export function validateDraft(draft: Pick<ReportDraft, "area" | "message">): DraftError {
  const length = draft.message.trim().length;
  if (length === 0) return "empty";
  if (length < MIN_REPORT_LENGTH) return "tooShort";
  if (!draft.area) return "noArea";
  return null;
}

export async function loadDraft(scope: string): Promise<ReportDraft | null> {
  try {
    return parseDraft(await AsyncStorage.getItem(key(scope)));
  } catch {
    return null;
  }
}

export async function saveDraft(scope: string, draft: ReportDraft): Promise<void> {
  try {
    if (!isMeaningful(draft)) await AsyncStorage.removeItem(key(scope));
    else await AsyncStorage.setItem(key(scope), JSON.stringify(draft));
  } catch {
    // Storage unavailable: the form still works for this visit.
  }
}

export async function clearDraft(scope: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(scope));
  } catch {
    // nothing to clear
  }
}
