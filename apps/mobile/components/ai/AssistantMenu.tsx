import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { usePalette, type Palette } from "@/components/ai/palette";
import { useVoiceCapability } from "@/lib/voice/useVoiceCapability";

const MAX_FONT_SCALE = 1.6;

type MenuView = "menu" | "clear" | "voice" | "privacy";

interface Props {
  visible: boolean;
  onClose: () => void;
  hasMessages: boolean;
  onNewConversation: () => void;
  onClearSaved: () => void;
  /** Open the app's own language settings. */
  onChangeLanguage: () => void;
  /** Open AI & voice settings (voice on/off, speech and answer language, saved conversation). */
  onOpenSettings?: () => void;
}

/**
 * The full chat's options. Every row does something that already exists: start over, clear the saved copy, show
 * which language the microphone listens in (it follows the app language) with a way to change it or open the
 * phone's microphone permission, and say plainly what the assistant does with what is said.
 */
export function AssistantMenu({ visible, onClose, hasMessages, onNewConversation, onClearSaved, onChangeLanguage, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const theme = usePalette();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [view, setView] = useState<MenuView>("menu");

  useEffect(() => {
    if (visible) setView("menu");
  }, [visible]);

  const voice = useVoiceCapability();
  const spoken = voice.locale === "es-US" ? t("assistant.menu.spanish") : t("assistant.menu.english");

  const title =
    view === "clear"
      ? t("assistant.menu.clear")
      : view === "voice"
        ? t("assistant.menu.voice")
        : view === "privacy"
          ? t("assistant.menu.privacy")
          : t("assistant.menu.title");

  const row = (key: string, icon: React.ComponentProps<typeof Ionicons>["name"], label: string, onPress: () => void, disabled = false) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, disabled && styles.disabled]}
      testID={`assistant-menu-${key}`}
    >
      <Ionicons name={icon} size={20} color={theme.ai.primary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.rowText}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose} grabber dragToDismiss palette={theme} testID="assistant-menu">
      {view === "menu" ? (
        <View style={styles.list}>
          {row("new", "add-circle-outline", t("assistant.menu.new"), () => {
            onNewConversation();
            onClose();
          }, !hasMessages)}
          {row("clear", "trash-outline", t("assistant.menu.clear"), () => setView("clear"))}
          {row("voice", "mic-outline", t("assistant.menu.voice"), () => setView("voice"))}
          {row("language", "language-outline", t("assistant.menu.language"), () => {
            onClose();
            onChangeLanguage();
          })}
          {onOpenSettings
            ? row("settings", "options-outline", t("assistant.menu.settings"), () => {
                onClose();
                onOpenSettings();
              })
            : null}
          {row("privacy", "shield-checkmark-outline", t("assistant.menu.privacy"), () => setView("privacy"))}
        </View>
      ) : view === "clear" ? (
        <View style={styles.list}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>
            {t("assistant.menu.clearBody")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClearSaved();
              onClose();
            }}
            style={styles.destructive}
            testID="assistant-menu-clear-confirm"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.destructiveText}>
              {t("assistant.menu.clearConfirm")}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setView("menu")} style={styles.ghost}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.ghostText}>
              {t("common.cancel")}
            </Text>
          </Pressable>
        </View>
      ) : view === "voice" ? (
        <View style={styles.list}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body} testID="assistant-menu-voice-language">
            {t("assistant.menu.voiceBody", { language: spoken })}
          </Text>
          {voice.offByChoice ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted} testID="assistant-menu-voice-off">
              {t("assistant.menu.voiceOffByChoice")}
            </Text>
          ) : voice.available ? null : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted}>
              {t("assistant.voice.unavailable")}
            </Text>
          )}
          {row("voice-language", "language-outline", t("assistant.menu.language"), () => {
            onClose();
            onChangeLanguage();
          })}
          {row("voice-settings", "settings-outline", t("assistant.menu.micSettings"), () => void Linking.openSettings())}
          <Pressable accessibilityRole="button" onPress={() => setView("menu")} style={styles.ghost}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.ghostText}>
              {t("common.back")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list} testID="assistant-menu-privacy">
          {(["roleOnly", "aiMarked", "confirmFirst", "audio", "saved"] as const).map((key) => (
            <View key={key} style={styles.bullet}>
              <Ionicons name="checkmark-circle-outline" size={18} color={theme.ai.primary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>
                {t(`assistant.menu.privacyPoints.${key}`)}
              </Text>
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => setView("menu")} style={styles.ghost}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.ghostText}>
              {t("common.back")}
            </Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    list: { gap: 8 },
    row: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: theme.borderSubtle, backgroundColor: theme.surfaceElevated, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
    rowText: { flex: 1, fontSize: 15.5, fontWeight: "700", color: theme.textPrimary },
    body: { flex: 1, fontSize: 15, lineHeight: 22, color: theme.textPrimary },
    muted: { fontSize: 13, lineHeight: 19, color: theme.textMuted },
    bullet: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    destructive: { minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.destructiveAction },
    destructiveText: { color: theme.onDestructive, fontSize: 15.5, fontWeight: "800" },
    ghost: { minHeight: 48, alignItems: "center", justifyContent: "center" },
    ghostText: { fontSize: 15, fontWeight: "600", color: theme.textSecondary },
    disabled: { opacity: 0.45 },
  });
