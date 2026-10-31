import {
  actionOutcome,
  classifyLoadFailure,
  combineFailures,
  resolveLoadState,
} from "@/lib/engineering/loadState";

class FakeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

describe("classifyLoadFailure", () => {
  it("treats 401/403 as forbidden", () => {
    expect(classifyLoadFailure(new FakeApiError("no", 403))).toBe("forbidden");
    expect(classifyLoadFailure(new FakeApiError("no", 401))).toBe("forbidden");
  });

  it("treats other server answers as a plain failure", () => {
    expect(classifyLoadFailure(new FakeApiError("boom", 500))).toBe("failed");
    expect(classifyLoadFailure(new FakeApiError("nope", 404))).toBe("failed");
  });

  it("treats network errors and timeouts as offline", () => {
    expect(classifyLoadFailure(new TypeError("Network request failed"))).toBe("offline");
    expect(classifyLoadFailure(new Error("Request timed out"))).toBe("offline");
  });

  it("falls back to failed for anything else", () => {
    expect(classifyLoadFailure(new Error("weird"))).toBe("failed");
    expect(classifyLoadFailure(undefined)).toBe("failed");
  });
});

describe("resolveLoadState", () => {
  it("is loading until the first attempt settles", () => {
    expect(resolveLoadState({ loading: true, failure: null, count: 0 })).toEqual({ status: "loading", stale: false });
  });

  it("is empty only when the load succeeded and there is nothing", () => {
    expect(resolveLoadState({ loading: false, failure: null, count: 0 })).toEqual({ status: "empty", stale: false });
  });

  it("a failed load with nothing to show is an error, never empty", () => {
    expect(resolveLoadState({ loading: false, failure: "failed", count: 0 }).status).toBe("error");
    expect(resolveLoadState({ loading: false, failure: "forbidden", count: 0 }).status).toBe("forbidden");
    expect(resolveLoadState({ loading: false, failure: "offline", count: 0 }).status).toBe("offline");
  });

  it("offline with no attempt and nothing cached is offline, not empty", () => {
    expect(resolveLoadState({ loading: false, failure: null, count: 0, offline: true }).status).toBe("offline");
  });

  it("keeps showing data after a failed refresh, flagged as stale", () => {
    expect(resolveLoadState({ loading: false, failure: "failed", count: 3 })).toEqual({ status: "ready", stale: true });
    expect(resolveLoadState({ loading: false, failure: null, count: 3 })).toEqual({ status: "ready", stale: false });
  });
});

describe("combineFailures", () => {
  const ok = { status: "fulfilled", value: [] } as const;
  const fail = (error: unknown) => ({ status: "rejected", reason: error }) as const;

  it("is null when everything succeeded", () => {
    expect(combineFailures([ok, ok])).toBeNull();
  });

  it("surfaces any single failed request", () => {
    expect(combineFailures([ok, fail(new FakeApiError("x", 500)), ok])).toBe("failed");
  });

  it("forbidden outranks offline outranks failed", () => {
    expect(combineFailures([fail(new FakeApiError("x", 500)), fail(new FakeApiError("x", 403))])).toBe("forbidden");
    expect(combineFailures([fail(new FakeApiError("x", 500)), fail(new TypeError("Network request failed"))])).toBe("offline");
  });
});

describe("actionOutcome", () => {
  it("separates server-confirmed, queued-on-device and failed", () => {
    expect(actionOutcome(true)).toBe("confirmed");
    expect(actionOutcome(false)).toBe("queued");
    expect(actionOutcome(true, new Error("x"))).toBe("failed");
    expect(actionOutcome(false, new Error("x"))).toBe("failed");
  });
});
