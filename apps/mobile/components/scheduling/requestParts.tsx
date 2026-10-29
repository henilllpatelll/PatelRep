import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import type { RequestFailure } from "@/lib/api/schedulingRequests";
import { clockLabel, failureKeyText, stepClock } from "@/lib/scheduling/requestsModel";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* Small building blocks shared by the availability, time-off, swap and request screens. */

/** A row of single-choice chips (the Pending / Approved / Denied / All filters, request types, reasons). */
export function ChipRow<T extends string>({ options, value, onChange, labelFor, testID, wrap = false }: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelFor: (option: T) => string;
  testID: string;
  wrap?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.chips, wrap && { flexWrap: "wrap" }]} accessibilityRole="tablist" testID={testID}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={labelFor(option)}
            testID={`${testID}-${option}`}
            style={[styles.chip, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary, fontWeight: selected ? "800" : "600" }]}>
              {labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A 15-minute time stepper. No typing: earlier / later buttons around the time. */
export function TimeStepper({ label, value, onChange, language, t, testID, disabled }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  language?: string;
  t: Translate;
  testID: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const shown = clockLabel(value, language);
  return (
    <View style={styles.timeBlock} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.timeLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <View style={styles.timeRow}>
        <StepButton icon="remove" name={t("scheduling.availabilityScreen.earlier")} onPress={() => onChange(stepClock(value, -1))} disabled={disabled} testID={`${testID}-earlier`} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`${label}. ${shown}`} style={[styles.timeValue, { color: theme.textPrimary }]} testID={`${testID}-value`}>
          {shown}
        </Text>
        <StepButton icon="add" name={t("scheduling.availabilityScreen.later")} onPress={() => onChange(stepClock(value, 1))} disabled={disabled} testID={`${testID}-later`} />
      </View>
    </View>
  );
}

function StepButton({ icon, name, onPress, disabled, testID }: { icon: "add" | "remove"; name: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [styles.step, { borderColor: theme.border, backgroundColor: theme.surface }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={theme.textPrimary} />
    </Pressable>
  );
}

/** A status pill: a word plus a colour, never colour alone. */
export function StatePill({ text, tone, testID }: { text: string; tone: "neutral" | "good" | "warn" | "bad"; testID?: string }) {
  const theme = useTheme();
  const color = tone === "good" ? theme.status.ready : tone === "warn" ? theme.status.pickup : tone === "bad" ? theme.status.dirty : theme.textSecondary;
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: theme.surfaceSubtle }]} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: theme.textPrimary }]}>
        {text}
      </Text>
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

export function toneOf(status: string): "neutral" | "good" | "warn" | "bad" {
  if (status === "approved") return "good";
  if (status === "denied" || status === "declined") return "bad";
  if (status === "pending" || status === "proposed" || status === "accepted") return "warn";
  return "neutral";
}

export function Fact({ label, children, testID }: { label: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      {typeof children === "string" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factValue, { color: theme.textPrimary }]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
      {children.toUpperCase()}
    </Text>
  );
}

/** A failure in words. A write that may have landed says so ("check before trying again"). */
export function FailureNotice({ failure, t, testID }: { failure: RequestFailure; t: Translate; testID: string }) {
  return <SheetNotice tone="error" text={failureKeyText(failure.key, t)} testID={testID} />;
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14 },
  timeBlock: { flex: 1, gap: 4, minWidth: 140 },
  timeLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  timeValue: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700" },
  step: { width: MIN_TARGET, height: MIN_TARGET, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: "800" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fact: { gap: 2 },
  factLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  factValue: { fontSize: 15, lineHeight: 21 },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
});
