import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Room } from "@/stores/appStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { buildHomeModel, type HomeBoardInput } from "@/lib/housekeeping/homeModel";
import { buildAttentionPreview, resolveHomeState } from "@/lib/housekeeping/homeState";
import {
  dayPartOf,
  describeAttentionRow,
  describeNotice,
  describeRecommendation,
  describeSync,
  headerMeta,
  hotelHour,
  roomContext,
} from "@/lib/housekeeping/homeText";
import { resolveShiftLifecycle } from "@/lib/housekeeping/shiftLifecycle";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { localeHasKey, makeTranslator } from "../helpers/i18n";

const NOW = new Date("2026-10-14T15:00:00.000Z");
const TODAY = "2026-10-14";
const ZONE = "America/Chicago";
const t = makeTranslator("en");
const tEs = makeTranslator("es");
const ctx = { language: "en", timeZone: ZONE };

function room(id: string, overrides: Partial<Room> = {}): Room {
  return {
    id,
    room_number: id.replace(/\D/g, "") || id,
    floor: 2,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    actual_checkout_at: "2026-10-14T12:00:00.000Z",
    clean_type: "DEP",
    clean_type_label: "Departure",
    assignment_date: TODAY,
    ...overrides,
  };
}

const lifecycle = resolveShiftLifecycle({
  current: null,
  lastEnded: null,
  serverConfirmed: true,
  lastFetchFailed: false,
  pendingOp: null,
  shiftDate: TODAY,
  timeZone: ZONE,
  isOnline: true,
});

const board: HomeBoardInput = {
  loading: false,
  refreshing: false,
  confirmedEmpty: false,
  freshness: "fresh",
  fetchError: null,
  usingCache: false,
  lastRefreshAt: NOW.getTime() - 30_000,
  serverShiftDate: TODAY,
  answeredForDate: TODAY,
};

function build(
  rooms: Room[],
  opts: { online?: boolean; board?: Partial<HomeBoardInput>; syncRows?: SyncRow[]; syncComplete?: boolean; sessions?: Record<string, LocalCleanSession> } = {},
) {
  return buildHomeModel({
    rooms,
    sessions: opts.sessions ?? {},
    rankedAt: NOW,
    now: NOW,
    expectedShiftDate: TODAY,
    timeZone: ZONE,
    isOnline: opts.online ?? true,
    board: { ...board, ...opts.board },
    lifecycle,
    syncRows: opts.syncRows ?? [],
    syncRowsComplete: opts.syncComplete ?? true,
    supervisorNote: null,
  });
}

describe("hotel-local time", () => {
  it("reads the hour in the hotel's zone, not the device's", () => {
    // 03:00 UTC is 22:00 the previous evening in Chicago (CDT).
    const instant = new Date("2026-10-14T03:00:00.000Z");
    expect(hotelHour(ZONE, instant)).toBe(22);
    expect(dayPartOf(ZONE, instant)).toBe("evening");
    expect(dayPartOf("Asia/Tokyo", instant)).toBe("afternoon"); // 12:00 JST
    expect(dayPartOf(ZONE, new Date("2026-10-14T14:00:00.000Z"))).toBe("morning"); // 09:00
  });

  it("falls back to the device clock for an unknown zone", () => {
    expect(hotelHour("Not/AZone", NOW)).toBe(NOW.getHours());
  });

  it("builds the meta line from the hotel's shift date", () => {
    const model = build([room("101")]);
    expect(headerMeta(model, "en", "morning", t)).toBe("WEDNESDAY, OCT 14 · MORNING");
    expect(headerMeta(model, "es", "morning", tEs)).toBe("MIÉRCOLES, 14 DE OCT · MAÑANA");
  });
});

describe("sync wording is honest", () => {
  it("says 'All changes synced' only when everything is sent and fresh", () => {
    const text = describeSync(build([room("101")]), t, ctx);
    expect(text.tone).toBe("ok");
    expect(text.text).toMatch(/^All changes synced · /);
  });

  it("never says 'synced' while changes are waiting", () => {
    const row = { key: "k", kind: "checklist", state: "pending", roomId: "101", count: 3 } as unknown as SyncRow;
    const result = describeSync(build([room("101")], { syncRows: [row] }), t, ctx);
    expect(result.text).not.toMatch(/synced/i);
    expect(result.text).toBe("3 saved on this phone, not sent yet");
    expect(result.tone).toBe("warn");
  });

  it("never says 'synced' offline, and states the last good time", () => {
    const result = describeSync(build([room("101")], { online: false }), t, ctx);
    expect(result.text).toMatch(/^Offline · last updated /);
    expect(result.text).not.toMatch(/All changes synced/);
  });

  it("flags failures that need the person", () => {
    const row = { key: "k", kind: "completion", state: "failed", roomId: "101", count: 1 } as unknown as SyncRow;
    expect(describeSync(build([room("101")], { syncRows: [row] }), t, ctx).tone).toBe("alert");
  });

  it("does not claim 'nothing waiting' when a queue could not be read", () => {
    const result = describeSync(build([room("101")], { syncComplete: false }), t, ctx);
    expect(result.text).not.toMatch(/synced/i);
  });

  it("shows stale and cached lists as such", () => {
    const result = describeSync(build([room("101")], { board: { freshness: "stale" } }), t, ctx);
    expect(result.text).toMatch(/^Showing saved rooms — last updated /);
  });

  it("describes offline versus refresh failure as different conditions", () => {
    const offline = describeNotice({ kind: "offline", lastRefreshAt: NOW.toISOString() }, t, ctx);
    const failed = describeNotice({ kind: "refresh_failed", lastRefreshAt: NOW.toISOString() }, t, ctx);
    expect(offline.title).not.toBe(failed.title);
    expect(offline.body).toMatch(/Last updated /);
  });
});

