import { isDesignV2Enabled, resolveDesignV2Preview } from "@/lib/design/designV2";

describe("Design V2 preview flag", () => {
  it("is disabled by default (no env configured in the test runner)", () => {
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("requires the literal string 'true'", () => {
    expect(resolveDesignV2Preview(undefined, undefined)).toBe(false);
    expect(resolveDesignV2Preview("", undefined)).toBe(false);
    expect(resolveDesignV2Preview("1", undefined)).toBe(false);
    expect(resolveDesignV2Preview("yes", undefined)).toBe(false);
    expect(resolveDesignV2Preview("false", undefined)).toBe(false);
    expect(resolveDesignV2Preview("true", undefined)).toBe(true);
    expect(resolveDesignV2Preview(" TRUE ", "development")).toBe(true);
  });

  it("can never be enabled in a production environment", () => {
    expect(resolveDesignV2Preview("true", "production")).toBe(false);
    expect(resolveDesignV2Preview("true", " Production ")).toBe(false);
    expect(resolveDesignV2Preview("true", "staging")).toBe(true);
  });
});
