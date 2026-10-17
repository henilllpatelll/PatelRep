import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { classifySendFailure, draftLength, type SendFailureKind } from "@/lib/housekeeping/supervisorComms";
import { useTheme } from "@/lib/theme/useTheme";

/* The pieces the four Phase 4 drawers share, so a note, a team message and a direct message
   behave the same: one request at a time, a draft that survives a failure, honest error words. */

export type SubmitResult<T> = { ok: true; value: T } | { ok: false; kind: SendFailureKind };

/**
 * One request at a time. A second press while one is in flight returns `null` immediately and sends nothing,
 * even if the first press has not re-rendered the button yet (the guard is a ref, not state).
 */
export function useSubmitGuard() {
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const run = useCallback(async <T,>(request: () => Promise<T>): Promise<SubmitResult<T> | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      return { ok: true, value: await request() };
    } catch (error) {
      return { ok: false, kind: classifySendFailure(error) };
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, run };
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  max: number;
  /** "{{count}} / {{max}}" */
  counterText: string;
  minHeight?: number;
  editable?: boolean;
  autoFocus?: boolean;
  testID: string;
}

/** A labelled multiline field with a live character count. The count appears only near the limit. */
export function DraftField({ label, value, onChangeText, placeholder, max, counterText, minHeight = 120, editable = true, autoFocus = false, testID }: FieldProps) {
  const theme = useTheme();
  const length = draftLength(value);
  const nearLimit = length >= max * 0.85;
  return (
    <View style={styles.field}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
        {label}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        style={[styles.input, { minHeight, backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline
        maxLength={max}
        editable={editable}
        autoFocus={autoFocus}
        textAlignVertical="top"
      />
      {nearLimit ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.counter, { color: length >= max ? theme.status.dirty : theme.textMuted }]}
          testID={`${testID}-count`}
        >
          {counterText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 21,
  },
  counter: { fontSize: 12, fontWeight: "600", textAlign: "right" },
});
