import { api } from "@/lib/api/client";
import { GUEST_REQUEST_PAGE_SIZE, normalizeGuestRequests, type GuestRequestView } from "@/lib/frontDesk/guestRequests";

/** Newest `GUEST_REQUEST_PAGE_SIZE` requests for this hotel (the server scopes by tenant). No total is returned. */
export async function fetchGuestRequests(): Promise<GuestRequestView[]> {
  const res = await api.get<{ data: unknown }>(`/guest-requests?per_page=${GUEST_REQUEST_PAGE_SIZE}`);
  return normalizeGuestRequests(res.data);
}

/** The API has no single-request read, so a request is looked up in the newest page. Null means "not in the newest page". */
export async function fetchGuestRequest(id: string): Promise<GuestRequestView | null> {
  const rows = await fetchGuestRequests();
  return rows.find((r) => r.id === id) ?? null;
}

/** The one supported status change. The server validates the lifecycle and role and answers 422 / 403 otherwise. */
export async function transitionGuestRequest(id: string, status: string, detail?: string): Promise<void> {
  await api.post(`/guest-requests/${id}/transition`, { status, ...(detail?.trim() ? { detail: detail.trim() } : {}) });
}
