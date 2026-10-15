import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { getSupportContacts, type SupportContacts } from "@/lib/api/support";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

/** Only dial something that looks like a phone number; never build a link from arbitrary text. */
export function dialableNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? cleaned : null;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: SupportContacts };

/**
 * Who to ask at this hotel. Names and job titles come from the hotel's own staff list, and the only phone shown is the
 * hotel's business line, if the hotel added one. Nothing here is hardcoded, and nobody's personal number or email is used.
 */
export function ContactSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [callFailed, setCallFailed] = useState(false);

  const load = useCallback(() => {
    let live = true;
    setState({ kind: "loading" });
    getSupportContacts()
      .then((data) => live && setState({ kind: "ready", data }))
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => (visible ? load() : undefined), [visible, load]);
  useEffect(() => {
    if (!visible) setCallFailed(false);
  }, [visible]);

  const roleLabel = (role: string) => {
    const key = `staff.roles.${role}`;
    const text = t(key);
    return text === key ? role.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : text;
  };
  const phone = state.kind === "ready" ? dialableNumber(state.data.hotel.phone) : null;
  const hasContacts = state.kind === "ready" && (state.data.contacts.length > 0 || phone !== null);

  return (
    <BottomSheet
      visible={visible}
      title={t("help.contact.title")}
      onClose={onClose}
      grabber
      testID="contact-sheet"
      footer={<Button label={t("common.close")} variant="secondary" onPress={onClose} testID="contact-close" />}
    >
      {state.kind === "loading" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("common.loading")}
        </Text>
      ) : state.kind === "error" ? (
        <View style={styles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.body, { color: theme.status.dirty }]} testID="contact-error">
            {t("help.contact.loadError")}
          </Text>
          <Button label={t("help.contact.retry")} variant="secondary" size="sm" onPress={() => void load()} testID="contact-retry" />
        </View>
      ) : hasContacts ? (
        <View style={styles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("help.contact.intro")}
          </Text>
          {state.data.contacts.map((person) => (
            <View key={`${person.role}-${person.name}`} style={[styles.card, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]} testID="contact-person">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                {person.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textMuted }]}>
                {roleLabel(person.role)}
              </Text>
            </View>
          ))}
          {phone ? (
            <Button
              label={t("help.contact.call", { phone: state.kind === "ready" ? state.data.hotel.phone : "" })}
              icon="call"
              onPress={() => {
                setCallFailed(false);
                void Linking.openURL(`tel:${phone}`).catch(() => setCallFailed(true));
              }}
              accessibilityLabel={`${t("help.contact.hotelLine")}: ${state.kind === "ready" ? state.data.hotel.phone : ""}`}
              testID="contact-call"
            />
          ) : null}
          {callFailed ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.body, { color: theme.status.dirty }]} testID="contact-call-error">
              {t("help.contact.callFailed")}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.stack} testID="contact-none">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {t("help.contact.none")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("help.contact.noneHint")}
          </Text>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  body: { fontSize: 14, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  name: { fontSize: 15, fontWeight: "700" },
  role: { fontSize: 13 },
});
