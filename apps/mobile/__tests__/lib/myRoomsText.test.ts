jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { Room } from "@/stores/appStore";
import { buildDashboard } from "@/lib/housekeeping/myRoomsDashboard";
import {
  cardAccessibilityLabel,
  describeAccess,
  describeAttention,
  locationLabel,
} from "@/lib/housekeeping/myRoomsText";

const NOW = new Date("2026-10-08T15:00:00.000Z");
const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key);

function entryFor(overrides: Partial<Room>) {
  const room: Room = {
    id: "r1",
    room_number: "224",
    floor: 2,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    clean_type: "DEP",
    clean_type_label: "Departure",
    actual_checkout_at: "2026-10-08T12:00:00.000Z",
    ...overrides,
  };
  const model = buildDashboard([room], {}, NOW);
  return [...model.upNext, ...model.attention, ...model.current][0];
}

describe("access copy never implies a guest left", () => {
  it("says 'checkout not verified' once the scheduled time has passed", () => {
    const entry = entryFor({ actual_checkout_at: null, checkout_time: "2026-10-08T11:00:00.000Z", status: "OCCUPIED" });
    expect(entry.category).toBe("attention");
    expect(describeAccess(entry, t)).toBe("rooms.dash.access.checkoutNotVerified");
    expect(describeAttention(entry, t).details).toContain("rooms.dash.attention.checkout_unverified.detail");
  });

  it("reports a verified checkout with its time, a future one as scheduled, DND and declined plainly", () => {
    expect(describeAccess(entryFor({}), t)).toMatch(/^rooms\.dash\.access\.checkoutVerified /);
    expect(
      describeAccess(entryFor({ actual_checkout_at: null, checkout_time: "2026-10-08T20:00:00.000Z" }), t),
    ).toMatch(/^rooms\.dash\.access\.scheduledCheckout /);
    expect(describeAccess(entryFor({ dnd_flag: true }), t)).toBe("rooms.dash.access.dnd");
    expect(describeAccess(entryFor({ do_not_service: true }), t)).toBe("rooms.dash.access.doNotService");
    expect(describeAccess(entryFor({ clean_type: "FULL", clean_type_label: "Full", actual_checkout_at: null, fo_status: "OCC" }), t)).toBe(
      "rooms.dash.access.occupied",
    );
  });
});

describe("attention copy", () => {
  it("includes the retry time and recorded attempts for DND", () => {
    const entry = entryFor({ dnd_flag: true, dnd_retry_at: "2026-10-08T18:30:00.000Z", dnd_attempt_count: 2 });
    const copy = describeAttention(entry, t, { language: "en" });
    expect(copy.title).toBe("rooms.dash.attention.dnd.title");
    expect(copy.details[0]).toBe("rooms.dash.attention.dnd.detail");
    expect(copy.details.some((line) => line.startsWith("rooms.dash.attention.retryAt"))).toBe(true);
    expect(copy.details.some((line) => line.includes('"count":2'))).toBe(true);
  });

  it("names the decline reason, and strips the BLOCKER prefix from attendant notes", () => {
    const stay = { clean_type: "FULL", clean_type_label: "Full", actual_checkout_at: null, fo_status: "OCC" as const };
    const declined = describeAttention(entryFor({ ...stay, do_not_service: true, service_declined_reason: "privacy_request", service_declined_note: "Sleeping baby" }), t);
    expect(declined.title).toBe("rooms.dash.attention.service_declined.title");
    expect(declined.details).toEqual(["rooms.dash.attention.declineReasons.privacy_request", "Sleeping baby"]);
    expect(describeAttention(entryFor({ latest_note: "BLOCKER: Guest inside" }), t).details[0]).toBe("Guest inside");
  });

  it("shows a come-back-later retry in hotel time and keeps the next-strongest reason visible", () => {
    const entry = entryFor({
      clean_type: "FULL",
      clean_type_label: "Full",
      actual_checkout_at: null,
      fo_status: "OCC",
      dnd_retry_at: "2099-10-08T18:30:00.000Z",
      dnd_attempt_count: 1,
      open_work_order_id: "wo-1",
    });
    const copy = describeAttention(entry, t, { language: "en", timeZone: "America/Chicago" });
    expect(copy.title).toBe("rooms.dash.attention.come_back_later.title");
    expect(copy.details[0].replace(/\u202f/g, " ")).toContain('"time":"1:30 PM"');
    expect(copy.details.some((line) => line.startsWith("rooms.dash.attention.also"))).toBe(true);
  });
});

describe("labels", () => {
  it("builds a screen-reader label with room, rush, status, type, access and the action", () => {
    const label = cardAccessibilityLabel(entryFor({ priority: 1, priority_needed_by: "2099-10-08T19:00:00Z" }), t, { language: "en" });
    expect(label.split(", ")[0]).toContain("rooms.dash.card.room");
    expect(label).toContain("rooms.dash.card.rushA11y");
    expect(label).toContain("rooms.card.status.DIRTY");
    expect(label).toContain("rooms.card.cleanType.DEP");
    expect(label).toContain("rooms.dash.access.checkoutVerified");
    expect(label.endsWith("rooms.dash.card.open")).toBe(true);
  });

  it("describes location from real floor/building data only", () => {
    expect(locationLabel({ floor: 2, building: "East" } as Room, t)).toBe(
      'rooms.dash.card.floor {"floor":2} · rooms.dash.card.building {"name":"East"}',
    );
    expect(locationLabel({ floor: 2, building: null } as Room, t)).toBe('rooms.dash.card.floor {"floor":2}');
    expect(locationLabel({ floor: null as unknown as number } as Room, t)).toBeNull();
  });
});

describe("rooms.dash locale parity", () => {
  function leaves(value: unknown, prefix = ""): string[] {
    if (value === null || typeof value !== "object") return [prefix];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leaves(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it("has the same keys and the same interpolation placeholders in English and Spanish", () => {
    const enLeaves = leaves(en.rooms.dash).sort();
    const esLeaves = leaves((es as typeof en).rooms.dash).sort();
    expect(esLeaves).toEqual(enLeaves);

    const lookup = (root: unknown, path: string) =>
      path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root) as string;
    const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const path of enLeaves) {
      expect(placeholders(lookup((es as typeof en).rooms.dash, path))).toEqual(placeholders(lookup(en.rooms.dash, path)));
    }
  });
});
