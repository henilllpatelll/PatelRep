import fs from "fs";
import path from "path";
import { toAppRole } from "@/lib/supabase";

describe("toAppRole", () => {
  it("accepts the user_role custom claim", () => {
    expect(toAppRole("housekeeping_supervisor")).toBe("housekeeping_supervisor");
    expect(toAppRole("gm")).toBe("gm");
  });

  it("never accepts the PostgREST 'authenticated' role", () => {
    expect(toAppRole("authenticated")).toBeNull();
    expect(toAppRole(undefined, "authenticated")).toBeNull();
  });

  it("falls through candidates in order", () => {
    expect(toAppRole(undefined, null, "engineer")).toBe("engineer");
    expect(toAppRole("authenticated", "front_desk")).toBe("front_desk");
    expect(toAppRole("not-a-role")).toBeNull();
  });

  it("accepts chief_engineer, a live role the API restored in migration 092", () => {
    expect(toAppRole("chief_engineer")).toBe("chief_engineer");
    expect(toAppRole(undefined, "chief_engineer")).toBe("chief_engineer");
  });

  it("accepts every role in apps/api/core/roles.py ALL_ROLES", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../api/core/roles.py"), "utf8");
    const match = /^ALL_ROLES = \(([^)]*)\)/m.exec(source);
    expect(match).not.toBeNull();
    const roles = [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(roles.length).toBeGreaterThanOrEqual(6);
    for (const role of roles) expect(toAppRole(role)).toBe(role);
  });
});
