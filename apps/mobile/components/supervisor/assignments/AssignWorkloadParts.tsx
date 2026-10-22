import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { capacityText, minutesText, missingText, warningText } from "@/lib/housekeeping/assignmentFlowText";
import type { LoadView, PersonImpact } from "@/lib/housekeeping/assignmentPicker";
import type { WorkloadWarning } from "@/lib/housekeeping/assignmentWorkload";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One "label ........ value" line. */
export function ValueLine({ label, value, strong, muted, testID }: { label: string; value: string; strong?: boolean; muted?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.lineValue, { color: muted ? theme.textMuted : theme.textPrimary }, strong && styles.strong]}
        testID={testID}
      >
        {value}
      </Text>
    </View>
  );
}

/** A warning is a sentence with an icon, never colour alone. */
export function WarningLine({ warning, t, name, testID }: { warning: WorkloadWarning; t: Translate; name?: string; testID?: string }) {
  const theme = useTheme();
  const text = warningText(warning, t);
  if (!text) return null;
  return (
    <View style={styles.warning} accessible accessibilityLabel={text} testID={testID}>
      <Ionicons name="warning-outline" size={15} color={theme.destructiveAction} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.warningText, { color: theme.destructiveAction }]}>
        {name ? `${name}: ${text}` : text}
      </Text>
    </View>
  );
}

/** Warnings worth a line, shown only when they exist. */
export function WarningLines({ warnings, t, name, testIDPrefix }: { warnings: readonly WorkloadWarning[]; t: Translate; name?: string; testIDPrefix: string }) {
  return (
    <>
      {warnings.map((warning) => (
        <WarningLine key={warning} warning={warning} t={t} {...(name ? { name } : {})} testID={`${testIDPrefix}-${warning}`} />
      ))}
    </>
  );
}

/** Remaining time before → after for ONE person. */
export function ImpactBlock({
  impact,
  heading,
  t,
  testID,
  tone,
}: {
  impact: PersonImpact;
  heading: string;
  t: Translate;
  testID: string;
  /** `receive` = they take the room; `release` = it leaves them. Only changes the label wording. */
  tone: "receive" | "release";
}) {
  const theme = useTheme();
  const before = impact.before;
  const after = impact.after;
  const capacity = capacityText(before, after, t);
  const missing = missingText(after.minutes, t);
  return (
    <View style={[styles.block, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
        {heading}
      </Text>
      <ValueLine label={t("assignments.v2.assign.review.currentRemaining")} value={minutesText(before.minutes, t)} testID={`${testID}-before`} />
      <ValueLine label={t(tone === "receive" ? "assignments.v2.assign.review.newRemaining" : "assignments.v2.assign.review.remainingAfter")} value={minutesText(after.minutes, t)} strong testID={`${testID}-after`} />
      {missing ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID={`${testID}-missing`}>
          {missing}
        </Text>
      ) : null}
      {capacity ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID={`${testID}-capacity`}>
          {capacity}
        </Text>
      ) : null}
      <WarningLines warnings={after.warnings} t={t} testIDPrefix={`${testID}-warning`} />
    </View>
  );
}

/** Before → after for one person in a single sentence-sized row, used on picker cards. */
export function CompareLines({ current, after, t, testIDPrefix }: { current: LoadView; after: LoadView | null; t: Translate; testIDPrefix: string }) {
  const theme = useTheme();
  return (
    <View style={styles.compare}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.compareLine, { color: theme.textSecondary }]} testID={`${testIDPrefix}-current`}>
        {t("assignments.v2.assign.candidate.currentRemaining", { value: minutesText(current.minutes, t) })}
      </Text>
      {after ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.compareLine, styles.strong, { color: theme.textPrimary }]} testID={`${testIDPrefix}-after`}>
          {t("assignments.v2.assign.candidate.afterAssignment", { value: minutesText(after.minutes, t) })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  lineLabel: { fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  lineValue: { fontSize: 14.5, flex: 1, textAlign: "right", fontWeight: "600" },
  strong: { fontWeight: "800" },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 4 },
  warningText: { flex: 1, fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
  block: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  heading: { fontSize: 13, fontWeight: "800", letterSpacing: 0.3, paddingBottom: 2 },
  note: { fontSize: 12.5, lineHeight: 17, paddingTop: 2 },
  compare: { gap: 1 },
  compareLine: { fontSize: 13, lineHeight: 18 },
});
