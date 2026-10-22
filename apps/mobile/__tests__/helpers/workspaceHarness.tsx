import { Text } from "react-native";
import { act, fireEvent, type render } from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { makeTranslator } from "./i18n";
import { rawItem, rawTemplate } from "./inspectionFixtures";

/* ─── Shared pieces for the active inspection workspace tests ───────────────
   The real screen, hook, models and components run in these tests. Only the network, the router, the translator and
   the realtime channel are replaced (each test file registers its own `jest.mock` calls, which must be hoisted in
   that file); AsyncStorage is the library's own in-memory mock, so drafts really are written and read back. */

/** 1:00 PM in Chicago; the hotel day is 2026-10-20. */
export const NOW = Date.parse("2026-10-20T18:00:00Z");
export const en = makeTranslator("en");
export const es = makeTranslator("es");

export const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
export async function settle() {
  await flush();
  await flush();
  await flush();
}
/** Long enough for the draft writer's pause (600 ms) and the write behind it. */
export const afterAutosave = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });

type Screen = ReturnType<typeof render>;

/** The visible words of a rendered node: every outermost <Text> inside it, nested text included. */
export function flatText(node: ReactTestInstance): string {
  const own = (value: unknown): string => {
    if (value === null || value === undefined || typeof value === "boolean") return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(own).join("");
    return own((value as { props?: { children?: unknown } }).props?.children);
  };
  if ((node.type as unknown) === "Text") return own(node.props.children);
  const isText = (n: ReactTestInstance | null) => n !== null && n.type === Text;
  const texts = node.findAll((n) => n.type === Text && !(() => { for (let p = n.parent; p && p !== node.parent; p = p.parent) if (isText(p)) return true; return false; })());
  if (texts.length === 0) return own(node.props.children);
  return texts.map((n) => own(n.props.children)).join(" ");
}

/** Every string the screen shows or announces (text and accessibility labels), for "no raw translation key" checks. */
export function allStrings(screen: Screen): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const element = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of ["accessibilityLabel", "accessibilityHint", "placeholder"]) {
      if (typeof element.props?.[key] === "string") out.push(element.props[key] as string);
    }
    walk(element.children);
  };
  walk(screen.toJSON());
  return out;
}

export function bind(screen: Screen) {
  const press = async (testId: string) => {
    await act(async () => fireEvent.press(screen.getByTestId(testId)));
    await flush();
  };
  const pressText = async (label: string) => {
    await act(async () => fireEvent.press(screen.getByText(label)));
    await flush();
  };
  const answer = (item: string, choice: "pass" | "fail" | "na") => press(`workspace-answer-${item}-${choice}`);
  const text = (testId: string) => flatText(screen.getByTestId(testId));
  const has = (testId: string) => screen.queryByTestId(testId) !== null;
  return { press, pressText, answer, text, has };
}

/** A hotel's checklist as the API returns it: three sections, one item that refuses N/A, one optional, one that needs a photo. */
export const CHECKLIST_ITEMS = [
  rawItem("toilet", { section: "Bathroom", description: "Toilet sanitized", sort_order: 1 }),
  rawItem("mirror", { section: "Bathroom", description: "Bathroom mirrors", sort_order: 2 }),
  rawItem("towels", { section: "Bathroom", description: "Towels and amenities", sort_order: 3, allows_na: false }),
  rawItem("bed", { section: "Bedroom", description: "Bedding", sort_order: 4 }),
  rawItem("lamp", { section: "Bedroom", description: "Lighting", sort_order: 5, is_required: false }),
  rawItem("door", { section: "Entry", description: "Door closes and locks", sort_order: 6, requires_photo_on_fail: true }),
];
export const REQUIRED_COUNT = CHECKLIST_ITEMS.filter((item) => item.is_required).length; // 5

export const standardTemplate = (over = {}) =>
  rawTemplate("t1", { name: "Standard Departure", is_default: true, room_type_id: null, fingerprint: "fp-1", items: CHECKLIST_ITEMS, ...over });
