import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";

const KNOCK_STEPS = [
  "rooms.detail.knock.steps.step1",
  "rooms.detail.knock.steps.step2",
  "rooms.detail.knock.steps.step3",
  "rooms.detail.knock.steps.step4",
  "rooms.detail.knock.steps.step5",
] as const;

const MAX_FONT_SCALE = 1.6;

interface Props {
  visible: boolean;
  roomNumber: string;
  /** Plain-language status, e.g. "Occupied / Stayover". */
  statusLabel?: string | null;
  /**
   * A hard restriction (DND, declined service, come-back-later) is active right
   * now. The protocol can never approve entry in that case: it shows a stop notice
   * and the confirm button stays off.
   */
  restricted?: boolean;
  /** The protocol was completed and acknowledged — the screen then re-checks the server before starting. */
  onConfirm: () => void;
  /** Leave without entering; nothing is started. */
  onCancel: () => void;
  /** Can't enter (guest inside, return later, locked door, declined): opens the report options. */
  onCannotEnter: () => void;
}

/**
 * Knock-and-announce, step by step. Every step is acknowledged by the attendant —
 * nothing is pre-ticked and nothing advances on its own. Closing it (including the
 * Android back button) only cancels; it never counts as having knocked.
 */
export default function KnockModal({ visible, roomNumber, statusLabel, restricted = false, onConfirm, onCancel, onCannotEnter }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [done, setDone] = useState<boolean[]>(() => KNOCK_STEPS.map(() => false));

  // Every opening starts from scratch: yesterday's acknowledgement never carries over.
  useEffect(() => {
    if (visible) setDone(KNOCK_STEPS.map(() => false));
  }, [visible]);

  const complete = done.every(Boolean);
  const canConfirm = complete && !restricted;

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={onCancel}>
      <ScrollView
        style={{ backgroundColor: theme.shell.bg }}
        contentContainerStyle={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        testID="knock-modal"
      >
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
            <Ionicons name="hand-left-outline" size={36} color={theme.status.pickup} />
          </View>
          <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.shell.ink }]}>
            {t("rooms.work.knock.title")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: theme.shell.ink2 }]} testID="knock-room-line">
            {[t("rooms.work.knock.roomLine", { room: roomNumber }), statusLabel].filter(Boolean).join(" · ")}
          </Text>
        </View>

        {restricted ? (
          <View
            accessibilityRole="alert"
            testID="knock-restricted"
            style={[styles.stop, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
          >
            <Ionicons name="hand-right" size={20} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stopText, { color: theme.status.dirty }]}>
              {t("rooms.work.knock.restricted")}
            </Text>
          </View>
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.shell.ink2 }]}>
            {t("rooms.work.knock.hint")}
          </Text>
        )}

        <View style={styles.steps}>
          {KNOCK_STEPS.map((key, index) => {
            const checked = done[index];
            return (
              <Pressable
                key={key}
                onPress={() => setDone((prev) => prev.map((value, i) => (i === index ? !value : value)))}
                disabled={restricted}
                accessibilityRole="checkbox"
                accessibilityLabel={t("rooms.work.knock.stepA11y", { n: index + 1, text: t(key) })}
                accessibilityState={{ checked, disabled: restricted }}
                style={[
                  styles.step,
                  { backgroundColor: theme.shell.raised, borderColor: checked ? theme.status.ready : theme.shell.line },
                ]}
                testID={`knock-step-${index + 1}`}
              >
                <View
                  style={[
                    styles.box,
                    { borderColor: checked ? theme.status.ready : theme.shell.ink3 },
                    checked && { backgroundColor: theme.status.ready },
                  ]}
                >
                  {checked ? <Ionicons name="checkmark" size={16} color={theme.onPrimary} /> : null}
                </View>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stepText, { color: theme.shell.ink }]}>
                  <Text style={styles.stepNo}>{index + 1}. </Text>
                  {t(key)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actions}>
          <Button
            label={t("rooms.work.knock.cta")}
            onPress={onConfirm}
            icon="checkmark-circle-outline"
            size="lg"
            disabled={!canConfirm}
            testID="knock-confirm"
          />
          {!complete && !restricted ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.shell.ink2 }]} testID="knock-disabled-reason">
              {t("rooms.work.knock.finishSteps")}
            </Text>
          ) : null}
          <Button label={t("rooms.work.knock.cantEnter")} onPress={onCannotEnter} variant="secondary" size="lg" testID="knock-cant-enter" />
          <Button label={t("rooms.work.knock.cancel")} onPress={onCancel} variant="ghost" testID="knock-cancel" />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 24, gap: 20 },
  header: { alignItems: "center", gap: 8 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "900", textAlign: "center", letterSpacing: -0.3 },
  status: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  hint: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  stop: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  stopText: { flex: 1, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  steps: { gap: 10 },
  step: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepText: { flex: 1, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  stepNo: { fontWeight: "900" },
  actions: { gap: 10 },
});
