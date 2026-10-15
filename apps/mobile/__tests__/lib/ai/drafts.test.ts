import {
  buildConfirmBody,
  guestRequestDraftFromRaw,
  isPreviewValid,
  patchPreview,
  roomIsUnverified,
  taskDraftFromRaw,
  validatePreview,
  workOrderDraftFromRaw,
  type ActionPreview,
} from "@/lib/ai/drafts";

const KEY = "11111111-1111-4111-8111-111111111111";
const task = (raw: Record<string, unknown>) => taskDraftFromRaw(raw) as Extract<ActionPreview, { kind: "task" }>;
const wo = (raw: Record<string, unknown>) => workOrderDraftFromRaw(raw) as Extract<ActionPreview, { kind: "work_order" }>;
const gr = (raw: Record<string, unknown>) => guestRequestDraftFromRaw(raw) as Extract<ActionPreview, { kind: "guest_request" }>;

describe("draft validation", () => {
  it("rejects a draft without a title and one that is too long", () => {
    expect(taskDraftFromRaw({ title: "   " })).toBeNull();
    const p = task({ title: "ok" });
    expect(validatePreview(patchPreview(p, { title: "" }))).toEqual({ title: "required" });
    expect(validatePreview(patchPreview(p, { title: "x".repeat(121) }))).toEqual({ title: "tooLong" });
    expect(isPreviewValid(p)).toBe(true);
  });

  it("requires a work order to say where the problem is", () => {
    const p = wo({ title: "Leak", category: "plumbing", priority: "urgent" });
    expect(validatePreview(p)).toEqual({ location: "needsPlace" });
    expect(isPreviewValid(patchPreview(p, { roomNumber: "305" }))).toBe(true);
    expect(isPreviewValid(patchPreview(p, { locationText: "Pool deck" }))).toBe(true);
  });

  it("keeps accessibility requests urgent however they are edited", () => {
    const p = gr({ title: "Grab bar", category: "service", priority: "normal" });
    const edited = patchPreview(p, { category: "accessibility" });
    expect(edited.draft).toMatchObject({ category: "accessibility", priority: "urgent" });
    expect(patchPreview(edited, { priority: "normal" }).draft).toMatchObject({ priority: "urgent" });
  });

  it("drops the server's room link when the room number is edited, and re-flags it as unverified", () => {
    const p = task({ title: "Towels", room_id: "room-1", room_number_display: "214" });
    expect(roomIsUnverified(p.draft)).toBe(false);
    const edited = patchPreview(p, { roomNumber: "215" });
    expect(edited.draft).toMatchObject({ roomNumber: "215", roomId: null });
    expect(roomIsUnverified(edited.draft)).toBe(true);
    // Editing something else keeps the link.
    expect(patchPreview(p, { title: "More towels" }).draft).toMatchObject({ roomId: "room-1" });
  });
});

describe("confirm request bodies (the endpoints take JSON arrays)", () => {
  it("builds a task body with a verified room as room_id", () => {
    const body = buildConfirmBody(task({ title: " Towels ", priority: "high", task_type: "guest_request", room_id: "room-1", room_number_display: "214" }), KEY);
    expect(body).toEqual([{ title: "Towels", task_type: "guest_request", priority: "urgent", room_id: "room-1" }]);
  });

  it("builds a task body with an unverified room as the number for the server to check", () => {
    const body = buildConfirmBody(task({ title: "Towels", room_number_display: "999" }), KEY);
    expect(body).toEqual([{ title: "Towels", task_type: "general", priority: "normal", room_number_display: "999" }]);
  });

  it("builds a work-order body with an idempotency key and without empty fields", () => {
    const body = buildConfirmBody(wo({ title: "Leak", category: "plumbing", priority: "urgent", room_number: "305", room_id: "room-9" }), KEY);
    expect(body).toEqual([
      { title: "Leak", category: "plumbing", priority: "urgent", room_id: "room-9", client_request_id: KEY },
    ]);
  });

  it("builds a guest-request body", () => {
    const body = buildConfirmBody(
      gr({ title: "Crib", category: "service", priority: "normal", guest_impact: "high", room_number: "412", guest_name: "Lee", description: "Needs a crib" }),
      KEY,
    );
    expect(body).toEqual([
      { title: "Crib", category: "service", priority: "normal", guest_impact: "high", description: "Needs a crib", guest_name: "Lee", room_number: "412" },
    ]);
  });
});
