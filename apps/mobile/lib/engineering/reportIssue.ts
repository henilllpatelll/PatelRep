/* ─── Report an Issue ───────────────────────────────────────────────────────
   Pure rules for the one shared "create a maintenance request" form: what a draft holds, what the API will
   accept, how a draft becomes a POST /work-orders body and how an attempt is described honestly (created,
   saved on this device, or refused). Every entry point (Home, Work, Room Detail, Asset Detail) uses these.
   Category, priority and source values mirror CreateWorkOrderRequest; the server is the authority. */

import { buildCreateBody, validateAvailability, type AvailabilityDraft, type AvailabilityError, type AvailabilityReason } from "@/lib/engineering/roomAvailability";
import type { CreateWorkOrderPayload } from "@/lib/api/workOrders";
import type { WorkOrderPriority } from "@/lib/engineering/workOrders";

export const REPORT_CATEGORIES = [
  "hvac",
  "plumbing",
  "electrical",
  "doors_locks",
  "appliance",
  "furniture",
  "structural",
  "painting",
  "safety",
  "general",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_PRIORITIES: readonly WorkOrderPriority[] = ["emergency", "urgent", "normal", "low"];
export const REPORT_SOURCES = ["self", "guest", "staff_patrol", "pm"] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const ASSET_IMPACTS = ["operating", "degraded", "out_of_service"] as const;
export type AssetImpact = (typeof ASSET_IMPACTS)[number];

/** API: title <= 120, description <= 2000, location text <= 255. */
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const LOCATION_TEXT_MAX = 255;
export const MAX_REPORT_PHOTOS = 4;

/** Places that are not guest rooms. These are suggestions typed into the free-text location, not configured records. */
export const LOCATION_SUGGESTIONS = ["lobby", "pool", "laundry", "mechanical_room", "parking", "exterior"] as const;

export type ReportLocation =
  | { kind: "room"; roomId: string; roomNumber: string; floor?: number | null }
  | { kind: "other"; text: string };

export interface ReportAsset {
  id: string;
  name: string;
  /** The equipment's own category code (HVAC...). Used to pre-select a matching work order category, never to invent one. */
  categoryCode?: string | null;
  roomId?: string | null;
  roomNumber?: string | null;
  locationText?: string | null;
}

export interface ReportRepeat {
  id: string;
  label: string;
}

export interface ReportDraft {
  location: ReportLocation | null;
  title: string;
  description: string;
  category: ReportCategory;
  priority: WorkOrderPriority;
  emergencyConfirmed: boolean;
  source: ReportSource;
  asset: ReportAsset | null;
  assetImpact: AssetImpact;
  assignToMe: boolean;
  repeatOf: ReportRepeat | null;
  /** Set only when the person chose to take the room down together with this report. */
  roomDown: AvailabilityDraft | null;
}

export const EMPTY_REPORT_DRAFT: ReportDraft = {
  location: null,
  title: "",
  description: "",
  category: "general",
  priority: "normal",
  emergencyConfirmed: false,
  source: "self",
  asset: null,
  assetImpact: "operating",
  assignToMe: false,
  repeatOf: null,
  roomDown: null,
};

export interface ReportPhoto {
  /** Local id, stable across re-renders; never sent to the server. */
  id: string;
  uri: string;
  caption: string;
}

export type ReportError =
  | "location_required"
  | "title_required"
  | "title_too_long"
  | "description_too_long"
  | "location_too_long"
  | "emergency_unconfirmed"
  | "asset_room_mismatch"
  | "impact_needs_asset"
  | "room_down_needs_room";

export interface ReportValidation {
  errors: ReportError[];
  roomDown: AvailabilityError[];
}

export function validateReport(draft: ReportDraft, now: Date = new Date()): ReportValidation {
  const errors: ReportError[] = [];
  if (!draft.location || (draft.location.kind === "other" && !draft.location.text.trim())) errors.push("location_required");
  if (draft.location?.kind === "other" && draft.location.text.trim().length > LOCATION_TEXT_MAX) errors.push("location_too_long");
  const title = draft.title.trim();
  if (!title) errors.push("title_required");
  else if (title.length > TITLE_MAX) errors.push("title_too_long");
  if (draft.description.trim().length > DESCRIPTION_MAX) errors.push("description_too_long");
  if (draft.priority === "emergency" && !draft.emergencyConfirmed) errors.push("emergency_unconfirmed");
  if (draft.assetImpact !== "operating" && !draft.asset) errors.push("impact_needs_asset");
  if (draft.asset?.roomId && draft.location?.kind === "room" && draft.location.roomId !== draft.asset.roomId) errors.push("asset_room_mismatch");
  if (draft.asset?.roomId && draft.location?.kind === "other") errors.push("asset_room_mismatch");
  if (draft.roomDown && draft.location?.kind !== "room") errors.push("room_down_needs_room");
  return { errors, roomDown: draft.roomDown ? validateAvailability(draft.roomDown, now) : [] };
}

export function isReportValid(validation: ReportValidation): boolean {
  return validation.errors.length === 0 && validation.roomDown.length === 0;
}

/** True once the person has typed or chosen anything worth protecting (entry-point prefills do not count). */
export function isReportDirty(draft: ReportDraft, photos: readonly ReportPhoto[], prefill: ReportDraft = EMPTY_REPORT_DRAFT): boolean {
  return Boolean(
    draft.title.trim() ||
      draft.description.trim() ||
      photos.length ||
      draft.priority !== prefill.priority ||
      draft.category !== prefill.category ||
      draft.roomDown ||
      draft.repeatOf ||
      draft.assignToMe ||
      draft.source !== prefill.source ||
      draft.assetImpact !== prefill.assetImpact ||
      JSON.stringify(draft.location) !== JSON.stringify(prefill.location) ||
      draft.asset?.id !== prefill.asset?.id,
  );
}

/** Choosing equipment fills what it knows (its room or location, its trade) and never overwrites what the person typed. */
export function withAsset(draft: ReportDraft, asset: ReportAsset | null): ReportDraft {
  if (!asset) return { ...draft, asset: null, assetImpact: "operating" };
  const next: ReportDraft = { ...draft, asset };
  const code = asset.categoryCode?.trim().toLowerCase();
  if (code && (REPORT_CATEGORIES as readonly string[]).includes(code) && draft.category === "general") next.category = code as ReportCategory;
  if (asset.roomId && asset.roomNumber) next.location = { kind: "room", roomId: asset.roomId, roomNumber: asset.roomNumber };
  else if (!draft.location && asset.locationText?.trim()) next.location = { kind: "other", text: asset.locationText.trim().slice(0, LOCATION_TEXT_MAX) };
  return next;
}

export function setPriority(draft: ReportDraft, priority: WorkOrderPriority): ReportDraft {
  return { ...draft, priority, emergencyConfirmed: priority === "emergency" ? draft.emergencyConfirmed : false };
}

export interface BuildContext {
  requestId: string;
  userId: string | null;
  reasons: readonly AvailabilityReason[];
}

/** The POST /work-orders body. Returns null when the draft is not valid, so an invalid request is never built. */
export function buildReportPayload(draft: ReportDraft, ctx: BuildContext): CreateWorkOrderPayload | null {
  if (!isReportValid(validateReport(draft))) return null;
  const room = draft.location?.kind === "room" ? draft.location : null;
  const roomDown = draft.roomDown && room ? buildCreateBody(room.roomId, draft.roomDown, ctx.reasons) : null;
  if (draft.roomDown && !roomDown) return null;
  return {
    client_request_id: ctx.requestId,
    title: draft.title.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    category: draft.category,
    priority: draft.priority,
    source: draft.source,
    ...(room ? { room_id: room.roomId } : {}),
    ...(!room && draft.location?.kind === "other" ? { location_text: draft.location.text.trim() } : {}),
    ...(draft.asset ? { asset_id: draft.asset.id, ...(draft.assetImpact !== "operating" ? { asset_impact: draft.assetImpact } : {}) } : {}),
    ...(draft.assignToMe && ctx.userId ? { assigned_to: ctx.userId } : {}),
    ...(draft.repeatOf ? { repeat_of_work_order_id: draft.repeatOf.id } : {}),
    ...(roomDown
      ? {
          room_unavailability: {
            room_id: roomDown.room_id,
            type: roomDown.type,
            reason_code: roomDown.reason_code,
            reason_label: roomDown.reason_label,
            expected_return_at: roomDown.expected_return_at,
            ...(roomDown.details ? { details: roomDown.details } : {}),
            source: "MOBILE" as const,
          },
        }
      : {}),
  };
}

/** What the person is told about a submit attempt. `created` is only ever produced from a server answer. */
export type ReportOutcome =
  | { kind: "created"; workOrderId: string | null; workOrderNumber: string | null; status: string | null; replayed: boolean; roomDown: RoomDownResult | null }
  | { kind: "queued"; photosDropped: number }
  | { kind: "failed"; message: string; ambiguous: boolean; status: number | null };

/** Whether the room-down half of a combined request is proven by a fresh read of the room, not assumed. */
export type RoomDownResult = "confirmed" | "unconfirmed";

export function isQueueable(draft: ReportDraft): boolean {
  // A combined room-down request must reach the server in one piece; it is never saved for later.
  return !draft.roomDown;
}

/** Photos are uploaded to the created order; their per-file results decide whether the success screen must say "some photos did not upload". */
export interface PhotoResult {
  id: string;
  ok: boolean;
  message?: string;
}

export function failedPhotos(results: readonly PhotoResult[]): string[] {
  return results.filter((r) => !r.ok).map((r) => r.id);
}

/** Server messages that mean "this exact request can never succeed as written" (so the request id may be rotated). */
export function isDefinitiveRefusal(status: number | null | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type RecentLocation = ReportLocation;

export function sameLocation(a: ReportLocation | null | undefined, b: ReportLocation | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "room" ? a.roomId === (b as typeof a).roomId : a.text.trim().toLowerCase() === (b as typeof a).text.trim().toLowerCase();
}

export function pushRecentLocation(recent: readonly RecentLocation[], next: ReportLocation, max = 5): RecentLocation[] {
  return [next, ...recent.filter((entry) => !sameLocation(entry, next))].slice(0, max);
}
