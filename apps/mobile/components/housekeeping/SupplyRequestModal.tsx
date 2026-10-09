import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/Button";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { newSessionId } from "@/lib/housekeeping/cleanSession";
import {
  SUPPLY_CATALOG,
  SUPPLY_MAX_QTY,
  SUPPLY_NOTE_MAX,
  clampQty,
  submitSupplyRequest,
  totalRequested,
  validateSupply,
  type Quantities,
} from "@/lib/housekeeping/supplyRequest";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { BottomSheet, MAX_FONT_SCALE } from "./roomDetail/BottomSheet";
import { FieldError, FieldLabel, StatusText, TextArea } from "./roomDetail/FormBits";

interface Props {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

function QuantityRow({ label, value, onChange, disabled }: { label: string; value: number; onChange: (next: number) => void; disabled: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID={`supply-row-${label}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
        {label}
      </Text>
      <View style={styles.controls}>
        <Pressable
          onPress={() => onChange(clampQty(value - 1))}
          disabled={disabled || value <= 0}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("supplies.decrease", { item: label })}
          accessibilityState={{ disabled: disabled || value <= 0 }}
          style={[styles.step, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, (disabled || value <= 0) && styles.dim]}
        >
          <Text style={[styles.glyph, { color: theme.textPrimary }]}>−</Text>
        </Pressable>
        <Text
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: SUPPLY_MAX_QTY, now: value }}
          style={[styles.count, { color: theme.textPrimary }]}
        >
          {value}
        </Text>
        <Pressable
          onPress={() => onChange(clampQty(value + 1))}
          disabled={disabled || value >= SUPPLY_MAX_QTY}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("supplies.increase", { item: label })}
          accessibilityState={{ disabled: disabled || value >= SUPPLY_MAX_QTY }}
          style={[styles.step, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, (disabled || value >= SUPPLY_MAX_QTY) && styles.dim]}
        >
          <Text style={[styles.glyph, { color: theme.textPrimary }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Supply request with quantities. It posts the existing housekeeping task, so the
 * web tasks board shows it unchanged; success is only claimed once the server
 * answered. Online only: a request "sent" from a device with no signal would not
 * reach the supervisor. Selections survive a failed send, and a retry after a lost
 * answer first checks for the request it may already have made.
 */
export default function SupplyRequestModal({ visible, roomId, roomNumber, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isOnline = useAppStore((state) => state.isOnline);

  const [quantities, setQuantities] = useState<Quantities>({});
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const requestId = useRef(newSessionId());
  const mayHaveBeenSent = useRef(false);
  const busyRef = useRef(false);

  const total = totalRequested(quantities);
  const dirty = total > 0 || note.trim() !== "";

  function reset() {
    setQuantities({});
    setNote("");
    setFailure(null);
    setFieldError(null);
    requestId.current = newSessionId();
    mayHaveBeenSent.current = false;
  }

  const requestClose = useDiscardGuard({ dirty, busy: sending, onClose, onDiscard: reset });

  /** Editing a request that may already have gone out makes it a different request. */
  function editedAfterUnsure() {
    if (!mayHaveBeenSent.current) return;
    requestId.current = newSessionId();
    mayHaveBeenSent.current = false;
  }

  function setQty(key: string, value: number) {
    editedAfterUnsure();
    setQuantities((current) => ({ ...current, [key]: clampQty(value) }));
    setFieldError(null);
    setFailure(null);
  }

  async function submit() {
    if (busyRef.current) return;
    const check = validateSupply(quantities, note);
    if (!check.ok) {
      setFieldError(t(check.code === "empty" ? "supplies.errors.empty" : "supplies.errors.noteTooLong"));
      return;
    }
    busyRef.current = true;
    setSending(true);
    setFailure(null);
    try {
      const result = await submitSupplyRequest({ roomId, roomNumber, quantities, note, requestId: requestId.current }, mayHaveBeenSent.current);
      if (result.outcome === "failed") {
        mayHaveBeenSent.current = result.ambiguous;
        setFailure(t(result.ambiguous ? "supplies.failedUnsure" : "supplies.failed"));
        return;
      }
      toast.success(t("supplies.sent"));
      reset();
      onClose();
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("supplies.sheetTitle", { room: roomNumber })}
      onClose={requestClose}
      testID="supplies-sheet"
      footer={
        <>
          {!isOnline ? <StatusText tone="warn" message={t("supplies.needsConnection")} testID="supplies-offline" /> : null}
          <Button
            label={t("supplies.send")}
            icon="send"
            onPress={() => void submit()}
            loading={sending}
            disabled={sending || !isOnline || (total === 0 && !note.trim())}
            size="lg"
            testID="supplies-send"
          />
        </>
      }
    >
      <View accessibilityRole="list" style={styles.list}>
        {SUPPLY_CATALOG.map((item) => (
          <QuantityRow key={item.key} label={t(item.labelKey)} value={clampQty(quantities[item.key] ?? 0)} onChange={(next) => setQty(item.key, next)} disabled={sending} />
        ))}
      </View>

      <FieldLabel>{t("supplies.otherDetails")}</FieldLabel>
      <TextArea
        label={t("supplies.otherDetails")}
        value={note}
        onChangeText={(next) => {
          editedAfterUnsure();
          setNote(next);
          setFieldError(null);
          setFailure(null);
        }}
        max={SUPPLY_NOTE_MAX}
        placeholder={t("supplies.otherPlaceholder")}
        editable={!sending}
        invalid={Boolean(fieldError)}
        testID="supplies-note"
      />
      <FieldError message={fieldError} testID="supplies-error" />

      <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.total, { color: theme.textPrimary }]} testID="supplies-total">
        {t("supplies.total", { count: total })}
      </Text>
      {failure ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.failure, { color: theme.status.dirty }]} testID="supplies-failure">
          {failure}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
  controls: { flexDirection: "row", alignItems: "center", gap: 14 },
  step: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 24, fontWeight: "700", lineHeight: 28 },
  count: { fontFamily: monoFont, fontSize: 22, fontWeight: "800", minWidth: 36, textAlign: "center" },
  dim: { opacity: 0.4 },
  total: { fontSize: 15, fontWeight: "800" },
  failure: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
});
