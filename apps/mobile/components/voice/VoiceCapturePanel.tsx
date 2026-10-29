import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import { useVoiceInput, type VoiceState } from "@/lib/tasks/addTask/useVoiceInput";
import { speechLocale } from "@/lib/voice/locale";
import type { TextInputInstance } from "react-native";

const MAX_FONT_SCALE = 1.6;

interface Props {
  /** "en" / "es"; defaults to the app language. */
  language?: string;
  /** Longest text the destination accepts. */
  maxChars: number;
  /** Start listening as soon as the panel opens (the person just pressed a microphone button). */
  autoStart?: boolean;
  /** The person reviewed the text and chose to use it. Nothing is sent before this. */
  onUse: (text: string) => void;
  onClose: () => void;
  palette?: Palette;
}

const STATUS_KEY: Partial<Record<VoiceState, string>> = {
  idle: "assistant.voice.tapToSpeak",
  requesting: "assistant.voice.requesting",
  listening: "assistant.voice.listening",
  processing: "assistant.voice.processing",
  denied: "assistant.voice.denied",
  nospeech: "assistant.voice.nospeech",
  error: "assistant.voice.error",
};

/**
 * One listening experience for every place the assistant takes speech. It listens with the phone's own
 * speech service in the app's language (English or Spanish), shows what it heard, lets the person fix it,
 * and hands the text back only when they press "Use text". It never sends anything itself, never keeps
 * audio, and degrades to a plain "type instead" message where the native module is missing (Expo Go).
 */
export function VoiceCapturePanel({ language, maxChars, autoStart, onUse, onClose, palette }: Props) {
  const { t, i18n } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const appLanguage = language ?? i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [text, setText] = useState("");
  const inputRef = useRef<TextInputInstance>(null);

  const voice = useVoiceInput({
    language: appLanguage,
    onTranscript: (heard) => setText((current) => `${current.trim() ? `${current.trim()} ` : ""}${heard}`.slice(0, maxChars)),
  });
  const { supported, state, interim, toggle, stop } = voice;

  const started = useRef(false);
  useEffect(() => {
    if (autoStart && supported && !started.current) {
      started.current = true;
      toggle();
    }
  }, [autoStart, supported, toggle]);

  const listening = state === "listening";
  const busy = state === "requesting" || state === "processing";
  const statusKey = STATUS_KEY[state];
  const trimmed = text.trim();
  const submitText = useCallback(() => {
    if (!trimmed || listening || busy) return;
    onUse(trimmed);
  }, [trimmed, listening, busy, onUse]);
  const language_label = speechLocale(appLanguage) === "es-US" ? "Español" : "English";

  return (
    <View style={styles.wrap} testID="voice-panel">
      {supported ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? t("assistant.voice.stop") : t("assistant.voice.start")}
            accessibilityState={{ busy, selected: listening }}
            disabled={busy}
            onPress={listening ? stop : toggle}
            style={[styles.mic, listening && styles.micOn, busy && styles.disabled]}
            testID="voice-toggle"
          >
            {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Ionicons name={listening ? "stop" : "mic"} size={30} color={theme.onPrimary} />}
          </Pressable>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.status} accessibilityLiveRegion="polite" testID="voice-status">
            {statusKey ? t(statusKey) : ""}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.hint}>
            {t("assistant.voice.hint", { language: language_label })}
          </Text>
          {state === "denied" ? (
            <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.link} testID="voice-open-settings">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.linkText}>
                {t("assistant.voice.openSettings")}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={styles.unavailable} testID="voice-unavailable">
          <Ionicons name="mic-off-outline" size={26} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.status}>
            {t("assistant.voice.unavailable")}
          </Text>
        </View>
      )}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>
        {t("assistant.voice.recognized")}
      </Text>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={listening && interim ? `${text}${text ? " " : ""}${interim}` : text}
        onChangeText={setText}
        editable={!listening}
        multiline
        maxLength={maxChars}
        placeholder={t("assistant.voice.placeholder")}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={t("assistant.voice.recognized")}
        testID="voice-text"
      />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => inputRef.current?.focus()}
          style={[styles.secondary, styles.grow]}
          testID="voice-edit"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.secondaryText}>
            {t("assistant.voice.edit")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !trimmed || listening || busy }}
          disabled={!trimmed || listening || busy}
          onPress={submitText}
          style={[styles.primary, styles.grow, (!trimmed || listening || busy) && styles.disabled]}
          testID="voice-use"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.primaryText}>
            {t("assistant.voice.use")}
          </Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.ghost} testID="voice-cancel">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.ghostText}>
          {t("common.cancel")}
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    wrap: { gap: 10, alignItems: "stretch" },
    mic: { alignSelf: "center", width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: theme.primaryAction },
    micOn: { backgroundColor: theme.destructiveAction },
    unavailable: { alignItems: "center", gap: 8, paddingVertical: 6 },
    status: { textAlign: "center", fontSize: 16, fontWeight: "700", color: theme.textPrimary },
    hint: { textAlign: "center", fontSize: 12.5, lineHeight: 18, color: theme.textMuted },
    label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", color: theme.textMuted },
    input: {
      minHeight: 76,
      maxHeight: 160,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      lineHeight: 22,
      color: theme.textPrimary,
      backgroundColor: theme.surfaceElevated,
      textAlignVertical: "top",
    },
    actions: { flexDirection: "row", gap: 10 },
    grow: { flex: 1 },
    primary: { minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.primaryAction },
    primaryText: { color: theme.onPrimary, fontSize: 15.5, fontWeight: "800" },
    secondary: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
    secondaryText: { color: theme.textPrimary, fontSize: 15, fontWeight: "700" },
    ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
    ghostText: { color: theme.textSecondary, fontSize: 15, fontWeight: "600" },
    link: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
    linkText: { color: theme.ai.primary, fontSize: 14, fontWeight: "800" },
    disabled: { opacity: 0.45 },
  });
