import { StyleSheet } from "react-native";
import { R } from "@/components/shared/tokens";

/** Shared sizing for the Technician Home pieces. */
/**
 * Text-scaling ceiling for Home. Generous on purpose: layouts wrap and grow instead of clipping, so a person who has
 * enlarged system text still reads everything (the ceiling only stops pathological sizes breaking a row).
 */
export const HOME_MAX_FONT = 2;
export const HOME_MIN_TOUCH = 48;

export const homeStyles = StyleSheet.create({
  meta: { fontSize: 12.5, lineHeight: 17 },
  link: { fontSize: 13, fontWeight: "800" },
  linkRow: { minHeight: HOME_MIN_TOUCH, justifyContent: "center" },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase", marginTop: 6 },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: HOME_MIN_TOUCH },
  radius: { borderRadius: R.md },
});
