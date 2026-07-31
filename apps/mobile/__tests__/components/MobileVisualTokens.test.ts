import {
  C,
  aiTokens,
  darkAiTokens,
  darkTheme,
  lightTheme,
  monoFont,
  statusTokens,
} from "@/components/shared/tokens";
import { getRoomTone, getToneColors } from "@/components/shared/mobileHandoff";
import {
  composite,
  compositedContrastRatio,
  contrastRatio,
  parseColor,
} from "@/__tests__/helpers/contrast";

const NORMAL_TEXT_CONTRAST = 4.5;
const ESSENTIAL_UI_CONTRAST = 3;

type SemanticTheme = {
  background: string;
  surface: string;
  surfaceSubtle: string;
  surfaceMuted: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  border: string;
  primary: string;
  primaryAction: string;
  primarySoft: string;
  primaryLine: string;
  destructiveAction: string;
  onPrimary: string;
  onDestructive: string;
  onDisabled: string;
  onAi: string;
  shell: {
    bg: string;
    surface: string;
    raised: string;
    line: string;
    ink: string;
    ink2: string;
    ink3: string;
  };
  ai: {
    primary: string;
    soft: string;
    line: string;
  };
  banner: {
    offline: {
      background: string;
      foreground: string;
      border: string;
    };
  };
  toast: Record<
    "success" | "error" | "info",
    {
      background: string;
      foreground: string;
      border: string;
    }
  >;
  status: Record<
    "ready" | "clean" | "inProgress" | "dirty" | "occupied" | "pickup" | "outOfOrder",
    string
  > &
    Record<
      | "readySoft"
      | "cleanSoft"
      | "inProgressSoft"
      | "dirtySoft"
      | "pickupSoft"
      | "outOfOrderSoft"
      | "readyLine"
      | "cleanLine"
      | "inProgressLine"
      | "dirtyLine"
      | "pickupLine"
      | "outOfOrderLine",
      string
    >;
};

const themes = [
  ["light", lightTheme as unknown as SemanticTheme],
  ["dark", darkTheme as unknown as SemanticTheme],
] as const;

function expectContrast(foreground: string, background: string, minimum: number) {
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum);
}

function expectCompositedContrast(
  foreground: string,
  translucentBackground: string,
  base: string,
  minimum: number,
) {
  expect(compositedContrastRatio(foreground, translucentBackground, base)).toBeGreaterThanOrEqual(
    minimum,
  );
}

describe("mobile visual tokens", () => {
  it("uses the Evening Lobby chrome with the forest-green main palette", () => {
    expect(lightTheme.background).toBe("#F8F1E7");
    expect(lightTheme.surface).toBe("#FFFDFC");
    expect(lightTheme.primaryAction).toBe("#4F7A5A");

    expect(darkTheme.background).toBe("#0F0D0B");
    expect(darkTheme.surface).toBe("#191512");
    expect(darkTheme.surfaceElevated).toBe("#232019");
    expect(darkTheme.primaryAction).toBe("#7EA889");

    expect(C.paper).toBe(lightTheme.background);
    expect(C.surface).toBe(lightTheme.surface);
    expect(C.accent).toBe(lightTheme.primaryAction);
  });

  it("centralizes AI-only colors separately from room status colors", () => {
    expect(aiTokens.primary).toBe("#7C3AED");
    expect(aiTokens.secondary).toBe("#14B8A6");
    expect(aiTokens.electric).toBe("#38BDF8");
    expect(darkAiTokens.primary).toBe("#A78BFA");
    expect(darkTheme.glass).toBe("rgba(255, 255, 255, 0.06)");
    expect(darkTheme.glassBorder).toBe("rgba(255, 255, 255, 0.10)");

    expect(C.ai).toBe(aiTokens.primary);
    expect(C.ai).not.toBe(statusTokens.ready);
    expect(C.ai).not.toBe(statusTokens.clean);
    expect(C.ai).not.toBe(statusTokens.dirty);
    expect(C.ai).not.toBe(statusTokens.pickup);
  });

  it("keeps status meanings while applying the refined room-status palette", () => {
    expect(statusTokens.ready).toBe("#0E7468");
    expect(statusTokens.clean).toBe("#285F80");
    expect(statusTokens.inProgress).toBe("#684095");
    expect(statusTokens.dirty).toBe("#A9363F");
    expect(statusTokens.occupied).toBe(statusTokens.dirty);
    expect(statusTokens.pickup).toBe("#82540F");
    expect(statusTokens.outOfOrder).toBe("#625B52");

    expect(getRoomTone("INSPECTED")).toBe("ready");
    expect(getRoomTone("CLEAN")).toBe("clean");
    expect(getRoomTone("DIRTY")).toBe("dirty");
    expect(getRoomTone("OCCUPIED")).toBe("occupied");
    expect(getRoomTone("PICKUP")).toBe("pickup");
    expect(getRoomTone("OUT_OF_ORDER")).toBe("ooo");
  });

  it("uses core status color for dots while keeping soft fills restrained", () => {
    expect(getToneColors("ready").fg).toBe(statusTokens.ready);
    expect(getToneColors("clean").fg).toBe(statusTokens.clean);
    expect(getToneColors("dirty").fg).toBe(statusTokens.dirty);
    expect(getToneColors("occupied").fg).toBe(statusTokens.occupied);
    expect(getToneColors("pickup").fg).toBe(statusTokens.pickup);
    expect(getToneColors("ooo").fg).toBe(statusTokens.outOfOrder);

    expect(getToneColors("ready").bg).toBe("#D7EDE7");
    expect(getToneColors("clean").bg).toBe("#DDEAF1");
    expect(getToneColors("dirty").bg).toBe("#F6DDE0");
    expect(getToneColors("pickup").bg).toBe("#F7E8C8");
  });

  it("keeps the mobile app on native system UI fonts with monospace only for numeric codes", () => {
    expect(monoFont).toBeTruthy();
    expect(C.fontFamily).toBeUndefined();
  });
});

