import { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/useAssistantConversation";
import type { TextInputInstance } from "react-native";

const MAX_FONT_SCALE = 1.6;
const COUNTER_FROM = Math.floor(MAX_MESSAGE_CHARS * 0.8);

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Stop waiting for the answer to the question in flight. */
  onCancel: () => void;
  sending: boolean;
  online: boolean;
  /** Present when voice input exists on this device. */
  onMic?: () => void;
  placeholder: string;
  /** Changes whenever something asks the box to take focus. */
  focusToken?: number;
  testIDPrefix: string;
  palette?: Palette;
}

/** The one message box for the compact sheet and the full chat: type, speak, send, or cancel a pending question. */
export function AssistantComposer({ value, onChangeText, onSend, onCancel, sending, online, onMic, placeholder, focusToken = 0, testIDPrefix, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const inputRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  const canSend = online && !sending && value.trim().length > 0;

  return (
    <View>
      {!online ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.offline} accessibilityLiveRegion="polite" testID={`${testIDPrefix}-offline`}>
          {t("copilot.notice.offline")}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          value={value}
          onChangeText={onChangeText}
          editable={!sending}
          multiline
          maxLength={MAX_MESSAGE_CHARS}
          accessibilityLabel={placeholder}
          testID={`${testIDPrefix}-input`}
        />
        {onMic && !sending ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("assistant.voice.start")}
            onPress={onMic}
            style={styles.iconButton}
            testID={`${testIDPrefix}-mic`}
          >
            <Ionicons name="mic-outline" size={22} color={theme.ai.primary} />
          </Pressable>
        ) : null}
        {sending ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("assistant.cancelSend")}
            onPress={onCancel}
            style={[styles.send, styles.cancel]}
            testID={`${testIDPrefix}-cancel`}
          >
            <Ionicons name="stop" size={18} color={theme.textPrimary} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("copilot.card.send")}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={onSend}
            style={[styles.send, !canSend && styles.disabled]}
            testID={`${testIDPrefix}-send`}
          >
            <Ionicons name="arrow-up" size={20} color={theme.onPrimary} />
          </Pressable>
        )}
      </View>
      {value.length >= COUNTER_FROM ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.counter}>
          {value.length}/{MAX_MESSAGE_CHARS}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    input: {
      flex: 1,
      minHeight: 48,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 16,
      color: theme.textPrimary,
      backgroundColor: theme.surfaceElevated,
    },
    iconButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.ai.line, backgroundColor: theme.ai.soft },
    send: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: theme.primaryAction },
    cancel: { backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border },
    disabled: { opacity: 0.4 },
    offline: { fontSize: 12.5, lineHeight: 18, color: theme.textMuted, marginBottom: 6 },
    counter: { alignSelf: "flex-end", fontSize: 11, color: theme.textMuted, marginTop: 2 },
  });
