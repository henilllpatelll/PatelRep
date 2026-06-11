import { C, aiTokens, darkAiTokens, darkTheme, lightTheme, monoFont, statusTokens } from "@/components/shared/tokens";
import { getRoomTone, getToneColors } from "@/components/shared/mobileHandoff";

describe("mobile visual tokens", () => {
  it("uses the Evening Lobby light and dark foundations", () => {
    expect(lightTheme.background).toBe("#F6F3EC");
    expect(lightTheme.surface).toBe("#FFFFFF");
    expect(lightTheme.primaryAction).toBe("#B8431C");

    expect(darkTheme.background).toBe("#131210");
    expect(darkTheme.surface).toBe("#1C1A17");
    expect(darkTheme.surfaceElevated).toBe("#232019");
    expect(darkTheme.primaryAction).toBe("#D97757");

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
    expect(statusTokens.clean).toBe("#2F6F95");
    expect(statusTokens.dirty).toBe("#A9363F");
    expect(statusTokens.occupied).toBe(statusTokens.dirty);
    expect(statusTokens.pickup).toBe("#B7791F");
    expect(statusTokens.outOfOrder).toBe("#746D63");

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
