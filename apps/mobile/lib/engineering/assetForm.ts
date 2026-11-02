/* ─── Equipment register / edit form model ──────────────────────────────────
   Pure rules for the Register Equipment and Edit Equipment screens: the form's shape, validation, the exact request
   bodies, and how a failed save is explained. The server stays the authority (tenant scope, tag uniqueness, role,
   version check); everything here only keeps the person from sending a request the API would refuse, and says what
   went wrong in words when it does. */

import type { AssetDetail } from "@/lib/api/assets";
import type { ReportLocation } from "@/lib/engineering/reportIssue";

export const CRITICALITY_LEVELS = ["low", "medium", "high", "life_safety"] as const;
export type Criticality = (typeof CRITICALITY_LEVELS)[number];

/** Mirrors apps/api models/requests.py limits and ASSET_TAG_RE. */
export const ASSET_TEXT_MAX = 120;
export const ASSET_LOCATION_MAX = 255;
export const ASSET_NOTES_MAX = 2000;
export const ASSET_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/#]{0,63}$/;

export interface AssetFormValues {
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  assetTag: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  /** A guest room (real id) or a free-text area such as "Roof" - shared equipment needs no room. */
  location: ReportLocation | null;
  /** Extra detail about where, kept alongside a room ("behind the vanity"). A free-text area is its own location text. */
  locationNote: string;
  installationDate: string;
  warrantyExpires: string;
  criticality: Criticality;
  notes: string;
}

export const EMPTY_ASSET_FORM: AssetFormValues = {
  name: "",
  categoryId: null,
  categoryName: null,
  assetTag: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  location: null,
  locationNote: "",
  installationDate: "",
  warrantyExpires: "",
  criticality: "medium",
  notes: "",
};

export type AssetFieldError =
  | "name_required"
  | "name_too_long"
  | "category_required"
  | "tag_invalid"
  | "tag_in_use"
  | "text_too_long"
  | "date_invalid"
  | "install_too_far_ahead"
  | "warranty_before_install"
  | "location_too_long"
  | "notes_too_long";

export type AssetFieldKey = "name" | "categoryId" | "assetTag" | "manufacturer" | "model" | "serialNumber" | "location" | "installationDate" | "warrantyExpires" | "notes";
export type AssetFormErrors = Partial<Record<AssetFieldKey, AssetFieldError>>;

