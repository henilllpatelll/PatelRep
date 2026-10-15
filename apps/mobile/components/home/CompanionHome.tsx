import { lightTheme, type ThemeTokens } from "@/components/shared/tokens";

/* ─── Status → tile visual — protected color contract, shared with the
   supervisor room board (components/supervisor/atoms.tsx). The housekeeper
   Home cards that used to live here are now components/home/*. */

export interface TileVisual {
  bg: string;
  fg: string;
  border: string;
}

export function getTileVisual(
  status: string,
  theme: ThemeTokens = lightTheme,
): TileVisual {
  switch (status) {
    case "INSPECTED":
      return { bg: theme.status.ready, fg: theme.shell.ink, border: "transparent" };
    case "CLEAN":
      return { bg: theme.status.clean, fg: theme.shell.ink, border: "transparent" };
    case "IN_PROGRESS":
      return {
        bg: theme.status.inProgressSoft,
        fg: theme.status.inProgress,
        border: theme.status.inProgressLine,
      };
    case "PICKUP":
      return { bg: theme.status.pickupSoft, fg: theme.status.pickup, border: "transparent" };
    case "DIRTY":
    case "OCCUPIED":
      return {
        bg: theme.status.dirtySoft,
        fg: status === "OCCUPIED" ? theme.status.occupied : theme.status.dirty,
        border: "transparent",
      };
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return {
        bg: theme.status.outOfOrderSoft,
        fg: theme.status.outOfOrder,
        border: "transparent",
      };
    default:
      return { bg: theme.shell.raised, fg: theme.shell.ink2, border: "transparent" };
  }
}