describe("contrast helper", () => {
  it("parses shorthand, full, alpha hex, rgb, and rgba colors", () => {
    expect(parseColor("#abc")).toEqual({ red: 170, green: 187, blue: 204, alpha: 1 });
    expect(parseColor("#112233")).toEqual({ red: 17, green: 34, blue: 51, alpha: 1 });
    expect(parseColor("#00000080")).toEqual({ red: 0, green: 0, blue: 0, alpha: 128 / 255 });
    expect(parseColor("rgb(12, 34, 56)")).toEqual({ red: 12, green: 34, blue: 56, alpha: 1 });
    expect(parseColor("rgba(12, 34, 56, 0.25)")).toEqual({
      red: 12,
      green: 34,
      blue: 56,
      alpha: 0.25,
    });
  });

  it("matches known WCAG and alpha-composite examples", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 8);
    expect(composite("rgba(255, 0, 0, 0.5)", "#000")).toEqual({
      red: 127.5,
      green: 0,
      blue: 0,
    });
    expect(composite("#00000080", "#fff")).toEqual({
      red: 127,
      green: 127,
      blue: 127,
    });
  });
});

describe.each(themes)("%s semantic token contrast", (themeName, theme) => {
  const contentSurfaces = [
    ["background", theme.background],
    ["surface", theme.surface],
    ["subtle surface", theme.surfaceSubtle],
    ["muted surface", theme.surfaceMuted],
    ["elevated surface", theme.surfaceElevated],
  ] as const;

  it.each(contentSurfaces)(
    `primary text / %s meets ${NORMAL_TEXT_CONTRAST}:1`,
    (_surfaceName, background) => {
      expectContrast(theme.textPrimary, background, NORMAL_TEXT_CONTRAST);
    },
  );

  it.each(contentSurfaces)(
    `secondary text / %s meets ${NORMAL_TEXT_CONTRAST}:1`,
    (_surfaceName, background) => {
      expectContrast(theme.textSecondary, background, NORMAL_TEXT_CONTRAST);
    },
  );

  it.each(contentSurfaces)(
    `muted text / %s meets ${NORMAL_TEXT_CONTRAST}:1`,
    (_surfaceName, background) => {
      expectContrast(theme.textMuted, background, NORMAL_TEXT_CONTRAST);
    },
  );

  it.each([
    ["background", theme.background],
    ["surface", theme.surface],
  ] as const)(
    `disabled text / %s meets the locked ${NORMAL_TEXT_CONTRAST}:1 contract`,
    (_surfaceName, background) => {
      expectContrast(theme.textDisabled, background, NORMAL_TEXT_CONTRAST);
    },
  );

  it.each([
    ["active tab text and icon", theme.shell.ink],
    ["secondary shell text", theme.shell.ink2],
    ["inactive tab text and icon", theme.shell.ink3],
  ] as const)(
    `%s / navigator shell meets ${NORMAL_TEXT_CONTRAST}:1`,
    (_pairName, foreground) => {
      expectContrast(foreground, theme.shell.bg, NORMAL_TEXT_CONTRAST);
    },
  );

  it(`navigator shell boundary meets ${ESSENTIAL_UI_CONTRAST}:1`, () => {
    expectContrast(theme.shell.line, theme.shell.bg, ESSENTIAL_UI_CONTRAST);
  });

  it.each([
    ["primary action", theme.onPrimary, theme.primaryAction],
    ["pressed primary action", theme.onPrimary, theme.primary],
    ["destructive action", theme.onDestructive, theme.destructiveAction],
    ["AI action", theme.onAi, theme.ai.primary],
  ] as const)(
    `%s foreground/background meets ${NORMAL_TEXT_CONTRAST}:1`,
    (_pairName, foreground, background) => {
      expectContrast(foreground, background, NORMAL_TEXT_CONTRAST);
    },
  );

  it(`disabled action foreground / composited fill meets ${NORMAL_TEXT_CONTRAST}:1`, () => {
    expectCompositedContrast(
      theme.onDisabled,
      theme.primarySoft,
      theme.surface,
      NORMAL_TEXT_CONTRAST,
    );
  });

  it.each([
    ["card boundary / background", theme.border, theme.background],
    ["sheet and modal boundary / surface", theme.border, theme.surface],
  ] as const)(`%s meets ${ESSENTIAL_UI_CONTRAST}:1`, (_pairName, foreground, background) => {
    expectContrast(foreground, background, ESSENTIAL_UI_CONTRAST);
  });

  it(`selected boundary / surface meets ${ESSENTIAL_UI_CONTRAST}:1 after compositing`, () => {
    expectCompositedContrast(theme.primaryLine, theme.surface, theme.surface, ESSENTIAL_UI_CONTRAST);
  });

  it("light and dark shell values remain internally layered", () => {
    expect(theme.shell.bg).not.toBe(theme.shell.surface);
    expect(theme.shell.surface).not.toBe(theme.shell.raised);
  });

  it.each(["success", "error", "info"] as const)(
    `%s Toast text/icon/fill/border pairings meet AA`,
    (variant) => {
      const toast = theme.toast[variant];
      expectContrast(toast.foreground, toast.background, NORMAL_TEXT_CONTRAST);
      expectContrast(toast.background, theme.surfaceElevated, ESSENTIAL_UI_CONTRAST);
      expectContrast(toast.border, toast.background, ESSENTIAL_UI_CONTRAST);
    },
  );

  it("OfflineBanner text/icon/fill/border pairings meet AA", () => {
    const banner = theme.banner.offline;
    expectContrast(banner.foreground, banner.background, NORMAL_TEXT_CONTRAST);
    expectContrast(banner.background, theme.background, ESSENTIAL_UI_CONTRAST);
    expectContrast(banner.border, banner.background, ESSENTIAL_UI_CONTRAST);
  });

  const statusNames = [
    "ready",
    "clean",
    "inProgress",
    "dirty",
    "occupied",
    "pickup",
    "outOfOrder",
  ] as const;

  it.each(statusNames)(
    `%s status foreground / composited soft fill meets ${NORMAL_TEXT_CONTRAST}:1`,
    (statusName) => {
      const softKey = `${statusName === "occupied" ? "dirty" : statusName}Soft` as const;
      expectCompositedContrast(
        theme.status[statusName],
        theme.status[softKey],
        theme.surface,
        NORMAL_TEXT_CONTRAST,
      );
    },
  );

  it.each(statusNames)(
    `%s status meaningful border / composited soft fill meets ${ESSENTIAL_UI_CONTRAST}:1`,
    (statusName) => {
      const familyName = statusName === "occupied" ? "dirty" : statusName;
      const softKey = `${familyName}Soft` as const;
      const lineKey = `${familyName}Line` as const;
      expectCompositedContrast(
        theme.status[lineKey],
        theme.status[softKey],
        theme.surface,
        ESSENTIAL_UI_CONTRAST,
      );
    },
  );

  if (themeName === "dark") {
    it.each([
      ["Copilot body text / canvas", theme.textPrimary, theme.background],
      ["Copilot secondary text / bubble", theme.textSecondary, theme.surfaceElevated],
      ["Copilot AI action", theme.onAi, theme.ai.primary],
      ["Copilot AI boundary", theme.ai.line, theme.surfaceElevated],
      ["Copilot confirmation text", theme.status.ready, theme.status.readySoft],
    ] as const)(`%s meets its locked contrast threshold`, (pairName, foreground, background) => {
      const minimum =
        pairName.includes("boundary") ? ESSENTIAL_UI_CONTRAST : NORMAL_TEXT_CONTRAST;
      if (background.startsWith("rgba")) {
        expectCompositedContrast(foreground, background, theme.surface, minimum);
      } else if (foreground.startsWith("rgba")) {
        expectCompositedContrast(foreground, theme.surfaceElevated, theme.surfaceElevated, minimum);
      } else {
        expectContrast(foreground, background, minimum);
      }
    });
  }
});

describe("theme token shape", () => {
  it("keeps light and dark theme keys aligned while preserving distinct shells", () => {
    expect(Object.keys(lightTheme).sort()).toEqual(Object.keys(darkTheme).sort());
    expect(Object.keys(lightTheme.shell).sort()).toEqual(Object.keys(darkTheme.shell).sort());
    expect(lightTheme.shell).not.toEqual(darkTheme.shell);
  });

  it("preserves protected Evening Lobby, forest-green, and status identities", () => {
    expect(darkTheme.background).toBe("#0F0D0B");
    expect(darkTheme.primaryAction).toBe("#7EA889");
    expect(lightTheme.primaryAction).toBe("#4F7A5A");

    expect(lightTheme.status.ready).not.toBe(lightTheme.status.clean);
    expect(lightTheme.status.clean).not.toBe(lightTheme.status.inProgress);
    expect(lightTheme.status.inProgress).not.toBe(lightTheme.status.pickup);
    expect(lightTheme.status.dirty).toBe(lightTheme.status.occupied);
    expect(lightTheme.status.outOfOrder).not.toBe(lightTheme.status.pickup);
  });
});
