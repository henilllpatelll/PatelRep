import { leavePrompt } from "@/lib/housekeeping/assignmentLeave";

describe("leaving Assignments", () => {
  it("asks nothing when there is nothing to lose", () => {
    expect(leavePrompt({ publishing: false, draftChanges: false, planOpen: false })).toBeNull();
  });
  it("unpublished changes or an open plan can be discarded", () => {
    expect(leavePrompt({ publishing: false, draftChanges: true, planOpen: false })).toBe("discard");
    expect(leavePrompt({ publishing: false, draftChanges: false, planOpen: true })).toBe("discard");
  });
  it("a publication in flight or unknown is never offered for discard, even beside a draft", () => {
    expect(leavePrompt({ publishing: true, draftChanges: false, planOpen: false })).toBe("pending");
    expect(leavePrompt({ publishing: true, draftChanges: true, planOpen: true })).toBe("pending");
  });
});
