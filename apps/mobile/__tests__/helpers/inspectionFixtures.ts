import type { InspectionRecordRow, InspectionTemplate, OpenCorrectionRow, ReadyRoom } from "@/lib/api/inspections";
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

/** A failed inspection whose correction is still open, as GET /housekeeping/inspections/corrections returns it. */
export function openCorrection(roomNumber: string, overrides: Partial<OpenCorrectionRow> = {}): OpenCorrectionRow {
  return {
    inspection_id: `insp-${roomNumber}`,
    room_id: `room-${roomNumber}`,
    room_number: roomNumber,
    floor: Number(roomNumber[0]) || null,
    building: null,
    inspected_at: "2026-10-20T14:00:00.000Z",
    overall_result: "failed",
    kind: "reclean",
    status: "assigned",
    notes: null,
    inspector_name: "Sam",
    failed_count: 2,
    failed_items: [
      { id: "a", label: "Mirror streaked", note: null },
      { id: "b", label: "Floor not vacuumed", note: null },
    ],
    task: { id: `task-${roomNumber}`, status: "open", assigned_to: "hk-1", assigned_name: "Hana", due_at: null, started_at: null, completed_at: null },
    ...overrides,
  };
}

/** One row of today's inspections. `inspector_display_name` is a real name or null - never an id. */
export function inspectionRecord(id: string, overrides: Partial<InspectionRecordRow> = {}): InspectionRecordRow {
  return {
    id,
    room_id: `room-${id}`,
    room_number: id,
    floor: 2,
    building: null,
    inspector_name: "a1b2c3d4",
    inspector_display_name: "Sam Supervisor",
    overall_result: "passed",
    notes: null,
    completed_at: "2026-10-20T16:00:00.000Z",
    reinspection_of: null,
    ...overrides,
  };
}
