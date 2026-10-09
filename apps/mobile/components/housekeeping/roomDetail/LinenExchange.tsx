import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { LINEN_MAX, clampLinen, type LinenState } from "@/lib/housekeeping/cleanSession";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";

type Counts = { dirtyOut: number; cleanIn: number };

function Stepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.stepperRow}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stepperLabel, { color: theme.textPrimary }]}>
        {label}
      </Text>
      <View style={styles.controls}>
        <Pressable
          style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, (disabled || value <= 0) && styles.dim]}
          onPress={() => onChange(clampLinen(value - 1))}
          disabled={disabled || value <= 0}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label} −`}
          accessibilityState={{ disabled: disabled || value <= 0 }}
        >
          <Text style={[styles.stepGlyph, { color: theme.textPrimary }]}>−</Text>
        </Pressable>
        <Text
          style={[styles.count, { color: theme.textPrimary }]}
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: LINEN_MAX, now: value }}
          testID={`linen-count-${label}`}
        >
          {value}
        </Text>
        <Pressable
          style={[styles.stepBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, (disabled || value >= LINEN_MAX) && styles.dim]}
          onPress={() => onChange(clampLinen(value + 1))}
          disabled={disabled || value >= LINEN_MAX}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${label} +`}
          accessibilityState={{ disabled: disabled || value >= LINEN_MAX }}
        >
          <Text style={[styles.stepGlyph, { color: theme.textPrimary }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Entry in the cleaning view: what is recorded and whether it has reached the server. */
export function LinenExchangeRow({ linen, onOpen }: { linen: LinenState | undefined; onOpen: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const summary = linen ? t("rooms.work.linen.summary", { out: linen.dirtyOut, in: linen.cleanIn }) : t("rooms.work.linen.notRecorded");
  const status = !linen ? null : linen.failed ? "failed" : linen.pending ? "pending" : "saved";
  const statusColor = status === "failed" ? theme.status.dirty : status === "pending" ? theme.status.pickup : theme.status.ready;

  return (
    <Pressable
      onPress={onOpen}
      style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${t("rooms.work.linen.title")}. ${summary}${status ? `. ${t(`rooms.work.linen.status.${status}`)}` : ""}`}
      testID="linen-row"
    >
      <Ionicons name="layers-outline" size={20} color={theme.textSecondary} />
      <View style={styles.rowCopy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
          {t("rooms.work.linen.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSummary, { color: theme.textSecondary }]}>
          {summary}
        </Text>
      </View>
      {status ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowStatus, { color: statusColor }]} testID="linen-status">
          {t(`rooms.work.linen.status.${status}`)}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

interface SheetProps {
  visible: boolean;
  roomNumber: string;
  linen: LinenState | undefined;
  /** The clean is finished or waiting on the server; counts can no longer change. */
  locked: boolean;
  onSave: (counts: Counts) => Promise<void>;
  onClose: () => void;
}

/** Dirty linens removed / fresh linens placed for this clean. Whole numbers, 0–99. */
export function LinenExchangeSheet({ visible, roomNumber, linen, locked, onSave, onClose }: SheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [draft, setDraft] = useState<Counts>({ dirtyOut: 0, cleanIn: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setDraft({ dirtyOut: linen?.dirtyOut ?? 0, cleanIn: linen?.cleanIn ?? 0 });
    // Re-seed only when the sheet opens, never while the attendant is typing.
  }, [visible]);

  const unchanged = Boolean(linen) && !linen?.failed && !linen?.pending && linen?.dirtyOut === draft.dirtyOut && linen?.cleanIn === draft.cleanIn;

  async function save() {
    if (saving || locked) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("rooms.work.linen.sheetTitle", { room: roomNumber })}
      onClose={onClose}
      testID="linen-sheet"
      footer={
        <Button
          label={t("rooms.work.linen.save")}
          onPress={() => void save()}
          loading={saving}
          disabled={locked || unchanged}
          size="lg"
          testID="linen-save"
        />
      }
    >
      <Stepper
        label={t("rooms.detail.linen.dirtyOut")}
        value={draft.dirtyOut}
        onChange={(dirtyOut) => setDraft((d) => ({ ...d, dirtyOut }))}
        disabled={locked}
      />
      <Stepper
        label={t("rooms.detail.linen.cleanIn")}
        value={draft.cleanIn}
        onChange={(cleanIn) => setDraft((d) => ({ ...d, cleanIn }))}
        disabled={locked}
      />
      {linen?.failed ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.dirty }]}>
          {t("rooms.work.linen.failedHelp")}
        </Text>
      ) : linen?.pending ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.pickup }]}>
          {t("rooms.work.linen.pendingHelp")}
        </Text>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
          {locked ? t("rooms.work.linen.lockedHelp") : t("rooms.work.linen.help")}
        </Text>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 60, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  rowCopy: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 15, fontWeight: "800" },
  rowSummary: { fontSize: 13 },
  rowStatus: { fontSize: 12, fontWeight: "800" },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 56 },
  stepperLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
  controls: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepGlyph: { fontSize: 24, fontWeight: "700", lineHeight: 28 },
  dim: { opacity: 0.4 },
  count: { fontFamily: monoFont, fontSize: 22, fontWeight: "800", minWidth: 36, textAlign: "center" },
  note: { fontSize: 13, lineHeight: 18 },
});
