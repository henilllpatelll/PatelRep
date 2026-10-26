import type { ChecklistItem, ChecklistTemplate } from "@/lib/inspections/types";

/* ─── Checklist templates — normalise, select, detect edits (pure) ───────────
   Previously the screen took `templates[0]`: whichever template the server happened to list first, for every room.
   Now a room gets its own room type's checklist when the hotel configured one, otherwise the property's designated
   default, and anything unusable is an explicit, named failure — never a guess. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeItem(raw: unknown, index: number): ChecklistItem | null {
  if (!isRecord(raw)) return null;
  const { id, description } = raw;
  if (typeof id !== "string" || !id.trim() || typeof description !== "string" || !description.trim()) return null;
  const section = typeof raw.section === "string" && raw.section.trim() ? raw.section.trim() : "General";
  return {
    id,
    section,
    description: description.trim(),
    // The database defaults: required unless said otherwise, photo not required, N/A allowed.
    isRequired: raw.is_required === false ? false : true,
    requiresPhotoOnFail: raw.requires_photo_on_fail === true,
    allowsNa: raw.allows_na === false ? false : true,
    sortOrder: typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order) ? raw.sort_order : index,
  };
}

/** `null` when the template cannot be used safely (no id, malformed items). One bad item rejects the template. */
export function normalizeTemplate(raw: unknown): ChecklistTemplate | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (!Array.isArray(raw.items)) return null;
  const items: ChecklistItem[] = [];
  for (let index = 0; index < raw.items.length; index += 1) {
    const item = normalizeItem(raw.items[index], index);
    if (!item) return null;
    items.push(item);
  }
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) return null;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    roomTypeId: typeof raw.room_type_id === "string" && raw.room_type_id ? raw.room_type_id : null,
    isDefault: raw.is_default === true,
    // Only an explicit `false` deactivates: an older server that omits the flag only lists active templates.
    isActive: raw.is_active === false ? false : true,
    fingerprint: typeof raw.fingerprint === "string" && raw.fingerprint ? raw.fingerprint : null,
    items: sortChecklistItems(items),
  };
}

export function normalizeTemplates(raw: unknown): { templates: ChecklistTemplate[]; invalid: number } {
  if (!Array.isArray(raw)) return { templates: [], invalid: 1 };
  const templates: ChecklistTemplate[] = [];
  let invalid = 0;
  for (const entry of raw) {
    const template = normalizeTemplate(entry);
    if (template) templates.push(template);
    else invalid += 1;
  }
  return { templates, invalid };
}

/** The configured order: `sortOrder` ascending, ties by id so it never shuffles between renders. */
export function sortChecklistItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ─── Selection ─────────────────────────────────────────────────────────── */

export type TemplateUnavailableReason =
  /** The hotel returned no templates at all. */
  | "no_templates"
  /** Templates exist but every one is inactive or has no items. */
  | "no_usable_template"
  /** Nothing matches this room's type and the property has designated no default. */
  | "no_default"
  /** A type-specific checklist exists but this room's type is unknown, so the right one cannot be chosen. */
  | "room_type_unknown"
  /** The server's answer was not a list of templates the app can read. */
  | "invalid_templates";

export type TemplateBasis =
  /** The checklist configured for this room's own type. */
  | "room_type"
  /** The property's designated default. */
  | "default"
  /** No default is designated, but exactly one active checklist applies to every room type, so there is nothing to choose between. */
  | "sole_general";

export type TemplateWarning = "multiple_room_type_templates" | "multiple_defaults" | "some_templates_unreadable" | "no_designated_default";

export type TemplateSelection =
  | { ok: true; template: ChecklistTemplate; basis: TemplateBasis; warnings: TemplateWarning[] }
  | { ok: false; reason: TemplateUnavailableReason };

function usable(template: ChecklistTemplate): boolean {
  return template.isActive && template.items.length > 0;
}

