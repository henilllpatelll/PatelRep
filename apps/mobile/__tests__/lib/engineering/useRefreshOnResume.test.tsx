import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { useRefreshOnResume } from "@/lib/engineering/useRefreshOnResume";

type Listener = (state: string) => void;
let listener: Listener | null = null;
const remove = jest.fn();

beforeEach(() => {
  listener = null;
  remove.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, cb: Listener) => {
    listener = cb;
    return { remove };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

describe("useRefreshOnResume", () => {
  it("asks for a focus-style read when the app returns to the foreground, not when it goes to the background", () => {
    const onResume = jest.fn();
    renderHook(() => useRefreshOnResume(true, onResume));
    act(() => listener?.("background"));
    expect(onResume).not.toHaveBeenCalled();
    act(() => listener?.("active"));
    expect(onResume).toHaveBeenCalledWith("focus");
  });

  it("asks for a manual read only when the connection comes back", () => {
    const onResume = jest.fn();
    const { rerender } = renderHook(({ online }: { online: boolean }) => useRefreshOnResume(online, onResume), { initialProps: { online: true } });
    expect(onResume).not.toHaveBeenCalled();
    rerender({ online: false });
    expect(onResume).not.toHaveBeenCalled();
    rerender({ online: true });
    expect(onResume).toHaveBeenCalledWith("manual");
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("treats an unknown connection as online and cleans up", () => {
    const onResume = jest.fn();
    const { unmount } = renderHook(() => useRefreshOnResume(undefined, onResume));
    expect(onResume).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
