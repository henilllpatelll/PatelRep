import type {
  BuildingSection,
  DashboardModel,
  FloorSection,
  RoomEntry,
} from "@/lib/housekeeping/myRoomsDashboard";

/**
 * Flat, virtualization-friendly rows for the My Rooms FlatList. Building the
 * rows here (not in the screen) keeps the three tabs testable without a
 * renderer and lets one FlatList serve every tab.
 */
export type ListItem =
  | { kind: "section"; key: string; titleKey: string; count: number; note?: string }
  | { kind: "current"; key: string; entry: RoomEntry }
  | { kind: "card"; key: string; entry: RoomEntry; position?: number }
  | { kind: "row"; key: string; entry: RoomEntry }
  | { kind: "text"; key: string; textKey: string }
  | { kind: "building"; key: string; label: string | null }
  | { kind: "floor"; key: string; section: FloorSection; expanded: boolean };

export function buildRouteItems(model: DashboardModel): ListItem[] {
  const items: ListItem[] = [];

  if (model.current.length > 0) {
    items.push({ kind: "section", key: "s-current", titleKey: "rooms.dash.route.currentTitle", count: model.current.length });
    for (const entry of model.current) items.push({ kind: "current", key: `current-${entry.room.id}`, entry });
  }

  if (model.upNext.length > 0) {
    items.push({ kind: "section", key: "s-next", titleKey: "rooms.dash.route.upNextTitle", count: model.upNext.length });
    model.upNext.forEach((entry, index) => {
      items.push({ kind: "card", key: `next-${entry.room.id}`, entry, position: index + 1 });
    });
  } else if (model.current.length === 0 && model.attention.length > 0) {
    items.push({ kind: "text", key: "t-only-attention", textKey: "rooms.dash.route.onlyAttention" });
  }

  if (model.attention.length > 0) {
    items.push({
      kind: "section",
      key: "s-attention",
      titleKey: "rooms.dash.route.attentionTitle",
      count: model.attention.length,
    });
    for (const entry of model.attention) items.push({ kind: "card", key: `attn-${entry.room.id}`, entry });
  }

  return items;
}

/** True when the Route tab has no work of any kind to show. */
export function isRouteEmpty(model: DashboardModel): boolean {
  return model.current.length + model.upNext.length + model.attention.length === 0;
}

export function buildDoneItems(model: DashboardModel): ListItem[] {
  const items: ListItem[] = [];
  const add = (
    key: string,
    titleKey: string,
    entries: RoomEntry[],
    opts: { alwaysShow: boolean; note?: string },
  ) => {
    if (entries.length === 0 && !opts.alwaysShow) return;
    items.push({ kind: "section", key: `s-${key}`, titleKey, count: entries.length, note: opts.note });
    if (entries.length === 0) items.push({ kind: "text", key: `t-${key}`, textKey: "rooms.dash.done.none" });
    for (const entry of entries) items.push({ kind: "row", key: `${key}-${entry.room.id}`, entry });
  };

  add("awaiting", "rooms.dash.done.awaitingTitle", model.submitted, { alwaysShow: true });
  add("ready", "rooms.dash.done.readyTitle", model.inspected, { alwaysShow: true });
  add("unavailable", "rooms.dash.done.unavailableTitle", model.unavailable, {
    alwaysShow: false,
    note: "rooms.dash.done.unavailableNote",
  });
  return items;
}

/** A floor opens by default while it still has unfinished work. */
export function isFloorOpenByDefault(floor: FloorSection): boolean {
  return floor.serviceable > floor.completed;
}

export function buildFloorItems(
  sections: BuildingSection[],
  overrides: Record<string, boolean>,
  searching: boolean,
): ListItem[] {
  const items: ListItem[] = [];
  const showBuildingHeaders = sections.some((section) => section.building !== null || section.unassigned);

  for (const section of sections) {
    if (showBuildingHeaders) {
      items.push({ kind: "building", key: `b-${section.key}`, label: section.building });
    }
    for (const floor of section.floors) {
      // Searching opens every floor that still has a match.
      const expanded = searching ? true : (overrides[floor.key] ?? isFloorOpenByDefault(floor));
      items.push({ kind: "floor", key: `f-${floor.key}`, section: floor, expanded });
      if (expanded) {
        for (const entry of floor.rooms) items.push({ kind: "row", key: `r-${entry.room.id}`, entry });
      }
    }
  }
  return items;
}
