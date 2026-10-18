import { initialTodaySources, type TodaySources } from "@/lib/housekeeping/supervisorToday";
import { availableSource } from "@/lib/housekeeping/supervisorSources";
import { acquireTodayStore, requestTodayRefresh, sourcesFor, useSupervisorTodayStore } from "@/stores/supervisorTodayStore";

function withStaff(label: string): TodaySources {
  return { ...initialTodaySources(), staff: availableSource([{ userId: label, name: label, role: "housekeeper" }], 1) };
}
const staffLabel = (sources: TodaySources) => (sources.staff.status === "available" ? sources.staff.data[0].userId : null);

afterEach(() => {
  acquireTodayStore()();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("shared Today snapshot store", () => {
  it("publishes a refresh for its scope and nothing for another scope", async () => {
    const release = acquireTodayStore();
    await requestTodayRefresh("h1:u1", async () => withStaff("a"));
    expect(staffLabel(sourcesFor("h1:u1"))).toBe("a");
    // A reader for another hotel/person sees nothing loaded, never someone else's data.
    expect(sourcesFor("h2:u9").staff.status).toBe("loading");
    release();
  });

  it("coalesces a burst of refreshes into one in flight plus one follow-up, and the newest answer wins", async () => {
    const release = acquireTodayStore();
    const gate = deferred<TodaySources>();
    const loads: string[] = [];
    const first = requestTodayRefresh("h1:u1", async () => {
      loads.push("first");
      return gate.promise;
    });
    const second = requestTodayRefresh("h1:u1", async () => {
      loads.push("second");
      return withStaff("newest");
    });
    const third = requestTodayRefresh("h1:u1", async () => {
      loads.push("third");
      return withStaff("newest");
    });
    expect(useSupervisorTodayStore.getState().refreshing).toBe(true);
    gate.resolve(withStaff("old"));
    await Promise.all([first, second, third]);
    // Three requests, two loads: the in-flight one and a single follow-up using the latest loader.
    expect(loads).toEqual(["first", "third"]);
    expect(staffLabel(sourcesFor("h1:u1"))).toBe("newest");
    expect(useSupervisorTodayStore.getState().refreshing).toBe(false);
    release();
  });

  it("lets a screen that only needs data join the refresh in flight instead of queuing another", async () => {
    const release = acquireTodayStore();
    const gate = deferred<TodaySources>();
    const loads: string[] = [];
    const first = requestTodayRefresh("h1:u1", async () => {
      loads.push("first");
      return gate.promise;
    });
    const joined = requestTodayRefresh(
      "h1:u1",
      async () => {
        loads.push("joined");
        return withStaff("never");
      },
      { join: true },
    );
    gate.resolve(withStaff("a"));
    await Promise.all([first, joined]);
    expect(loads).toEqual(["first"]);
    expect(staffLabel(sourcesFor("h1:u1"))).toBe("a");
    release();
  });

  it("discards an older scope's answer when another hotel/person starts refreshing", async () => {
    const release = acquireTodayStore();
    const gate = deferred<TodaySources>();
    const stale = requestTodayRefresh("h1:u1", () => gate.promise);
    await requestTodayRefresh("h2:u2", async () => withStaff("hotel2"));
    gate.resolve(withStaff("hotel1"));
    await stale;
    expect(useSupervisorTodayStore.getState().scope).toBe("h2:u2");
    expect(staffLabel(sourcesFor("h2:u2"))).toBe("hotel2");
    expect(sourcesFor("h1:u1").staff.status).toBe("loading");
    release();
  });

  it("empties itself when the last screen using it goes away, so no hotel's data lingers", async () => {
    const releaseA = acquireTodayStore();
    const releaseB = acquireTodayStore();
    await requestTodayRefresh("h1:u1", async () => withStaff("a"));
    releaseA();
    expect(staffLabel(sourcesFor("h1:u1"))).toBe("a");
    releaseB();
    expect(useSupervisorTodayStore.getState().scope).toBeNull();
    expect(sourcesFor("h1:u1").staff.status).toBe("loading");
  });
});
