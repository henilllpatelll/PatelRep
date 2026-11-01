import fs from "fs";
import path from "path";
import {
  ENGINEERING_ROLES,
  canActOnWorkOrders,
  canCompletePm,
  isEngineeringRole,
} from "@/lib/engineering/roles";

describe("engineering roles", () => {
  it("recognises engineer and chief_engineer only", () => {
    expect([...ENGINEERING_ROLES]).toEqual(["engineer", "chief_engineer"]);
    expect(isEngineeringRole("engineer")).toBe(true);
    expect(isEngineeringRole("chief_engineer")).toBe(true);
    for (const role of ["housekeeper", "inspector", "housekeeping_supervisor", "front_desk", "gm", "", null, undefined]) {
      expect(isEngineeringRole(role)).toBe(false);
    }
  });

  it("work-order actions follow the API guard: engineer and gm, not chief_engineer", () => {
    expect(canActOnWorkOrders("engineer")).toBe(true);
    expect(canActOnWorkOrders("gm")).toBe(true);
    expect(canActOnWorkOrders("chief_engineer")).toBe(false);
    expect(canActOnWorkOrders("housekeeper")).toBe(false);
    expect(canActOnWorkOrders(undefined)).toBe(false);
  });

  it("PM completion follows the API guard: engineer, gm and chief_engineer", () => {
    expect(canCompletePm("engineer")).toBe(true);
    expect(canCompletePm("chief_engineer")).toBe(true);
    expect(canCompletePm("gm")).toBe(true);
    expect(canCompletePm("housekeeper")).toBe(false);
    expect(canCompletePm(null)).toBe(false);
  });
});

/* Drift guards: the API files below are the source of truth for these rules. */
const API = path.resolve(__dirname, "../../../../api");

describe("mobile role model matches the API", () => {
  it("work-order mutations stay engineer + gm only (chief_engineer is read-only there)", () => {
    const source = fs.readFileSync(path.join(API, "routers/work_orders.py"), "utf8");
    for (const route of ["claim", "transition", "complete"]) {
      const block = new RegExp(`@router\\.post\\("/\\{wo_id\\}/${route}"\\)[\\s\\S]*?require_role\\(([^)]*)\\)`).exec(source);
      expect(block).not.toBeNull();
      expect(block![1]).toContain('"engineer"');
      expect(block![1]).toContain('"gm"');
      expect(block![1]).not.toContain("chief_engineer");
    }
  });

  it("PM completion stays engineer + gm + chief_engineer", () => {
    const source = fs.readFileSync(path.join(API, "routers/assets.py"), "utf8");
    const block = /@router\.post\("\/pm-schedules\/\{schedule_id\}\/complete"\)[\s\S]*?require_role\(([^)]*)\)/.exec(source);
    expect(block).not.toBeNull();
    for (const role of ["engineer", "gm", "chief_engineer"]) expect(block![1]).toContain(`"${role}"`);
  });
});
