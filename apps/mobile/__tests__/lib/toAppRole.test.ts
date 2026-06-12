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
});
