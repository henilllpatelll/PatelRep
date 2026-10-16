import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SettingsChoiceRow } from "@/components/settings/SettingsChoiceRow";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { assistantScope } from "@/lib/ai/session";
import { useAiPreferences, type LanguageChoice } from "@/lib/ai/preferences";
import { useSavedConversation } from "@/lib/ai/useSavedConversation";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";
import { useVoiceCapability } from "@/lib/voice/useVoiceCapability";
import { useAppStore } from "@/stores/appStore";

const CHOICES: LanguageChoice[] = ["app", "en", "es"];
const PRIVACY_POINTS = ["roleOnly", "aiMarked", "confirmFirst", "audio", "saved"] as const;

type Sheet = "clear" | "privacy" | null;

/**
 * AI & voice settings. Every control changes something real: voice input hides or shows every
 * microphone, the two language choices are what AI text is requested in and what the microphone
 * listens in, suggestions hide the assistant's suggested questions, and the privacy rows act on the one
 * conversation this phone keeps. Opening this screen asks for no permission and makes no AI request.
 */
export default function AiVoiceSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAppStore((s) => s.user);
  const scope = assistantScope(user);
  const prefs = useAiPreferences();
  const voice = useVoiceCapability();
  const saved = useSavedConversation(scope);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  if (!prefs.hydrated) {
    return (
      <SettingsScreen title={t("settings.aiVoice.title")} back>
        <StateBlock status="loading" />
      </SettingsScreen>
    );
  }

  const choiceLabel = (choice: LanguageChoice) =>
    choice === "app" ? t("settings.aiVoice.matchApp") : choice === "en" ? "English" : "Español";

  const run = async (afterDone: () => void) => {
    if (clearing) return;
    setClearing(true);
    try {
      await saved.clear();
      setCleared(true);
      afterDone();
    } finally {
      setClearing(false);
    }
  };

  const savedSubtitle =
    saved.count === null
      ? t("settings.aiVoice.history.checking")
      : saved.count === 0
        ? t("settings.aiVoice.history.none")
        : t("settings.aiVoice.history.saved", { count: saved.count });

  return (
    <SettingsScreen title={t("settings.aiVoice.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]} testID="ai-voice-about">
        {t("settings.aiVoice.about")}
      </Text>

      {prefs.saveFailed ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notice, { color: theme.status.dirty }]} testID="ai-voice-save-failed">
          {t("settings.aiVoice.saveFailed")}
        </Text>
      ) : null}

      <SettingsSection title={t("settings.aiVoice.sections.voice")}>
        <SettingsRow
          first
          icon="mic-outline"
          label={t("settings.aiVoice.voiceInput")}
          subtitle={voice.available ? t("settings.aiVoice.voiceInputHint") : t("settings.aiVoice.voiceUnsupported")}
          switchValue={prefs.voiceInput && voice.available}
          onSwitchChange={(next) => void prefs.update({ voiceInput: next })}
          disabled={!voice.available}
          testID="ai-voice-input"
        />
      </SettingsSection>

      <SettingsSection title={t("settings.aiVoice.sections.speechLanguage")}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("settings.aiVoice.sections.speechLanguage")}>
          {CHOICES.map((choice, index) => (
            <SettingsChoiceRow
              key={choice}
              first={index === 0}
              label={choiceLabel(choice)}
              selected={prefs.speechLanguage === choice}
              onPress={() => void prefs.update({ speechLanguage: choice })}
              testID={`ai-speech-${choice}`}
            />
          ))}
        </View>
      </SettingsSection>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
        {t("settings.aiVoice.speechLanguageHint")}
      </Text>

      <SettingsSection title={t("settings.aiVoice.sections.answerLanguage")}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("settings.aiVoice.sections.answerLanguage")}>
          {CHOICES.map((choice, index) => (
            <SettingsChoiceRow
              key={choice}
              first={index === 0}
              label={choiceLabel(choice)}
              selected={prefs.assistantLanguage === choice}
              onPress={() => void prefs.update({ assistantLanguage: choice })}
              testID={`ai-answer-${choice}`}
            />
          ))}
        </View>
      </SettingsSection>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
        {t("settings.aiVoice.answerLanguageHint")}
      </Text>

      <SettingsSection title={t("settings.aiVoice.sections.assistance")}>
        <SettingsRow
          first
          icon="sparkles-outline"
          label={t("settings.aiVoice.suggestions")}
          subtitle={t("settings.aiVoice.suggestionsHint")}
          switchValue={prefs.suggestions}
          onSwitchChange={(next) => void prefs.update({ suggestions: next })}
          testID="ai-suggestions"
        />
      </SettingsSection>

      <SettingsSection title={t("settings.aiVoice.sections.privacy")}>
        <SettingsRow
          first
          icon="chatbubbles-outline"
          label={t("settings.aiVoice.history.title")}
          subtitle={savedSubtitle}
          onPress={() => setSheet("clear")}
          testID="ai-history"
        />
        <SettingsRow
          icon="add-circle-outline"
          label={t("settings.aiVoice.newConversation")}
          subtitle={t("settings.aiVoice.newConversationHint")}
          onPress={() => void run(() => undefined)}
          testID="ai-new-conversation"
        />
        <SettingsRow
          icon="shield-checkmark-outline"
          label={t("settings.aiVoice.privacyRow")}
          onPress={() => setSheet("privacy")}
          testID="ai-privacy"
        />
      </SettingsSection>
      {cleared ? (
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="ai-history-cleared">
          {t("settings.aiVoice.history.cleared")}
        </Text>
      ) : null}

      <BottomSheet
        visible={sheet === "clear"}
        title={t("settings.aiVoice.clear.title")}
        onClose={() => setSheet(null)}
        grabber
        testID="ai-clear-sheet"
        footer={
          <>
            <Button
              label={t("settings.aiVoice.clear.confirm")}
              onPress={() => void run(() => setSheet(null))}
              variant="destructive"
              loading={clearing}
              disabled={clearing || saved.count === 0}
              testID="ai-clear-confirm"
            />
            <Button label={t("common.cancel")} onPress={() => setSheet(null)} variant="secondary" disabled={clearing} testID="ai-clear-cancel" />
          </>
        }
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sheetBody, { color: theme.textPrimary }]}>
          {t("settings.aiVoice.clear.clears")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sheetBody, { color: theme.textMuted }]} testID="ai-clear-not">
          {t("settings.aiVoice.clear.doesNot")}
        </Text>
      </BottomSheet>

      <BottomSheet visible={sheet === "privacy"} title={t("settings.aiVoice.privacyRow")} onClose={() => setSheet(null)} grabber tall testID="ai-privacy-sheet">
        <View style={styles.points}>
          {PRIVACY_POINTS.map((key) => (
            <View key={key} style={styles.point}>
              <Ionicons name="checkmark-circle-outline" size={18} color={theme.primary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sheetBody, styles.pointText, { color: theme.textPrimary }]}>
                {t(`assistant.menu.privacyPoints.${key}`)}
              </Text>
            </View>
          ))}
          {(["usage", "provider"] as const).map((key) => (
            <View key={key} style={styles.point}>
              <Ionicons name="information-circle-outline" size={18} color={theme.primary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sheetBody, styles.pointText, { color: theme.textPrimary }]}>
                {t(`settings.aiVoice.privacyExtra.${key}`)}
              </Text>
            </View>
          ))}
        </View>
      </BottomSheet>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  notice: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
  sheetBody: { fontSize: 15, lineHeight: 22 },
  points: { gap: 12 },
  point: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  pointText: { flex: 1 },
});
