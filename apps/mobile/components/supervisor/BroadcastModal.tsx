import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { DraftField, useSubmitGuard } from "@/components/supervisor/commsParts";
import { Button } from "@/components/ui/Button";
import { sendTeamBroadcast } from "@/lib/api/housekeepingSupervisor";
import { MESSAGE_MAX, isMeaningfulDraft, type SendFailureKind } from "@/lib/housekeeping/supervisorComms";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

const TEMPLATE_KEYS = ["assignments", "priority", "shift", "checkOut"] as const;

interface Props {
  visible: boolean;
  isOnline: boolean;
  onClose: () => void;
}

/**
 * Message team: an inbox broadcast to every ACTIVE housekeeper account in this hotel
 * (POST /notifications/broadcast, roles = ["housekeeper"]). It never creates a task, and it does not
 * claim to know who is clocked in, who got a push or who read it: the only number it ever shows is the
 * count the server reports.
 */
export default function BroadcastModal({ visible, isOnline, onClose }: Props) {
  if (!visible) return null;
  return <BroadcastSheet isOnline={isOnline} onClose={onClose} />;
}

function BroadcastSheet({ isOnline, onClose }: Omit<Props, "visible">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { busy, run } = useSubmitGuard();
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<SendFailureKind | null>(null);
  const [nobody, setNobody] = useState(false);

  const dirty = isMeaningfulDraft(message);
  const requestClose = useDiscardGuard({ dirty, busy, onClose });
  const canSend = dirty && isOnline && !busy;

  const edit = useCallback((value: string) => {
    setMessage(value);
    setNobody(false);
  }, []);

  const send = useCallback(async () => {
    if (!dirty || !isOnline) return;
    setFailure(null);
    setNobody(false);
    const result = await run(() => sendTeamBroadcast(message));
    if (!result) return; // a second tap while the first is in flight
    if (!result.ok) {
      setFailure(result.kind);
      return;
    }
    const outcome = result.value;
    if (outcome.kind === "nobody") {
      // Nothing was written for anyone: not a delivery. Keep the draft and say so.
      setNobody(true);
      return;
    }
    toast.success(
      outcome.kind === "delivered"
        ? t("supervisorComms.team.delivered", { count: outcome.count })
        : t("supervisorComms.team.deliveredUnknown"),
    );
    onClose();
  }, [dirty, isOnline, run, message, toast, t, onClose]);

  return (
    <BottomSheet
      visible
      title={t("supervisorComms.team.title")}
      onClose={requestClose}
      grabber
      testID="broadcast-sheet"
      footer={
        <View style={styles.footer}>
          <Button
            label={t("common.cancel")}
            onPress={requestClose}
            variant="secondary"
            disabled={busy}
            style={styles.cancel}
            testID="broadcast-cancel"
          />
          <Button
            label={t("supervisorComms.team.send")}
            onPress={send}
            loading={busy}
            disabled={!canSend}
            icon="megaphone-outline"
            style={styles.primary}
            testID="broadcast-send"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <View style={[styles.audience, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} testID="broadcast-audience">
          <Ionicons name="megaphone-outline" size={20} color={theme.status.pickup} />
          <View style={styles.audienceText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
              {t("supervisorComms.team.audienceLabel")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.audienceTitle, { color: theme.textPrimary }]}>
              {t("supervisorComms.team.audience")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
              {t("supervisorComms.team.audienceHint")}
            </Text>
          </View>
        </View>

        <View style={styles.templates}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
            {t("supervisorComms.team.templatesLabel")}
          </Text>
          {TEMPLATE_KEYS.map((key) => {
            const text = t(`supervisorComms.team.templates.${key}`);
            const selected = message === text;
            return (
              <Pressable
                key={key}
                onPress={() => edit(text)}
                disabled={busy}
                testID={`broadcast-template-${key}`}
                accessibilityRole="button"
                accessibilityLabel={text}
                accessibilityState={{ selected, disabled: busy }}
                style={({ pressed }) => [
                  styles.template,
                  { backgroundColor: selected ? theme.status.pickupSoft : theme.surfaceSubtle, borderColor: selected ? theme.status.pickupLine : theme.border },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.templateText, { color: selected ? theme.status.pickup : theme.textPrimary }]}>
                  {text}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <DraftField
          testID="broadcast-input"
          label={t("supervisorComms.team.label")}
          value={message}
          onChangeText={edit}
          placeholder={t("supervisorComms.team.placeholder")}
          max={MESSAGE_MAX}
          counterText={t("supervisorComms.count", { count: message.trim().length, max: MESSAGE_MAX })}
          minHeight={96}
          editable={!busy}
        />

        {nobody ? <SheetNotice text={t("supervisorComms.team.nobody")} tone="warn" testID="broadcast-nobody" /> : null}
        {!isOnline ? <SheetNotice text={t("supervisorComms.offline")} tone="warn" testID="broadcast-offline" /> : null}
        {failure ? <SheetNotice text={t(`supervisorComms.errors.${failure}`)} tone="error" testID="broadcast-error" /> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  audience: { flexDirection: "row", gap: 12, padding: 12, borderWidth: 1, borderRadius: R.md, alignItems: "flex-start" },
  audienceText: { flex: 1, gap: 2 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  audienceTitle: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 13, lineHeight: 18 },
  templates: { gap: 8 },
  template: { minHeight: MIN_TARGET, justifyContent: "center", borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10 },
  templateText: { fontSize: 14, fontWeight: "600" },
  footer: { flexDirection: "row", gap: 10 },
  cancel: { flex: 1 },
  primary: { flex: 2 },
});
