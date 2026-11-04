import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import {
  ENGINEERING_FAQS,
  ENGINEERING_SYNC_ROUTE,
  ENGINEERING_TOPICS,
  SUPPORT_ROUTES,
  faqTopicsForRole,
  faqsForRole,
  isEngineeringTopic,
  resolveFaqAction,
} from "@/lib/support/faq";
import { DIAGNOSTIC_KEYS, buildDiagnostics, diagnosticsToContext } from "@/lib/support/diagnostics";

const APP = path.join(__dirname, "..", "..", "..", "app", "(app)");
const routeExists = (route: string) => {
  const rel = route.replace(/^\/\(app\)\//, "").split("?")[0];
  return [`${rel}.tsx`, `${rel}/index.tsx`].some((f) => fs.existsSync(path.join(APP, f)));
};
const get = (obj: unknown, dotted: string) => dotted.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

describe("Engineering FAQ registry", () => {
  it("groups engineering questions into the five topics, in order, with no empty topic", () => {
    for (const role of ["engineer", "chief_engineer"]) {
      expect(faqTopicsForRole(role).map((g) => g.topic)).toEqual([...ENGINEERING_TOPICS]);
      for (const group of faqTopicsForRole(role)) expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("gives other roles no topics and keeps engineering questions out of their lists", () => {
    for (const role of ["housekeeper", "inspector", "housekeeping_supervisor", "front_desk", "gm", null]) {
      expect(faqTopicsForRole(role)).toEqual([]);
      expect(faqsForRole(role).some((i) => ENGINEERING_FAQS.includes(i))).toBe(false);
    }
    expect(faqsForRole("housekeeper").map((i) => i.id)).toContain("hkReclean");
    expect(faqsForRole("gm").map((i) => i.id)).toContain("gmAdmin");
  });

  it("has English and Spanish text for every question, topic and action label engineers can see", () => {
    for (const locale of [en, es]) {
      for (const item of faqsForRole("chief_engineer")) {
        expect(typeof get(locale, `help.faq.items.${item.id}.q`)).toBe("string");
        expect(typeof get(locale, `help.faq.items.${item.id}.a`)).toBe("string");
        if (item.action) expect(typeof get(locale, item.action.labelKey)).toBe("string");
      }
      for (const topic of ENGINEERING_TOPICS) {
        expect(typeof get(locale, `help.faq.topics.${topic}.title`)).toBe("string");
        expect(typeof get(locale, `help.faq.topics.${topic}.subtitle`)).toBe("string");
      }
    }
  });

  it("only offers actions that open screens that exist, and sends engineers to the Sync Center", () => {
    for (const item of faqsForRole("engineer")) {
      const action = resolveFaqAction(item.action, "engineer");
      if (action?.kind === "route") expect(routeExists(action.route)).toBe(true);
    }
    expect(routeExists(ENGINEERING_SYNC_ROUTE)).toBe(true);
    expect(resolveFaqAction({ kind: "route", route: SUPPORT_ROUTES.sync, labelKey: "x" }, "engineer")).toMatchObject({ route: ENGINEERING_SYNC_ROUTE });
    expect(resolveFaqAction({ kind: "route", route: SUPPORT_ROUTES.sync, labelKey: "x" }, "housekeeper")).toMatchObject({ route: SUPPORT_ROUTES.sync });
  });

  it("recognises only real topics", () => {
    expect(isEngineeringTopic("pm")).toBe(true);
    expect(isEngineeringTopic("nope")).toBe(false);
    expect(isEngineeringTopic(undefined)).toBe(false);
  });

  it("never tells people to clear storage or reinstall while changes may be waiting", () => {
    const text = faqsForRole("engineer")
      .map((i) => String(get(en, `help.faq.items.${i.id}.a`)))
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/clear (the )?(app )?(data|storage|cache)/);
    expect(text).not.toMatch(/reinstall (the app )?(now|first)/);
  });
});

describe("Diagnostics privacy boundary", () => {
  it("is an allowlist with no credential, tenant or payload fields", () => {
    const joined = DIAGNOSTIC_KEYS.join(",").toLowerCase();
    for (const banned of ["token", "password", "secret", "key", "auth", "tenant", "hotel", "guest", "payload", "email", "user_id"]) {
      expect(joined).not.toContain(banned);
    }
  });

  it("drops fields that are not on the list and leaves unknown values out instead of guessing", () => {
    const input = { appVersion: "1.2.3", platform: "ios", online: false, pending: null, failed: undefined, accessToken: "secret" } as never;
    const context = diagnosticsToContext(buildDiagnostics(input));
    expect(context).toEqual({ app_version: "1.2.3", platform: "ios", online: false });
    expect(JSON.stringify(context)).not.toContain("secret");
  });
});
