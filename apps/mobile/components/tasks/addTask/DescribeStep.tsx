import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldError, inputStyle } from "@/components/tasks/addTask/formBits";
import { useTheme } from "@/lib/theme/useTheme";
import { ADD_TASK_LIMITS } from "@/lib/tasks/addTask/draft";
import type { ParseFailure } from "@/lib/tasks/addTask/parseRequest";
import type { VoiceState } from "@/lib/tasks/addTask/useVoiceInput";

export interface DescribeProps {
  text: string;
  onChangeText: (value: string) => void;
  isOnline: boolean;
  parsing: boolean;
  failure: ParseFailure | null;
  /** The AI understood the message but found no task in it. */
  noTask: boolean;
  restored: boolean;
  voice: {
    supported: boolean;
    state: VoiceState;
    interim: string;
    justAdded: boolean;
    onToggle: () => void;
  };
}

const VOICE_STATUS: Partial<Record<VoiceState, string>> = {
  requesting: "tasks.hk.add.voice.requesting",
  listening: "tasks.hk.add.voice.listening",
  processing: "tasks.hk.add.voice.processing",
  denied: "tasks.hk.add.voice.denied",
  nospeech: "tasks.hk.add.voice.nospeech",
  error: "tasks.hk.add.voice.error",
};

export function DescribeBody({ text, onChangeText, isOnline, parsing, failure, noTask, restored, voice }: DescribeProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const nearLimit = text.length > ADD_TASK_LIMITS.request * 0.8;
  const listening = voice.state === "listening";
  const voiceBusy = voice.state === "requesting" || voice.state === "processing";
  const statusKey = VOICE_STATUS[voice.state];
  const voiceProblem = voice.state === "denied" || voice.state === "nospeech" || voice.state === "error";

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.question, { color: theme.textPrimary }]}>
          {t("tasks.hk.add.describe.label")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {t("tasks.hk.add.describe.hint")}
        </Text>
      </View>

      {restored ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="add-task-restored">
          {t("tasks.hk.add.describe.restored")}
        </Text>
      ) : null}

      <View>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          editable={!parsing}
          multiline
          // Multiline: Return adds a new line; nothing is ever sent from the keyboard.
          maxLength={ADD_TASK_LIMITS.request}
          placeholder={t("tasks.hk.add.describe.placeholder")}
          placeholderTextColor={theme.textDisabled}
          accessibilityLabel={t("tasks.hk.add.describe.inputA11y")}
          textAlignVertical="top"
          style={[
            inputStyle,
            styles.input,
            { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle },
            voice.supported && styles.inputWithMic,
          ]}
          testID="add-task-input"
        />
        {voice.supported ? (
          <Pressable
            onPress={voice.onToggle}
            disabled={voiceBusy || parsing}
            accessibilityRole="button"
            accessibilityLabel={t(listening ? "tasks.hk.add.voice.stop" : "tasks.hk.add.voice.start")}
            accessibilityState={{ busy: voiceBusy, selected: listening, disabled: voiceBusy || parsing }}
            hitSlop={4}
            style={[
              styles.mic,
              { backgroundColor: listening ? theme.status.dirty : theme.surface, borderColor: listening ? theme.status.dirty : theme.border },
            ]}
            testID="add-task-mic"
          >
            <Ionicons name={listening ? "stop" : "mic-outline"} size={20} color={listening ? theme.onPrimary : theme.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      {nearLimit ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("tasks.hk.add.describe.count", { count: text.length, max: ADD_TASK_LIMITS.request })}
        </Text>
      ) : null}

      {voice.supported && (statusKey || voice.justAdded) ? (
        voiceProblem ? (
          <FieldError message={t(statusKey as string)} testID="voice-status" />
        ) : (
          <View accessibilityLiveRegion="polite" testID="voice-status">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
              {statusKey ? t(statusKey) : t("tasks.hk.add.voice.done")}
            </Text>
            {voice.interim ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.interim, { color: theme.textMuted }]} numberOfLines={3}>
                {voice.interim}
              </Text>
            ) : null}
          </View>
        )
      ) : null}
      {voice.supported && voice.state === "listening" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("tasks.hk.add.voice.privacy")}
        </Text>
      ) : null}

      <View style={[styles.smart, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
        <Ionicons name="sparkles-outline" size={16} color={theme.textSecondary} />
        <View style={styles.smartText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.smartTitle, { color: theme.textPrimary }]}>
            {t("tasks.hk.add.describe.smartTitle")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
            {t("tasks.hk.add.describe.smartBody")}
          </Text>
        </View>
      </View>

      {parsing ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.textSecondary }]} testID="add-task-working">
          {t("tasks.hk.add.describe.working")}
        </Text>
      ) : null}
      {!isOnline ? <FieldError message={t("tasks.hk.add.describe.offlineNote")} testID="add-task-offline" /> : null}
      {failure ? <FieldError message={t(`tasks.hk.add.describe.failed.${failure}`)} testID="add-task-failure" /> : null}
      {noTask ? <FieldError message={t("tasks.hk.add.describe.none")} testID="add-task-none" /> : null}
    </View>
  );
}

interface FooterProps {
  canContinue: boolean;
  parsing: boolean;
  failed: boolean;
  onContinue: () => void;
  onManual: () => void;
}

export function DescribeFooter({ canContinue, parsing, failed, onContinue, onManual }: FooterProps) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        label={t(failed ? "tasks.hk.add.describe.tryAgain" : "tasks.hk.add.describe.continue")}
        onPress={onContinue}
        loading={parsing}
        disabled={!canContinue}
        size="lg"
        testID="add-task-continue"
      />
      <Button
        label={t(failed ? "tasks.hk.add.describe.continueManually" : "tasks.hk.add.describe.manual")}
        onPress={onManual}
        variant="secondary"
        disabled={parsing}
        testID="add-task-manual"
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  head: { gap: 2 },
  question: { fontSize: 17, fontWeight: "800" },
  hint: { fontSize: 13.5, lineHeight: 19 },
  interim: { fontSize: 13.5, lineHeight: 19, fontStyle: "italic" },
  input: { minHeight: 128, maxHeight: 220, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: 22 },
  inputWithMic: { paddingRight: 56 },
  mic: { position: "absolute", right: 8, bottom: 8, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  smart: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: "flex-start" },
  smartText: { flex: 1, gap: 2 },
  smartTitle: { fontSize: 14, fontWeight: "800" },
});
