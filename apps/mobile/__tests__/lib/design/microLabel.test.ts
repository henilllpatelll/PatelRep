import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..", "..");

const MIGRATED = [
  "app/(app)/scheduling/index.tsx",
  "app/(app)/profile/whats-new.tsx",
  "components/ai/ActionConfirmPanel.tsx",
  "components/ai/ActionPreviewCard.tsx",
  "components/ai/AssistantCards.tsx",
  "components/ai/AssistantMessageView.tsx",
  "components/ai/ConfirmRows.tsx",
  "components/ai/RoomQuestionList.tsx",
  "components/ai/SupervisorCopilotBody.tsx",
  "components/engineering/home/homeStyles.ts",
  "components/settings/EditFieldSheet.tsx",
  "components/settings/SyncChangesSheet.tsx",
  "components/shared/CopilotCard.tsx",
  "components/shared/mobileHandoff.tsx",
  "components/tasks/StaffTasksScreen.tsx",
  "components/voice/VoiceCapturePanel.tsx",
];

describe("microLabel (V2 sentence-case labels in static styles)", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("flag off: legacy values, byte-for-byte", () => {
    jest.isolateModules(() => {
      jest.doMock("@/lib/design/designV2", () => ({ isDesignV2Enabled: () => false }));
      const m = require("@/lib/design/microLabel");
      expect(m.microLabelCase()).toBe("uppercase");
      expect(m.microLabelTracking(0.9)).toBe(0.9);
      expect(m.microLabelSize(10.5)).toBe(10.5);
    });
  });

  it("flag on: sentence case, no tracking, never below 12", () => {
    jest.isolateModules(() => {
      jest.doMock("@/lib/design/designV2", () => ({ isDesignV2Enabled: () => true }));
      const m = require("@/lib/design/microLabel");
      expect(m.microLabelCase()).toBe("none");
      expect(m.microLabelTracking(0.9)).toBe(0);
      expect(m.microLabelSize(10.5)).toBe(12);
      expect(m.microLabelSize(14)).toBe(14);
    });
  });

  it.each(MIGRATED)("%s no longer hardcodes uppercase", (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    expect(src).not.toMatch(/textTransform:\s*"uppercase"/);
    expect(src).toContain("microLabelCase()");
  });

  it("the print label keeps its intentional uppercase", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/(app)/assets/label/[assetId].tsx"), "utf8");
    expect(src).toMatch(/textTransform:\s*"uppercase"/);
  });
});