describe("recommendation wording", () => {
  it("explains a departure with a guest arriving, from verified data only", () => {
    const model = build([room("215", { checkin_time: "2026-10-14T16:30:00.000Z", clean_type: "DEP" })]);
    const lead = resolveHomeState(model).lead!;
    const copy = describeRecommendation(lead, t, ctx);
    expect(copy.headline).toBe("Arrival 11:30 AM");
    expect(copy.why.some((line) => /guest is arriving soon/i.test(line))).toBe(true);
    // the estimate is labelled as an estimate, not a promise
    expect(copy.why[copy.why.length - 1]).toMatch(/estimate, not a deadline/);
    expect(roomContext(lead.room, t)).toBe("Departure · Floor 2");
  });

  it("does not turn a scheduled checkout into 'the guest left'", () => {
    const model = build([room("215", { actual_checkout_at: null, checkout_time: "2026-10-14T13:00:00.000Z", status: "DIRTY" })]);
    const lead = resolveHomeState(model).lead;
    if (lead) {
      const copy = describeRecommendation(lead, t, ctx);
      expect(copy.why.join(" ")).not.toMatch(/confirmed checkout/i);
    }
  });
});

describe("attention row wording", () => {
  it("names the room and the reason, with the retry time for DND", () => {
    const model = build([
      room("214", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, dnd_retry_at: "2026-10-14T16:30:00.000Z" } as Partial<Room>),
    ]);
    const row = buildAttentionPreview(model).shown[0];
    const copy = describeAttentionRow(row, model.supervisorInstruction, t, ctx);
    expect(copy.title).toBe("Room 214 · DND");
    expect(copy.detail).toBe("Retry at 11:30 AM");
  });
});

/* ─── Locale coverage for everything Home asks for ─────────────────────────── */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

const ROOT = resolve(__dirname, "../..");
const SOURCES = [
  "components/home/HousekeeperHomeScreen.tsx",
  "components/home/HomeHeader.tsx",
  "components/home/HomeStateCards.tsx",
  "components/home/CurrentRoomCard.tsx",
  "components/home/NeedsAttentionPreview.tsx",
  "components/home/ShiftProgressSummary.tsx",
  "components/home/UpNextPreview.tsx",
  "components/home/ShiftControlCard.tsx",
  "lib/housekeeping/homeText.ts",
];

describe("Home strings exist in English and Spanish", () => {
  it("carry exactly the same home.* keys in both languages", () => {
    const enKeys = leaves(en.home as Tree).sort();
    const esKeys = leaves(es.home as Tree).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("have every statically requested key in both languages (no raw keys on a phone)", () => {
    const missing: string[] = [];
    for (const file of SOURCES) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const match of source.matchAll(/\bt\(\s*["'`]([a-zA-Z0-9_.]+)["'`]/g)) {
        const key = match[1];
        if (key.includes("..")) continue;
        for (const lang of ["en", "es"] as const) {
          if (!localeHasKey(lang, key)) missing.push(`${lang}:${key} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("have every dynamically built key family in both languages", () => {
    const families = [
      ...["morning", "afternoon", "evening"].map((p) => `home.header.part.${p}`),
      ...["unknown", "notStarted", "active", "onBreak", "ending", "ended"].map((s) => `home.header.shift.${s}`),
      ...["queued", "submitted", "inspected"].flatMap((k) => [`home.submitted.${k}Title`, `home.submitted.${k}Body`]),
      ...["rush_overdue", "supervisor_message", "sync_conflict", "sync_failed", "session_missing", "session_unassigned"].map(
        (c) => `home.attention.codes.${c}`,
      ),
      ...["activeSession", "sequence", "rush", "reclean", "arrival", "checkoutVerified", "queue"].map((r) => `home.why.${r}`),
    ];
    const missing = families.flatMap((key) => (["en", "es"] as const).filter((l) => !localeHasKey(l, key)).map((l) => `${l}:${key}`));
    expect(missing).toEqual([]);
  });

  it("renders plurals in both languages", () => {
    expect(t("home.before.assigned", { count: 1 })).toBe("1 room assigned today");
    expect(t("home.before.assigned", { count: 12 })).toBe("12 rooms assigned today");
    expect(tEs("home.before.assigned", { count: 12 })).toBe("12 cuartos asignados hoy");
  });
});
