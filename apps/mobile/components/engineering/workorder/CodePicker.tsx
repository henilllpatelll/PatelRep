import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { listRepairCodes } from "@/lib/api/workOrders";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import { isOtherCode, type RepairCode } from "@/lib/engineering/repairWorkspace";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { FieldLabel, InlineError, LineInput } from "./sheetKit";

export interface RepairCodeState {
  codes: RepairCode[];
  loading: boolean;
  failure: LoadFailure | null;
  retry: () => void;
}

/** Loads the trade's repair codes from the API the first time a sheet that needs them opens; they are never hardcoded. */
export function useRepairCodes(category: string | undefined, enabled: boolean): RepairCodeState {
  const [codes, setCodes] = useState<RepairCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const loadedFor = useRef<string | null>(null);
  const token = useRef(0);

  const load = useCallback(() => {
    const mine = ++token.current;
    const ctl = new AbortController();
    setLoading(true);
    setFailure(null);
    listRepairCodes(category, ctl.signal).then(
      (rows) => {
        if (token.current !== mine) return;
        loadedFor.current = category ?? "";
        setCodes(rows);
        setLoading(false);
      },
      (err) => {
        if (token.current !== mine) return;
        setFailure(classifyLoadFailure(err));
        setLoading(false);
      }
    );
    return () => ctl.abort();
  }, [category]);

  useEffect(() => {
    if (!enabled || loadedFor.current === (category ?? "")) return;
    return load();
  }, [enabled, category, load]);

  return { codes, loading, failure, retry: load };
}

interface Props {
  type: RepairCode["code_type"];
  label: string;
  state: RepairCodeState;
  selectedId: string | null;
  otherText: string;
  onSelect: (id: string | null) => void;
  onOtherText: (text: string) => void;
  required?: boolean;
  /** "other" selected without a description. */
  otherInvalid?: boolean;
  invalid?: boolean;
  testID: string;
  disabled?: boolean;
}

/** One code type (problem, cause or resolution): a collapsed summary that opens into the API's list. */
export function CodePicker({ type, label, state, selectedId, otherText, onSelect, onOtherText, required, otherInvalid, invalid, testID, disabled }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const options = state.codes.filter((c) => c.code_type === type);
  const selected = options.find((c) => c.id === selectedId);
  const summary = selected?.label ?? (otherText.trim() && !selectedId ? otherText.trim() : t("workOrders.repair.codes.choose"));

  return (
    <View style={styles.block}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        accessibilityLabel={`${label}: ${summary}`}
        testID={`${testID}-toggle`}
        style={[styles.summary, { backgroundColor: theme.surfaceSubtle, borderColor: invalid ? theme.status.dirty : theme.border, opacity: disabled ? 0.5 : 1 }]}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summaryText, { color: selected || otherText ? theme.textPrimary : theme.textDisabled }]}>
          {summary}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={theme.textMuted} />
      </Pressable>

      {open ? (
        <View style={[styles.list, { borderColor: theme.borderSubtle }]}>
          {state.loading ? (
            <ActivityIndicator style={styles.pad} color={theme.primaryAction} />
          ) : state.failure ? (
            <View style={styles.pad}>
              <InlineError>{t(state.failure === "forbidden" ? "workOrders.repair.codes.forbidden" : "workOrders.repair.codes.failed")}</InlineError>
              <Pressable onPress={state.retry} accessibilityRole="button" style={styles.retry}>
                <Text style={{ color: theme.primaryAction, fontWeight: "700" }}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : options.length === 0 ? (
            <Text style={[styles.pad, { color: theme.textMuted }]}>{t("workOrders.repair.codes.none")}</Text>
          ) : (
            options.map((code) => {
              const isSelected = code.id === selectedId;
              return (
                <Pressable
                  key={code.id}
                  onPress={() => {
                    onSelect(isSelected ? null : code.id);
                    if (!isOtherCode(code)) setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  testID={`${testID}-${code.code}`}
                  style={[styles.option, { borderColor: theme.borderSubtle }]}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.optionText, { color: isSelected ? theme.primaryAction : theme.textPrimary }]}>
                    {code.label}
                  </Text>
                  {isSelected ? <Ionicons name="checkmark" size={18} color={theme.primaryAction} /> : null}
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}

      {isOtherCode(selected) ? (
        <>
          <LineInput
            value={otherText}
            onChangeText={onOtherText}
            placeholder={t("workOrders.repair.codes.describeOther")}
            invalid={otherInvalid}
            editable={!disabled}
            accessibilityLabel={t("workOrders.repair.codes.describeOther")}
            testID={`${testID}-other`}
          />
          {otherInvalid ? <InlineError>{t("workOrders.repair.codes.otherRequired")}</InlineError> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  summary: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  summaryText: { flex: 1, fontSize: 14.5 },
  list: { borderWidth: 1, borderRadius: 11, overflow: "hidden" },
  option: { minHeight: 46, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  optionText: { flex: 1, fontSize: 14.5 },
  pad: { padding: 12, gap: 6 },
  retry: { minHeight: 44, justifyContent: "center" },
});