/** `YYYY-MM-DD` that is a real calendar day. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A device-local Date to the `YYYY-MM-DD` the API stores (no timezone shift). */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromIsoDate(value: string): Date | null {
  if (!isIsoDate(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function validateAssetForm(values: AssetFormValues, today: Date = new Date()): AssetFormErrors {
  const errors: AssetFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "name_required";
  else if (name.length > ASSET_TEXT_MAX) errors.name = "name_too_long";
  if (!values.categoryId) errors.categoryId = "category_required";

  const tag = values.assetTag.trim();
  if (tag && !ASSET_TAG_PATTERN.test(tag)) errors.assetTag = "tag_invalid";
  for (const key of ["manufacturer", "model", "serialNumber"] as const) {
    if (values[key].trim().length > ASSET_TEXT_MAX) errors[key] = "text_too_long";
  }
  if (values.location?.kind === "other" && values.location.text.trim().length > ASSET_LOCATION_MAX) errors.location = "location_too_long";
  if (values.locationNote.trim().length > ASSET_LOCATION_MAX) errors.location = "location_too_long";
  if (values.notes.trim().length > ASSET_NOTES_MAX) errors.notes = "notes_too_long";

  const installed = values.installationDate.trim();
  const warranty = values.warrantyExpires.trim();
  if (installed && !isIsoDate(installed)) errors.installationDate = "date_invalid";
  if (warranty && !isIsoDate(warranty)) errors.warrantyExpires = "date_invalid";
  if (!errors.installationDate && installed) {
    const limit = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    if (toIsoDate(limit) < installed) errors.installationDate = "install_too_far_ahead";
  }
  if (!errors.installationDate && !errors.warrantyExpires && installed && warranty && warranty < installed) errors.warrantyExpires = "warranty_before_install";
  return errors;
}

/** The form state for an existing record (Edit). Missing values stay empty: nothing is invented. */
export function formFromAsset(asset: AssetDetail): AssetFormValues {
  const roomNumber = asset.rooms?.room_number;
  const location: ReportLocation | null =
    asset.room_id && roomNumber
      ? { kind: "room", roomId: asset.room_id, roomNumber, floor: asset.rooms?.floor ?? null }
      : asset.location_text?.trim()
        ? { kind: "other", text: asset.location_text.trim() }
        : null;
  const level = (CRITICALITY_LEVELS as readonly string[]).includes(asset.criticality ?? "") ? (asset.criticality as Criticality) : "medium";
  return {
    name: asset.name ?? "",
    categoryId: asset.category_id ?? null,
    categoryName: asset.asset_categories?.name ?? null,
    assetTag: asset.asset_tag?.trim() ?? "",
    manufacturer: asset.manufacturer?.trim() ?? "",
    model: asset.model?.trim() ?? "",
    serialNumber: asset.serial_number?.trim() ?? "",
    location,
    locationNote: asset.room_id && roomNumber ? (asset.location_text?.trim() ?? "") : "",
    installationDate: asset.installation_date ?? "",
    warrantyExpires: asset.warranty_expires ?? "",
    criticality: level,
    notes: asset.notes?.trim() ?? "",
  };
}

/** What the form means as database columns, with empty text normalised to "not recorded". */
interface Columns {
  name: string;
  category_id: string | null;
  asset_tag: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  room_id: string | null;
  location_text: string | null;
  installation_date: string | null;
  warranty_expires: string | null;
  criticality: Criticality;
  notes: string | null;
}

const blank = (text: string): string | null => text.trim() || null;

function toColumns(values: AssetFormValues): Columns {
  const room = values.location?.kind === "room" ? values.location : null;
  return {
    name: values.name.trim(),
    category_id: values.categoryId,
    asset_tag: blank(values.assetTag),
    manufacturer: blank(values.manufacturer),
    model: blank(values.model),
    serial_number: blank(values.serialNumber),
    room_id: room?.roomId ?? null,
    location_text: room ? blank(values.locationNote) : values.location?.kind === "other" ? blank(values.location.text) : null,
    installation_date: blank(values.installationDate),
    warranty_expires: blank(values.warrantyExpires),
    criticality: values.criticality,
    notes: blank(values.notes),
  };
}

/** The POST /assets body. `id` is generated once per form so a retry of the same registration cannot create a second asset. */
export function buildCreateBody(values: AssetFormValues, id: string): Record<string, unknown> {
  const columns = toColumns(values);
  const body: Record<string, unknown> = { id, name: columns.name, category_id: columns.category_id, criticality: columns.criticality };
  for (const key of ["asset_tag", "manufacturer", "model", "serial_number", "room_id", "location_text", "installation_date", "warranty_expires", "notes"] as const) {
    if (columns[key] != null) body[key] = columns[key];
  }
  return body;
}

/**
 * The PATCH /assets/{id} body: only what the person changed against `base`, with fields they emptied named in
 * `clear_fields` (an omitted field is never touched). Null when nothing changed.
 */
export function buildUpdateBody(base: AssetFormValues, values: AssetFormValues, expectedRowVersion: number | null | undefined): Record<string, unknown> | null {
  const before = toColumns(base);
  const after = toColumns(values);
  const body: Record<string, unknown> = {};
  const clear: string[] = [];
  const REQUIRED = ["name", "category_id", "criticality"] as const;
  for (const key of REQUIRED) {
    if (before[key] !== after[key] && after[key] != null) body[key] = after[key];
  }
  for (const key of ["asset_tag", "manufacturer", "model", "serial_number", "room_id", "location_text", "installation_date", "warranty_expires", "notes"] as const) {
    if (before[key] === after[key]) continue;
    if (after[key] == null) clear.push(key);
    else body[key] = after[key];
  }
  if (Object.keys(body).length === 0 && clear.length === 0) return null;
  if (clear.length > 0) body.clear_fields = clear;
  if (expectedRowVersion != null) body.expected_row_version = expectedRowVersion;
  return body;
}

export function assetFormChanged(base: AssetFormValues, values: AssetFormValues): boolean {
  return buildUpdateBody(base, values, null) != null;
}

/** Has the person typed or chosen anything on a blank registration form? */
export function registrationStarted(values: AssetFormValues): boolean {
  return buildUpdateBody(EMPTY_ASSET_FORM, values, null) != null;
}

/* ── Failures ── */

export type SaveFailure =
  | { kind: "tag_in_use" }
  | { kind: "conflict"; current: AssetDetail | null }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "validation"; message: string | null }
  | { kind: "has_open_work"; code: string }
  /** No answer: the request may or may not have landed. Retrying a registration is safe (same id); an edit re-reads first. */
  | { kind: "unconfirmed" }
  | { kind: "failed" };

export function classifySaveFailure(error: unknown): SaveFailure {
  const e = error as { status?: unknown; code?: unknown; detail?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  const code = typeof e?.code === "string" ? e.code : null;
  if (status == null) {
    const message = typeof e?.message === "string" ? e.message : "";
    return /network request failed|failed to fetch|timed out|timeout|offline|aborted/i.test(message) ? { kind: "unconfirmed" } : { kind: "failed" };
  }
  if (code === "asset_tag_in_use") return { kind: "tag_in_use" };
  if (code === "asset_conflict") {
    const current = (e?.detail as { current?: AssetDetail | null } | undefined)?.current ?? null;
    return { kind: "conflict", current };
  }
  if (code === "asset_has_open_work_orders" || code === "asset_has_open_downtime" || code === "asset_already_retired") return { kind: "has_open_work", code };
  if (status === 401 || status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "not_found" };
  if (status === 409) return { kind: "failed" };
  if (status === 400 || status === 422) return { kind: "validation", message: typeof e?.message === "string" ? e.message : null };
  return { kind: "failed" };
}

/**
 * The detail screen's cached record after a confirmed save. The server's PATCH answer is the bare row, so the joined
 * pieces the screen reads (category name, room) are rebuilt from what the person just saved, and everything derived
 * (service status, schedules, counts) is kept from the record they were editing; the next read replaces it all.
 */
export function mergeSavedAsset(
  original: AssetDetail,
  saved: AssetDetail,
  values: AssetFormValues,
  categories: ReadonlyArray<{ id: string; name: string; code?: string | null }>,
): AssetDetail {
  const room = values.location?.kind === "room" ? values.location : null;
  const category = categories.find((c) => c.id === values.categoryId);
  return {
    ...original,
    ...saved,
    asset_categories: category ? { name: category.name, code: category.code ?? null } : original.category_id === saved.category_id ? original.asset_categories : null,
    rooms: room ? { room_number: room.roomNumber, floor: room.floor ?? null, building: original.room_id === room.roomId ? (original.rooms?.building ?? null) : null } : null,
    pm_schedules: original.pm_schedules,
    active_downtime: original.active_downtime,
    service_status: original.service_status,
    active_work_order_count: original.active_work_order_count,
    repeat_repairs_90d: original.repeat_repairs_90d,
    administrative_status: original.administrative_status,
    photo_url: saved.photo_url !== undefined ? saved.photo_url : original.photo_url,
  };
}
