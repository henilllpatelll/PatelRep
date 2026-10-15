import { attentionAction, bucketOf, buildAttentionCenter, effectiveFilter, itemsForFilter } from "@/lib/housekeeping/homeAttention";
import { buildAttentionPreview } from "@/lib/housekeeping/homeState";
import { build, room, session } from "../helpers/homeModelFixture";

const dnd = (id: string, extra = {}) => room(id, { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, ...extra });
const NOTE = { id: "note-1", title: "Message from supervisor", body: "Finish 208 then 310.", createdAt: "2026-10-14T14:15:00.000Z" };

describe("Attention Center model", () => {
  it("lists each condition once, in the same order Home previews them", () => {
    const model = build([dnd("214"), room("305", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" }), room("112")], { note: NOTE });
    const center = buildAttentionCenter(model);
    const ids = center.items.map((row) => row.item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("room:214:dnd");
    expect(ids).toContain("message:note-1");

    // the preview's first rows are the center's first rows (one ordering, two screens)
    const preview = buildAttentionPreview(model, 3);
    expect(preview.shown.map((row) => row.item.id)).toEqual(ids.slice(0, preview.shown.length));
  });

  it("puts every item in exactly one filter, so counts add up and never double count", () => {
    const model = build(
      [
        dnd("211"),
        dnd("212"),
        room("310", { reclean_requested_at: "2026-10-14T14:00:00.000Z" }),
        room("305", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" }),
        room("401", { open_work_order_id: "wo-1", open_work_order_title: "Leaking faucet", status: "OCCUPIED", actual_checkout_at: null }),
        room("112"),
      ],
      { note: NOTE },
    );
    const center = buildAttentionCenter(model);
    const { all, urgent, access, messages, other } = center.counts;
    expect(urgent + access + messages + other).toBe(all);
    expect(all).toBe(center.items.length);
    expect(messages).toBe(1);
    expect(urgent).toBeGreaterThan(0); // the reclean
    expect(access).toBeGreaterThan(0); // DND + unverified checkout
    expect(center.filters).toEqual(expect.arrayContaining(["all", "urgent", "access", "messages"]));
  });

  it("only offers filters that have something in them, with accurate counts", () => {
    const center = buildAttentionCenter(build([dnd("211"), dnd("212"), room("112")]));
    expect(center.filters).toEqual(["all", "access"]);
    expect(center.counts.access).toBe(2);
    expect(itemsForFilter(center, "access")).toHaveLength(2);
    expect(itemsForFilter(center, "messages")).toHaveLength(2); // an emptied filter falls back to All, never a blank list
  });

  it("falls back to All when the chosen filter empties after a refresh", () => {
    const before = buildAttentionCenter(build([dnd("211"), room("112")], { note: NOTE }));
    expect(effectiveFilter(before, "messages")).toBe("messages");
    const after = buildAttentionCenter(build([dnd("211"), room("112")]));
    expect(effectiveFilter(after, "messages")).toBe("all");
  });

  it("updates counts when a room changes (no stale counts)", () => {
    const rooms = [dnd("211"), dnd("212"), room("112")];
    expect(buildAttentionCenter(build(rooms)).counts.all).toBe(2);
    expect(buildAttentionCenter(build([rooms[0], room("212", { actual_checkout_at: "2026-10-14T12:00:00.000Z" }), rooms[2]])).counts.all).toBe(1);
  });

  it("is empty (not an error) when nothing needs attention", () => {
    const center = buildAttentionCenter(build([room("112")]));
    expect(center.items).toEqual([]);
    expect(center.filters).toEqual(["all"]);
  });

  it("ranks work the person can resolve above rooms they can only wait on", () => {
    const model = build([dnd("211"), room("310", { reclean_requested_at: "2026-10-14T14:00:00.000Z" })]);
    const codes = buildAttentionCenter(model).items.map((row) => row.item.code);
    expect(codes).toEqual(["reclean", "dnd"]);
  });

  it("an unassigned room that still holds unsent work is critical and urgent", () => {
    const model = build([room("112")], { sessions: { "room-gone": session("room-gone") } });
    const center = buildAttentionCenter(model);
    const orphan = center.items.find((row) => row.item.code === "session_unassigned");
    expect(orphan?.item.severity).toBe("critical");
    expect(orphan?.bucket).toBe("urgent");
  });
});

describe("where a tap goes", () => {
  const first = (code: string, model = build([dnd("214"), room("310", { reclean_requested_at: "2026-10-14T14:00:00.000Z" }), room("305", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" })], { note: NOTE })) =>
    buildAttentionCenter(model).items.find((row) => row.item.code === code)!;

  it("DND opens the issue details, never straight into the room", () => {
    const spec = attentionAction(first("dnd").item);
    expect(spec.target).toEqual({ type: "details", itemId: "room:214:dnd" });
    expect(spec.labelKey).toBe("home.attentionCenter.action.viewDetails");
  });

  it("reclean opens the existing room workflow", () => {
    const spec = attentionAction(first("reclean").item);
    expect(spec.target).toEqual({ type: "room", roomId: "310" });
    expect(spec.labelKey).toBe("home.attentionCenter.action.reviewCorrections");
    expect(spec.detailsLink).toBe(true);
  });

  it("an unverified checkout goes to the room, with the details one tap away", () => {
    const spec = attentionAction(first("checkout_unverified").item);
    expect(spec.target).toEqual({ type: "room", roomId: "305" });
    expect(spec.detailsLink).toBe(true);
  });

  it("a supervisor instruction opens the message drawer", () => {
    expect(attentionAction(first("supervisor_message").item).target).toEqual({ type: "message", notificationId: "note-1" });
  });

  it("buckets are stable per item kind", () => {
    expect(bucketOf(first("dnd").item)).toBe("access");
    expect(bucketOf(first("reclean").item)).toBe("urgent");
    expect(bucketOf(first("supervisor_message").item)).toBe("messages");
  });
});

describe("the supervisor instruction is never pushed out of Home's preview", () => {
  it("keeps the message visible even when other items outrank it", () => {
    const model = build(
      [
        room("310", { reclean_requested_at: "2026-10-14T14:00:00.000Z", status: "OCCUPIED", actual_checkout_at: null, dnd_flag: false, open_work_order_id: "wo-1" }),
        room("305", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" }),
        room("306", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" }),
        room("307", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" }),
      ],
      { note: NOTE },
    );
    const preview = buildAttentionPreview(model, 2);
    expect(preview.shown).toHaveLength(2);
    expect(preview.shown.some((row) => row.item.kind === "supervisor_message")).toBe(true);
    expect(preview.shown.length + preview.remaining).toBe(preview.total);
  });
});
