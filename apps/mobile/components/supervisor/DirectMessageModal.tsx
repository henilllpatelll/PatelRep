import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { DraftField, useSubmitGuard } from "@/components/supervisor/commsParts";
import { Button } from "@/components/ui/Button";
import { sendDirectMessage } from "@/lib/api/housekeepingSupervisor";
import { MESSAGE_MAX, isMeaningfulDraft, type SendFailureKind } from "@/lib/housekeeping/supervisorComms";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

interface Props {
  visible: boolean;
  recipientId: string | null;
  recipientName: string | null;
  /** Role · shift status · workload, already worded; null when nothing verified is known. */
  recipientMeta?: string | null;
  isOnline: boolean;
  onClose: () => void;
}

/**
 * Message one staff member (POST /notifications/direct): an inbox notification, not a chat.
 * The composer is keyed by the recipient, so changing who it is for always starts from an empty draft
 * and one person's words can never be sent to another.
 */
export default function DirectMessageModal({ visible, recipientId, recipientName, recipientMeta, isOnline, onClose }: Props) {
  if (!visible) return null;
  return (
    <DirectMessageSheet
      key={recipientId ?? "none"}
      recipientId={recipientId}
      recipientName={recipientName}
      recipientMeta={recipientMeta ?? null}
      isOnline={isOnline}
      onClose={onClose}
    />
  );
}

function DirectMessageSheet({ recipientId, recipientName, recipientMeta, isOnline, onClose }: Omit<Props, "visible">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { busy, run } = useSubmitGuard();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<SendFailureKind | null>(null);

  const dirty = isMeaningfulDraft(text);
  const requestClose = useDiscardGuard({ dirty, busy, onClose });
  const hasRecipient = Boolean(recipientId);
  const canSend = hasRecipient && dirty && isOnline && !busy;
  const name = recipientName?.trim() || null;

  const send = useCallback(async () => {
    if (!recipientId || !dirty || !isOnline) return;
    setFailure(null);
    const result = await run(() => sendDirectMessage(recipientId, text));
    if (!result) return; // a second tap while the first is in flight
    if (result.ok) {
      toast.success(t("supervisorComms.dm.sent", { name: name ?? "" }).trim());
      onClose();
    } else {
      setFailure(result.kind);
    }
  }, [recipientId, dirty, isOnline, run, text, toast, t, name, onClose]);

  return (
    <BottomSheet
      visible
      title={t("supervisorComms.dm.title")}
      onClose={requestClose}
      grabber
      testID="dm-sheet"
      footer={
        <View style={styles.footer}>
          <Button label={t("common.cancel")} onPress={requestClose} variant="secondary" disabled={busy} style={styles.cancel} testID="dm-cancel" />
          <Button
            label={t("supervisorComms.dm.send")}
            onPress={send}
            loading={busy}
            disabled={!canSend}
            icon="send-outline"
            style={styles.primary}
            testID="dm-send"
          />
        </View>
      }
    >
      <View style={styles.body}>
        {hasRecipient ? (
          <View
            style={[styles.recipient, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
            testID="dm-recipient"
            accessible
            accessibilityLabel={[t("supervisorComms.dm.to"), name, recipientMeta].filter(Boolean).join(". ")}
          >
            <Avatar name={name ?? "?"} size={42} />
            <View style={styles.recipientText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
                {t("supervisorComms.dm.to")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={1} testID="dm-recipient-name">
                {name ?? "—"}
              </Text>
              {recipientMeta ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="dm-recipient-meta">
                  {recipientMeta}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <SheetNotice text={t("supervisorComms.dm.noRecipient")} tone="warn" testID="dm-no-recipient" />
        )}

        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("supervisorComms.dm.hint")}
        </Text>

        <DraftField
          testID="dm-input"
          label={t("supervisorComms.dm.label")}
          value={text}
          onChangeText={setText}
          placeholder={t("supervisorComms.dm.placeholder")}
          max={MESSAGE_MAX}
          counterText={t("supervisorComms.count", { count: text.trim().length, max: MESSAGE_MAX })}
          minHeight={110}
          editable={hasRecipient && !busy}
          autoFocus={hasRecipient}
        />

        {!isOnline ? <SheetNotice text={t("supervisorComms.offline")} tone="warn" testID="dm-offline" /> : null}
        {failure ? <SheetNotice text={t(`supervisorComms.errors.${failure}`)} tone="error" testID="dm-error" /> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  recipient: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderRadius: R.md },
  recipientText: { flex: 1, gap: 1 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  name: { fontSize: 17, fontWeight: "800" },
  meta: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 13, lineHeight: 18 },
  footer: { flexDirection: "row", gap: 10 },
  cancel: { flex: 1 },
  primary: { flex: 2 },
});
