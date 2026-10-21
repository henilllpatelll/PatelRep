import type { InspectionTemplate, ReadyRoom } from "@/lib/api/inspections";
import { normalizeTemplate } from "@/lib/inspections/templates";
import type { ChecklistTemplate } from "@/lib/inspections/types";

type RawItem = InspectionTemplate["items"][number];

export function rawItem(id: string, overrides: Partial<RawItem> = {}): RawItem {
  return {
    id,
    section: "General",
    description: `Item ${id}`,
    is_required: true,
    requires_photo_on_fail: false,
    allows_na: true,
    sort_order: 0,
    ...overrides,
  };
}

export function rawTemplate(id: string, overrides: Partial<InspectionTemplate> = {}): InspectionTemplate {
  return {
    id,
    name: `Template ${id}`,
    room_type_id: null,
    is_default: false,
    is_active: true,
    fingerprint: `fp-${id}`,
    items: [rawItem(`${id}-a`, { sort_order: 1 }), rawItem(`${id}-b`, { sort_order: 2 })],
    ...overrides,
  };
}

export function template(id: string, overrides: Partial<InspectionTemplate> = {}): ChecklistTemplate {
  const normalized = normalizeTemplate(rawTemplate(id, overrides));
  if (!normalized) throw new Error(`fixture template ${id} is unreadable`);
  return normalized;
}

export function readyRoom(roomId: string, overrides: Partial<ReadyRoom> = {}): ReadyRoom {
  return {
    room_id: roomId,
    room_number: roomId.replace(/\D/g, "") || roomId,
    floor: 2,
    cleaned_by: "Hana",
    cleaned_at: "2026-10-20T15:00:00.000Z",
    housekeeper_id: "hk-1",
    clean_type: "DEP",
    room_type_id: "type-king",
    clean_cycle_id: `cycle-${roomId}`,
    previous_failure: null,
    ...overrides,
  };
}
