import { renderHook } from "@testing-library/react-native";
import { HOME_NAV_LOCK_MS, routeKey, useHomeNavigate } from "@/lib/engineering/useHomeNavigate";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

beforeEach(() => mockPush.mockClear());

describe("routeKey", () => {
  it("ignores the per-tap nav stamp but keeps the params that change the destination", () => {
    const a = routeKey({ pathname: "/(app)/work-orders", params: { view: "team", nav: "1" } });
    const b = routeKey({ pathname: "/(app)/work-orders", params: { view: "team", nav: "2" } });
    const c = routeKey({ pathname: "/(app)/work-orders", params: { view: "waiting", nav: "3" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("uses a string route as it is", () => {
    expect(routeKey("/(app)/pm")).toBe("/(app)/pm");
  });
});

describe("useHomeNavigate", () => {
  it("opens a destination once for a double tap, so the back stack holds no duplicate", () => {
    let t = 1000;
    const { result } = renderHook(() => useHomeNavigate(() => t));
    result.current("/(app)/pm");
    t += 100;
    result.current("/(app)/pm");
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("never blocks a different destination, and opens the same one again after the lock window", () => {
    let t = 1000;
    const { result } = renderHook(() => useHomeNavigate(() => t));
    result.current("/(app)/pm");
    t += 50;
    result.current("/(app)/assets");
    expect(mockPush).toHaveBeenCalledTimes(2);
    t += HOME_NAV_LOCK_MS + 1;
    result.current("/(app)/assets");
    expect(mockPush).toHaveBeenCalledTimes(3);
  });

  it("ignores an empty route", () => {
    const { result } = renderHook(() => useHomeNavigate());
    result.current(null);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("Home localization parity", () => {
  const leaves = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

  it.each(["home.engineer", "home.chief"])("has the same keys in English and Spanish under %s", (path) => {
    const pick = (root: unknown) => path.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], root);
    const enKeys = leaves(pick(en)).sort();
    const esKeys = leaves(pick(es)).sort();
    expect(enKeys.length).toBeGreaterThan(0);
    expect(esKeys).toEqual(enKeys);
  });

  it("translates the loading and fallback-name strings that Home announces", () => {
    expect(es.home.engineer.loadingCount).not.toBe(en.home.engineer.loadingCount);
    expect(es.home.engineer.fallbackName).not.toBe(en.home.engineer.fallbackName);
  });
});
