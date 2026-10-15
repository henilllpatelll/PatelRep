import { readFileSync } from "fs";
import { resolve } from "path";
import AsyncStorage from "@react-native-async-storage/async-storage";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { HIDDEN_APP_ROUTES } from "@/lib/navigation/roleTabs";
import { GENERAL_FAQS, ROLE_FAQS, SUPPORT_ROUTES, faqsForRole } from "@/lib/support/faq";
import { DIAGNOSTIC_KEYS, buildDiagnostics, diagnosticsToContext } from "@/lib/support/diagnostics";
import {
  MAX_REPORT_LENGTH,
  clearDraft,
  loadDraft,
  parseDraft,
  saveDraft,
  validateDraft,
  type ReportDraft,
} from "@/lib/support/reportDraft";
import { REPORT_AREAS, areasForRole, submitProblemReport } from "@/lib/api/support";
import { dialableNumber } from "@/components/settings/ContactSheet";

const mockPost = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { post: (...a: unknown[]) => mockPost(...a), get: jest.fn() } }));
jest.mock("@/components/housekeeping/roomDetail/BottomSheet", () => ({ BottomSheet: () => null }));

type Tree = { [k: string]: string | Tree };
const get = (tree: Tree, path: string): unknown => path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Tree)[k] : undefined), tree);
const leafPaths = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leafPaths(v, `${prefix}${k}.`)));

describe("FAQ registry", () => {
  const all = [...GENERAL_FAQS, ...ROLE_FAQS];

  it("has English and Spanish text for every question and answer, and for every action label", () => {
    for (const lang of [en, es] as unknown as Tree[]) {
      for (const item of all) {
        expect(typeof get(lang, `help.faq.items.${item.id}.q`)).toBe("string");
        expect(typeof get(lang, `help.faq.items.${item.id}.a`)).toBe("string");
        if (item.action) expect(typeof get(lang, item.action.labelKey)).toBe("string");
      }
    }
  });

  it("keeps ids unique", () => {
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  });

  it("only links to existing Settings destinations", () => {
    const valid = new Set(Object.values(SUPPORT_ROUTES));
    for (const item of all) {
      if (item.action?.kind === "route") {
        expect(valid.has(item.action.route as never)).toBe(true);
        expect(HIDDEN_APP_ROUTES).toContain(item.action.route.replace("/(app)/", ""));
      }
    }
  });

  it("shows each role its own questions first, plus the shared ones", () => {
    const ids = (role: string) => faqsForRole(role).map((i) => i.id);
    expect(ids("housekeeper").slice(0, 2)).toEqual(["hkReclean", "hkSessionSync"]);
    expect(ids("engineer")).toContain("engWorkOrders");
    expect(ids("chief_engineer")).toContain("engUpdates");
    expect(ids("gm")).toContain("gmAdmin");
    expect(ids("housekeeper")).not.toContain("gmAdmin");
    for (const role of ["housekeeper", "inspector", "engineer", "housekeeping_supervisor", "front_desk", "gm"]) {
      expect(ids(role)).toEqual(expect.arrayContaining(GENERAL_FAQS.map((i) => i.id)));
    }
    expect(ids("unknown_role")).toEqual(GENERAL_FAQS.map((i) => i.id));
  });
});

describe("help locale parity", () => {
  it("English and Spanish carry exactly the same help keys", () => {
    expect(leafPaths((es as unknown as { help: Tree }).help).sort()).toEqual(leafPaths((en as unknown as { help: Tree }).help).sort());
  });
});

describe("diagnostics allowlist", () => {
  it("matches the keys the server accepts", () => {
    const server = readFileSync(resolve(__dirname, "../../../api/routers/feedback.py"), "utf8");
    const block = server.slice(server.indexOf("MOBILE_DIAGNOSTIC_KEYS"), server.indexOf(")", server.indexOf("MOBILE_DIAGNOSTIC_KEYS")));
    for (const key of DIAGNOSTIC_KEYS) expect(block).toContain(`"${key}"`);
  });

  it("builds only known fields, skips unknown values and never guesses", () => {
    const entries = buildDiagnostics({ appVersion: "1.0.0", platform: "ios", online: false, pending: 0, failed: null, osVersion: undefined, role: "" });
    expect(entries.map((e) => e.key)).toEqual(["app_version", "platform", "online", "pending_changes"]);
    expect(diagnosticsToContext(entries)).toEqual({ app_version: "1.0.0", platform: "ios", online: false, pending_changes: 0 });
  });

  it("cannot carry anything outside the allowlist, whatever is passed in", () => {
    const sneaky = { appVersion: "1", accessToken: "secret", guestName: "Jane Guest", payload: { a: 1 } } as never;
    const keys = buildDiagnostics(sneaky).map((e) => e.key);
    expect(keys).toEqual(["app_version"]);
    for (const key of DIAGNOSTIC_KEYS) expect(key).not.toMatch(/token|password|guest|payload|note|reservation/i);
  });

  it("shortens long text", () => {
    expect(String(buildDiagnostics({ syncStatus: "x".repeat(300) })[0].value).length).toBe(80);
  });
});

