import AsyncStorage from "@react-native-async-storage/async-storage";
import secureSessionStorage from "@/lib/auth/secureSessionStorage";

/* ─── Saved assistant conversations ─────────────────────────────────────────
   One short conversation per person per hotel, in the device's secure store
   (Keychain / Keystore; plain storage only on the web dev build). It keeps just
   enough to continue a thought: recent text only, never previews, sources or
   anything the person was about to create, and nothing older than a day.

   The old build kept a single unscoped list under `@patelrep/copilot_history`.
   Its owner cannot be known, so it is never shown to anyone: it is deleted the
   first time history is touched. */

export const LEGACY_HISTORY_KEY = "@patelrep/copilot_history";

export const HISTORY_LIMITS = {
  messages: 20,
  ttlMs: 24 * 60 * 60 * 1000,
  contentChars: 1000,
} as const;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ms epoch */
  at: number;
}

/** SecureStore keys may only hold letters, digits, ".", "-" and "_". */
export function historyKey(scope: string): string {
  return `patelrep.ai.history.v2.${scope.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// US-style numbers with separators, or any run of 10+ digits; lists of room numbers ("412 413") are not matched.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,}\b/g;

/** Contact details are not needed to continue a conversation, so they are not kept. */
export function redact(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[number]");
}

export interface PersistableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  /**
   * An assistant message whose card is never saved (it proposed something to create, or it showed live data);
   * it and the question that led to it are not saved either. (Named for the first case it covered.)
   */
  proposedGuestRequest?: boolean;
  /** Notices (offline, credit limit, ...) are not part of the conversation. */
  notice?: boolean;
}

/** What may be written to disk from the live conversation. */
export function toStoredMessages(messages: PersistableMessage[], now: number = Date.now()): StoredMessage[] {
  const skipped = new Set<number>();
  messages.forEach((message, index) => {
    if (message.notice) skipped.add(index);
    if (message.role === "assistant" && message.proposedGuestRequest) {
      skipped.add(index);
      if (index > 0 && messages[index - 1].role === "user") skipped.add(index - 1);
    }
  });
  return messages
    .filter((_, index) => !skipped.has(index))
    .filter((message) => now - message.at <= HISTORY_LIMITS.ttlMs && message.content.trim() !== "")
    .slice(-HISTORY_LIMITS.messages)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: redact(message.content).slice(0, HISTORY_LIMITS.contentChars),
      at: message.at,
    }));
}

function parseStored(raw: string | null, now: number): StoredMessage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StoredMessage[] = [];
  for (const item of parsed) {
    const m = item as Partial<StoredMessage> | null;
    if (
      m &&
      typeof m.id === "string" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      typeof m.at === "number" &&
      now - m.at <= HISTORY_LIMITS.ttlMs
    ) {
      out.push({ id: m.id, role: m.role, content: m.content.slice(0, HISTORY_LIMITS.contentChars), at: m.at });
    }
  }
  return out.slice(-HISTORY_LIMITS.messages);
}

let legacyPurged = false;

/** Delete the unscoped history from older builds. Never read, never migrated, never shown. */
export async function purgeLegacyHistory(): Promise<void> {
  if (legacyPurged) return;
  try {
    await AsyncStorage.removeItem(LEGACY_HISTORY_KEY);
    legacyPurged = true;
  } catch {
    // Retried the next time history is touched.
  }
}

/** Test seam. */
export function resetLegacyPurgeFlag(): void {
  legacyPurged = false;
}

export async function loadHistory(scope: string, now: number = Date.now()): Promise<StoredMessage[]> {
  await purgeLegacyHistory();
  try {
    return parseStored(await secureSessionStorage.getItem(historyKey(scope)), now);
  } catch {
    return [];
  }
}

export async function saveHistory(scope: string, messages: PersistableMessage[], now: number = Date.now()): Promise<void> {
  const stored = toStoredMessages(messages, now);
  try {
    if (stored.length === 0) await secureSessionStorage.removeItem(historyKey(scope));
    else await secureSessionStorage.setItem(historyKey(scope), JSON.stringify(stored));
  } catch {
    // History is a convenience; a storage failure must never break the conversation.
  }
}

/** "Clear history": removes this person's saved conversation. */
export async function clearHistory(scope: string): Promise<void> {
  try {
    await secureSessionStorage.removeItem(historyKey(scope));
  } catch {
    // Nothing more to do; the in-memory conversation is cleared separately.
  }
}