/** Deterministic pick among equals: the designated default first, then name, then id. */
function pickOne(candidates: readonly ChecklistTemplate[]): ChecklistTemplate {
  return [...candidates].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.name.localeCompare(b.name) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}

/**
 * Choose the checklist for a room.
 *  1. An active, non-empty template for the room's own type.
 *  2. Otherwise the property's designated active default (or, with none designated, the one general checklist).
 *  3. Otherwise a named failure. An inactive, empty, or other-type template is never used.
 * If the room's type is unknown the type-specific templates cannot be ruled in or out, so when any exist this
 * refuses (`room_type_unknown`) instead of quietly falling back to a default that might be the wrong checklist.
 */
export function selectTemplate(
  templates: readonly ChecklistTemplate[],
  roomTypeId: string | null | undefined,
  options: { unreadable?: number } = {},
): TemplateSelection {
  if (options.unreadable && templates.length === 0) return { ok: false, reason: "invalid_templates" };
  if (templates.length === 0) return { ok: false, reason: "no_templates" };
  const candidates = templates.filter(usable);
  if (candidates.length === 0) return { ok: false, reason: "no_usable_template" };

  const warnings: TemplateWarning[] = options.unreadable ? ["some_templates_unreadable"] : [];
  // A typed template that is ALSO the designated default applies to every room (the server agrees), so only
  // non-default typed templates make an unknown room type ambiguous.
  const typeSpecific = candidates.filter((template) => template.roomTypeId !== null && !template.isDefault);

  if (roomTypeId) {
    const exact = candidates.filter((template) => template.roomTypeId === roomTypeId);
    if (exact.length > 0) {
      if (exact.length > 1) warnings.push("multiple_room_type_templates");
      return { ok: true, template: pickOne(exact), basis: "room_type", warnings };
    }
  } else if (typeSpecific.length > 0) {
    return { ok: false, reason: "room_type_unknown" };
  }

  const defaults = candidates.filter((template) => template.isDefault);
  if (defaults.length === 0) {
    // No designated default. A lone checklist that is not tied to any room type is the only one that can apply, so
    // using it is not a guess (hotels set up before "default" existed have exactly this). Two or more would be.
    const general = candidates.filter((template) => template.roomTypeId === null);
    if (general.length === 1) return { ok: true, template: general[0], basis: "sole_general", warnings: [...warnings, "no_designated_default"] };
    return { ok: false, reason: "no_default" };
  }
  if (defaults.length > 1) warnings.push("multiple_defaults");
  return { ok: true, template: pickOne(defaults), basis: "default", warnings };
}

/* ─── Edit detection ────────────────────────────────────────────────────── */

/** Everything that changes what must be answered, as one comparable string (used when no server digest exists). */
export function checklistSignature(template: ChecklistTemplate): string {
  return JSON.stringify([
    template.id,
    template.items.map((item) => [item.id, item.section, item.description, item.isRequired, item.requiresPhotoOnFail, item.allowsNa, item.sortOrder]),
  ]);
}

export type TemplateChange =
  /** Same checklist the supervisor is working from. */
  | "same"
  /** Same template id, different content (an edit replaced its items, wording, or rules). */
  | "changed"
  /** The template is gone, deactivated, or emptied. */
  | "removed";

/**
 * Compare the checklist an inspection was started with against what the server lists now. Uses the server's
 * digest when both sides have one; otherwise compares the structure. A same-id template whose items were edited is
 * `changed` — the id alone proves nothing.
 */
export function detectTemplateChange(shown: ChecklistTemplate, current: readonly ChecklistTemplate[]): TemplateChange {
  const now = current.find((template) => template.id === shown.id);
  if (!now || !usable(now)) return "removed";
  if (shown.fingerprint && now.fingerprint) return shown.fingerprint === now.fingerprint ? "same" : "changed";
  return checklistSignature(shown) === checklistSignature(now) ? "same" : "changed";
}