describe("report draft", () => {
  const draft: ReportDraft = { area: "tasks", message: "The task list never loads", blocking: false, includeDiagnostics: true, requestId: "req-1" };

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("validates empty, too short and missing area", () => {
    expect(validateDraft({ area: "tasks", message: "   " })).toBe("empty");
    expect(validateDraft({ area: "tasks", message: "too short" })).toBe("tooShort");
    expect(validateDraft({ area: null, message: "long enough message here" })).toBe("noArea");
    expect(validateDraft({ area: "tasks", message: "long enough message here" })).toBeNull();
  });

  it("stops a description at the maximum length when restoring", () => {
    const restored = parseDraft(JSON.stringify({ ...draft, message: "a".repeat(MAX_REPORT_LENGTH + 500) }));
    expect(restored?.message.length).toBe(MAX_REPORT_LENGTH);
  });

  it("keeps drafts per person and hotel", async () => {
    await saveDraft("hotel-1:user-a", draft);
    expect(await loadDraft("hotel-1:user-a")).toEqual(draft);
    expect(await loadDraft("hotel-1:user-b")).toBeNull();
    expect(await loadDraft("hotel-2:user-a")).toBeNull();
  });

  it("removes the draft on clear, and does not store an empty one", async () => {
    await saveDraft("s", draft);
    await clearDraft("s");
    expect(await loadDraft("s")).toBeNull();
    await saveDraft("s", { ...draft, message: "  " });
    expect(await loadDraft("s")).toBeNull();
  });

  it("ignores a corrupted draft", () => {
    expect(parseDraft("{nope")).toBeNull();
    expect(parseDraft(JSON.stringify({ message: 5 }))).toBeNull();
  });
});

describe("report areas and contacts", () => {
  it("offers each role only what it uses, always ending with Other", () => {
    expect(areasForRole("engineer")).toContain("work_orders");
    expect(areasForRole("engineer")).not.toContain("housekeeping");
    expect(areasForRole("housekeeper")).not.toContain("work_orders");
    expect(areasForRole("gm")).toEqual(REPORT_AREAS);
    for (const role of ["housekeeper", "inspector", "engineer", "housekeeping_supervisor", "front_desk", "gm", "mystery"]) {
      expect(areasForRole(role).at(-1)).toBe("other");
    }
  });

  it("only dials a plausible phone number", () => {
    expect(dialableNumber("(512) 555-0100")).toBe("5125550100");
    expect(dialableNumber("+1 512 555 0100")).toBe("+15125550100");
    expect(dialableNumber("ext 12")).toBeNull();
    expect(dialableNumber("javascript:alert(1)")).toBeNull();
    expect(dialableNumber(null)).toBeNull();
  });
});

describe("submitProblemReport", () => {
  beforeEach(() => mockPost.mockReset());

  it("sends only what the person entered; the server decides who and which hotel", async () => {
    mockPost.mockResolvedValue({ data: { id: "r-1", status: "open", created_at: "2026-10-15T12:00:00Z" } });
    const result = await submitProblemReport({ area: "sync", message: "It never syncs", blocking: true, clientRequestId: "abc", diagnostics: { app_version: "1" } });
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe("/feedback");
    expect(body).toMatchObject({ source: "mobile", category: "bug", severity: "blocking", area: "sync", client_request_id: "abc", client_context: { app_version: "1" } });
    expect(body).not.toHaveProperty("user_id");
    expect(body).not.toHaveProperty("tenant_id");
    expect(result).toMatchObject({ id: "r-1", status: "open", replayed: false });
  });

  it("maps Other to the other category and omits diagnostics unless provided", async () => {
    mockPost.mockResolvedValue({ data: { id: "r-2", status: "open", created_at: "x" }, meta: { replayed: true } });
    const result = await submitProblemReport({ area: "other", message: "Something odd", blocking: false, clientRequestId: "abc" });
    expect(mockPost.mock.calls[0][1]).toMatchObject({ category: "other", severity: "annoying", client_context: {} });
    expect(result.replayed).toBe(true);
  });

  it("is not a success unless the server returned the stored report", async () => {
    mockPost.mockResolvedValue({ data: null });
    await expect(submitProblemReport({ area: "tasks", message: "abc def ghi jkl", blocking: false, clientRequestId: "a" })).rejects.toThrow();
    mockPost.mockRejectedValue(new Error("Network request failed"));
    await expect(submitProblemReport({ area: "tasks", message: "abc def ghi jkl", blocking: false, clientRequestId: "a" })).rejects.toThrow("Network");
  });
});
