import fs from "fs";
import path from "path";
import { isDesignV2Enabled, resolveDesignV2Preview } from "@/lib/design/designV2";

describe("Design V2 preview flag", () => {
  it("is disabled by default (no env configured in the test runner)", () => {
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("requires the literal string 'true'", () => {
    expect(resolveDesignV2Preview(undefined, "development")).toBe(false);
    expect(resolveDesignV2Preview("", "development")).toBe(false);
    expect(resolveDesignV2Preview("1", "development")).toBe(false);
    expect(resolveDesignV2Preview("yes", "development")).toBe(false);
    expect(resolveDesignV2Preview("false", "development")).toBe(false);
    expect(resolveDesignV2Preview("true", "development")).toBe(true);
    expect(resolveDesignV2Preview(" TRUE ", "development")).toBe(true);
  });

  it("fails CLOSED: an unset or unknown environment is production (the old guard failed open)", () => {
    expect(resolveDesignV2Preview("true", undefined)).toBe(false);
    expect(resolveDesignV2Preview("true", "")).toBe(false);
    expect(resolveDesignV2Preview("true", "prod")).toBe(false);
    expect(resolveDesignV2Preview("true", "anything")).toBe(false);
  });

  it("can never be enabled in a production environment", () => {
    expect(resolveDesignV2Preview("true", "production")).toBe(false);
    expect(resolveDesignV2Preview("true", " Production ")).toBe(false);
    expect(resolveDesignV2Preview("true", "staging")).toBe(true);
  });
});

describe("Design V2 production guard is armed in release config", () => {
  const eas = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../eas.json"), "utf8"));

  it("the EAS production profile declares itself production, so the flag guard can fire", () => {
    // The guard only works if production builds set EXPO_PUBLIC_APP_ENV=production. Without it a stray
    // EXPO_PUBLIC_DESIGN_V2_PREVIEW=true in the build environment would silently enable V2 for users.
    expect(eas.build.production.env.EXPO_PUBLIC_APP_ENV).toBe("production");
  });

  it("no EAS profile sets the preview flag", () => {
    for (const profile of Object.values(eas.build) as Array<{ env?: Record<string, string> }>) {
      expect(profile.env ?? {}).not.toHaveProperty("EXPO_PUBLIC_DESIGN_V2_PREVIEW");
    }
  });

  it("legacy fonts are unchanged while the flag is off", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tokens = require("@/components/shared/tokens");
    expect(tokens.serifFont).toBe("InstrumentSerif_400Regular");
    expect(String(tokens.monoFont)).toMatch(/IBMPlexMono_500Medium|monospace/);
  });
});
