import { C, darkTheme, lightTheme, monoFont, statusTokens } from "@/components/shared/tokens";
import { getRoomTone, getToneColors } from "@/components/shared/mobileHandoff";

describe("mobile visual tokens", () => {
  it("uses the updated warm hospitality light and dark foundations", () => {
    expect(lightTheme.background).toBe("#F8F1E7");
    expect(lightTheme.surface).toBe("#FFFDFC");
    expect(lightTheme.primaryAction).toBe("#4F7A5A");

    expect(darkTheme.background).toBe("#171310");
    expect(darkTheme.surface).toBe("#211B17");
    expect(darkTheme.primaryAction).toBe("#7EA889");

    expect(C.paper).toBe(lightTheme.background);
    expect(C.surface).toBe(lightTheme.surface);
    expect(C.accent).toBe(lightTheme.primaryAction);
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
