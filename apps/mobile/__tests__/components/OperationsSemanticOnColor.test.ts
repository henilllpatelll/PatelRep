import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OPERATIONS_SOURCES = {
  myRooms: "../../app/(app)/my-rooms/index.tsx",
  roomDetail: "../../app/(app)/my-rooms/[roomId].tsx",
  workOrderDetail: "../../app/(app)/work-orders/[woId].tsx",
  scheduling: "../../app/(app)/scheduling/index.tsx",
  tasks: "../../app/(app)/tasks/index.tsx",
} as const;

const sources = Object.fromEntries(
  Object.entries(OPERATIONS_SOURCES).map(([name, path]) => [
    name,
    readFileSync(resolve(__dirname, path), "utf8"),
  ]),
) as Record<keyof typeof OPERATIONS_SOURCES, string>;

/*
 * Manual target and large-text checklist for the explicitly audited controls:
 *
 * - My Rooms: mode tabs and building expand/collapse controls are >=44pt,
 *   named buttons with selected/expanded state; passive counts/dots are excluded.
 * - Room detail: back, AI ask, note removal/cancel, blocker/time/status/action
 *   controls are >=44pt and expose button names plus selected/disabled/busy state.
 * - Work-order detail: icon-only back/comment/hold controls are >=44x44 and
 *   named; photo/comment/hold controls expose disabled and busy state.
 * - Scheduling: no Pressable/TouchableOpacity controls are owned by this file;
 *   shift dots and pills are passive status marks and intentionally excluded.
 * - Tasks: preview create/dismiss and AI send controls are >=44pt, named
 *   buttons with disabled/busy state; action rows use minHeight, not fixed height.
 *
 * Text-bearing action rows must grow at 200% text scale and Spanish width.
 * Decorative dots, avatars, passive status marks, and photo thumbnails are not
 * touch targets and must not be swept into a broad target-size regex.
 */

describe("operations semantic on-colors", () => {
  it.each(Object.entries(sources))(
    "%s contains no audited raw white foreground or light-only warning fill",
    (_name, source) => {
      expect(source).not.toMatch(/#[Ff]{3}(?![0-9A-Fa-f])/);
      expect(source).not.toMatch(/#FFFFFF\b/i);
      expect(source).not.toMatch(/#FFF7F7\b/i);
    },
  );

  it("uses the offline banner semantic roles in My Rooms", () => {
    expect(sources.myRooms).toContain("theme.banner.offline.background");
    expect(sources.myRooms).toContain("theme.banner.offline.foreground");
    expect(sources.myRooms).toContain("theme.banner.offline.border");
  });

  it("uses the active dirty soft and line roles for room warnings", () => {
    expect(sources.roomDetail).toContain(
      "backgroundColor: theme.status.dirtySoft",
    );
    expect(sources.roomDetail).toContain(
      "borderColor: theme.status.dirtyLine",
    );
  });

  it("uses the tested primary on-color for work-order actions", () => {
    expect(sources.workOrderDetail).toContain("theme.onPrimary");
  });

  it("uses the tested primary on-color for the active schedule card", () => {
    expect(sources.scheduling).toContain("theme.onPrimary");
  });

  it("uses the tested primary and AI on-colors for task actions", () => {
    expect(sources.tasks).toContain("theme.onPrimary");
    expect(sources.tasks).toContain("theme.onAi");
  });
});
