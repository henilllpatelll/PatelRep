type Handler = () => void;
type StatusCallback = (status: string) => void;

interface FakeApi {
  on: (type: string, config: FakeChannel["config"], handler: Handler) => FakeApi;
  subscribe: (callback?: StatusCallback) => FakeApi;
  __channel: FakeChannel;
}

interface FakeChannel {
  name: string;
  config: { filter?: string; table?: string } | null;
  configs: Array<{ filter?: string; table?: string }>;
  onEvent: Handler | null;
  onStatus: StatusCallback | null;
}

const mockChannels: FakeChannel[] = [];
const mockRemoved: FakeChannel[] = [];

jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn((name: string) => {
      const channel: FakeChannel = { name, config: null, configs: [], onEvent: null, onStatus: null };
      mockChannels.push(channel);
      const api: FakeApi = {
        on: jest.fn((_type: string, config: FakeChannel["config"], handler: Handler): FakeApi => {
          channel.config ??= config;
          channel.configs.push(config as { filter?: string; table?: string });
          channel.onEvent ??= handler;
          return api;
        }),
        subscribe: jest.fn((callback?: StatusCallback): FakeApi => {
          channel.onStatus = callback ?? null;
          return api;
        }),
        __channel: channel,
      };
      return api;
    }),
    removeChannel: jest.fn((api: { __channel: FakeChannel }) => {
      mockRemoved.push(api.__channel);
    }),
  },
}));

import { REALTIME_DEBOUNCE_MS, subscribeSupervisorRealtime } from "@/lib/housekeeping/supervisorRealtime";

beforeEach(() => {
  jest.useFakeTimers();
  mockChannels.length = 0;
  mockRemoved.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("supervisor Realtime channel", () => {
  it("subscribes to room_status for the signed-in hotel only", () => {
    const off = subscribeSupervisorRealtime("hotel-1", jest.fn());
    expect(mockChannels).toHaveLength(1);
    expect(mockChannels[0].config).toMatchObject({ table: "room_status", filter: "tenant_id=eq.hotel-1" });
    // The same ONE channel also hears the dated owner rows, scoped to the same hotel.
    expect(mockChannels[0].configs).toEqual([
      expect.objectContaining({ table: "room_status", filter: "tenant_id=eq.hotel-1" }),
      expect.objectContaining({ table: "room_assignments", filter: "tenant_id=eq.hotel-1" }),
    ]);
    off();
  });

  it("collapses a burst (and duplicate events) into ONE refresh", () => {
    const refresh = jest.fn();
    const off = subscribeSupervisorRealtime("hotel-1", refresh);
    for (let i = 0; i < 12; i += 1) {
      mockChannels[0].onEvent?.();
      jest.advanceTimersByTime(100);
    }
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    off();
  });

  it("shares one channel between screens and calls only the newest registration", () => {
    const today = jest.fn();
    const board = jest.fn();
    const offToday = subscribeSupervisorRealtime("hotel-1", today);
    const offBoard = subscribeSupervisorRealtime("hotel-1", board);
    expect(mockChannels).toHaveLength(1);
    mockChannels[0].onEvent?.();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(board).toHaveBeenCalledTimes(1);
    expect(today).not.toHaveBeenCalled();
    offBoard();
    expect(mockRemoved).toHaveLength(0); // Today still listening
    offToday();
    expect(mockRemoved).toHaveLength(1); // last one out closes it — no leak
  });

  it("an independent listener (a screen with its own store) is called alongside the newest shared one, and is never skipped", () => {
    const inspect = jest.fn();
    const today = jest.fn();
    const offInspect = subscribeSupervisorRealtime("hotel-1", inspect, { independent: true });
    const offToday = subscribeSupervisorRealtime("hotel-1", today); // registered AFTER Inspect
    expect(mockChannels).toHaveLength(1);
    mockChannels[0].onEvent?.();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(today).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    offToday();
    mockChannels[0].onEvent?.();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(inspect).toHaveBeenCalledTimes(2); // still the only listener, still called, channel still open
    expect(mockRemoved).toHaveLength(0);
    offInspect();
    expect(mockRemoved).toHaveLength(1);
  });

  it("switching hotel closes the old channel; the old hotel's events never reach the new listener", () => {
    const oldListener = jest.fn();
    const newListener = jest.fn();
    const offOld = subscribeSupervisorRealtime("hotel-1", oldListener);
    const oldChannel = mockChannels[0];
    const offNew = subscribeSupervisorRealtime("hotel-2", newListener);
    expect(mockRemoved).toEqual([oldChannel]);
    expect(mockChannels[1].config).toMatchObject({ filter: "tenant_id=eq.hotel-2" });
    // A late event from the closed hotel-1 channel must not trigger the new hotel's refresh with hotel-1's timer.
    oldChannel.onEvent?.();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(oldListener).not.toHaveBeenCalled();
    expect(newListener).not.toHaveBeenCalled();
    offOld();
    offNew();
  });

  it("a pending debounced refresh is cancelled when the channel closes", () => {
    const refresh = jest.fn();
    const off = subscribeSupervisorRealtime("hotel-1", refresh);
    mockChannels[0].onEvent?.();
    off();
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("catches up once after a dropped connection comes back — and not on the first connect", () => {
    const refresh = jest.fn();
    const off = subscribeSupervisorRealtime("hotel-1", refresh);
    const status = mockChannels[0].onStatus as StatusCallback;
    status("SUBSCRIBED");
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();

    status("CHANNEL_ERROR");
    status("TIMED_OUT"); // repeated failures are still one interruption
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled(); // nothing is refreshed while the link is down

    status("SUBSCRIBED");
    status("SUBSCRIBED");
    jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    off();
  });
});
