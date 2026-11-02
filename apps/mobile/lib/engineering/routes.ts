/* ─── Engineering navigation contracts ──────────────────────────────────────
   Every "open this PM / asset / work order / room" link is built here, from an id that came from a server row. An id is
   only ever a path segment: anything that could change where the link goes (a slash, dot, query or scheme) yields null, so
   a malformed or hostile id from a QR code, notification or deep link can never become a different route. Callers fall
   back to the relevant list when a builder returns null. Nothing here grants access: the destination screen reads the
   record through an authenticated, property-scoped API call. */

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeRouteId(value: string | null | undefined): value is string {
  return typeof value === "string" && SAFE_SEGMENT.test(value);
}

export interface ParamRoute {
  pathname: string;
  params: Record<string, string>;
}

/** The exact equipment record. Never the general directory when the specific asset is known. */
export function assetRoute(assetId: string | null | undefined): ParamRoute | null {
  return isSafeRouteId(assetId) ? { pathname: "/(app)/assets/[assetId]", params: { assetId } } : null;
}

/** Edit and label screens for one exact asset (built only from a server-supplied id, like every route here). */
export function assetEditRoute(assetId: string | null | undefined): ParamRoute | null {
  return isSafeRouteId(assetId) ? { pathname: "/(app)/assets/edit/[assetId]", params: { assetId } } : null;
}

export function assetLabelRoute(assetId: string | null | undefined): ParamRoute | null {
  return isSafeRouteId(assetId) ? { pathname: "/(app)/assets/label/[assetId]", params: { assetId } } : null;
}

export function workOrderRoute(workOrderId: string | null | undefined): ParamRoute | null {
  return isSafeRouteId(workOrderId) ? { pathname: "/(app)/work-orders/[woId]", params: { woId: workOrderId } } : null;
}

export function roomRoute(roomId: string | null | undefined): ParamRoute | null {
  return isSafeRouteId(roomId) ? { pathname: "/(app)/room-status/[roomId]", params: { roomId } } : null;
}

export function pmScheduleRoute(scheduleId: string | null | undefined): string | null {
  return isSafeRouteId(scheduleId) ? `/(app)/pm-schedules/${scheduleId}` : null;
}

export function pmInspectRoute(scheduleId: string | null | undefined): string | null {
  return isSafeRouteId(scheduleId) ? `/(app)/pm-schedules/inspect/${scheduleId}` : null;
}

/** A recorded inspection. The schedule id travels with it so the record screen reads the right schedule's history. */
export function pmRecordRoute(completionId: string | null | undefined, scheduleId: string | null | undefined): string | null {
  return isSafeRouteId(completionId) && isSafeRouteId(scheduleId)
    ? `/(app)/pm-schedules/record/${completionId}?scheduleId=${scheduleId}`
    : null;
}

export const ASSETS_LIST_ROUTE = "/(app)/assets";
export const ASSET_NEW_ROUTE = "/(app)/assets/new";
export const PM_LIST_ROUTE = "/(app)/pm-schedules";
