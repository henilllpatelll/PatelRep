import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { darkTheme } from "@/components/shared/tokens";
import type { SupervisorCopilotController } from "@/lib/ai/useSupervisorCopilot";
import {
  SOURCE_LABEL_KEY,
  buildFollowUpDraft,
  type CopilotSuggestion,
  type ProvenanceEntry,
} from "@/lib/ai/supervisorCopilot";
import type { AssistantConversation } from "@/lib/ai/useAssistantConversation";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { supervisorHref, type SupervisorScreen } from "@/lib/navigation/supervisorRoutes";

/* The supervisor Copilot's overview, inside the existing floating card (no second assistant, no extra button).
   Facts come from the verified Today snapshot and say where they came from; the optional AI wording is labelled
   as wording. Buttons here only open an existing screen or prepare an editable draft: none changes hotel data. */

const MUTED = "rgba(247,244,238,0.55)";
const LINE = "rgba(247,244,238,0.1)";

interface Props {
  controller: SupervisorCopilotController;
  conversation: AssistantConversation;
  onClose: () => void;
  /** Ask the card to put the composer in "describe a task" mode. */
  onPrepareTask: () => void;
}

const QUICK: Array<{ id: string; screen: SupervisorScreen | "task"; icon: React.ComponentProps<typeof Ionicons>["name"]; labelKey: string }> = [
  { id: "rooms", screen: "rooms", icon: "bed-outline", labelKey: "supervisorCopilot.quick.rooms" },
  { id: "unassigned", screen: "team", icon: "person-add-outline", labelKey: "supervisorCopilot.quick.unassigned" },
  { id: "inspections", screen: "inspect", icon: "shield-checkmark-outline", labelKey: "supervisorCopilot.quick.inspections" },
  { id: "blocked", screen: "tasks", icon: "hand-left-outline", labelKey: "supervisorCopilot.quick.blocked" },
  { id: "task", screen: "task", icon: "add-circle-outline", labelKey: "supervisorCopilot.quick.task" },
];

export function SupervisorCopilotBody({ controller, conversation, onClose, onPrepareTask }: Props) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const { model, room, language, zone } = controller;

  function open(href: ReturnType<typeof supervisorHref>) {
    onClose();
    openSupervisorHref(href);
  }

  function prepareTask() {
    // With a verified room in context the draft is composed here (free); otherwise the person describes it.
    if (room.state === "ok") {
      const preview = buildFollowUpDraft({ id: room.room.roomId, number: room.room.roomNumber }, null, t);
      conversation.proposeDraft(
        t("supervisorCopilot.draft.question", { room: room.room.roomNumber }),
        t("supervisorCopilot.draft.answer", { room: room.room.roomNumber }),
        preview,
      );
    } else {
      onPrepareTask();
    }
  }

  function runSuggestion(suggestion: CopilotSuggestion) {
    if (suggestion.type === "open") {
      open(suggestion.href);
      return;
    }
    const preview = buildFollowUpDraft({ id: suggestion.room.id, number: suggestion.room.number }, suggestion.reason, t);
    conversation.proposeDraft(
      t("supervisorCopilot.draft.question", { room: suggestion.room.number }),
      t("supervisorCopilot.draft.answer", { room: suggestion.room.number }),
      preview,
    );
  }

  function sourceLine(entry: ProvenanceEntry): string {
    const name = t(SOURCE_LABEL_KEY[entry.source]);
    const time = entry.fetchedAt ? formatHotelTime(new Date(entry.fetchedAt), zone, language) ?? "" : "";
    switch (entry.availability) {
      case "verified":
        return t("supervisorCopilot.sources.verified", { name, time });
      case "stale":
        return t("supervisorCopilot.sources.stale", { name, time });
      case "loading":
        return t("supervisorCopilot.sources.loading", { name });
      default:
        return t("supervisorCopilot.sources.unavailable", { name });
    }
  }

  const unchecked = model.unverified.map((source) => t(SOURCE_LABEL_KEY[source])).join(", ");

  return (
    <ScrollView
      style={{ maxHeight: Math.min(430, height * 0.52) }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="supervisor-copilot-body"
    >
      {room.state !== "none" ? (
        <View style={styles.contextChip} testID="supervisor-copilot-context">
          <Ionicons name={room.state === "ok" ? "bed-outline" : "alert-circle-outline"} size={14} color={darkTheme.ai.primary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.contextText} numberOfLines={2}>
            {room.state === "ok"
              ? t("supervisorCopilot.context.about", { room: room.room.roomNumber })
              : t("supervisorCopilot.context.gone", { room: room.roomNumber })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("supervisorCopilot.context.clear")}
            hitSlop={10}
            onPress={controller.clearRoom}
            style={styles.contextClear}
            testID="supervisor-copilot-context-clear"
          >
            <Ionicons name="close" size={15} color={MUTED} />
          </Pressable>
        </View>
      ) : null}

      <Heading text={t("supervisorCopilot.overview.heading")} />
      {model.overview.map((line) => (
        <Text
          key={line.id}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.overview, line.unknown && styles.unknown]}
          testID={`supervisor-copilot-overview-${line.id}`}
        >
          {t(line.key, line.params)}
        </Text>
      ))}

      <AiBlock controller={controller} />

      <Heading text={t("supervisorCopilot.observations.heading")} />
      {model.observations.length > 0 ? (
        model.observations.map((observation) => (
          <View key={observation.id} style={styles.observation} testID={`supervisor-copilot-observation-${observation.id}`}>
            <Ionicons name={observation.view.icon} size={16} color={darkTheme.ai.primary} style={styles.obsIcon} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.obsTitle}>
                {t(observation.view.title.key, observation.view.title.params)}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.obsSub}>
                {t(observation.view.subtitle.key, observation.view.subtitle.params)}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.overview} testID="supervisor-copilot-no-observations">
          {model.allClear ? t("supervisorCopilot.observations.none") : t("supervisorCopilot.observations.noneChecked")}
        </Text>
      )}

      {model.suggestions.length > 0 ? (
        <>
          <Heading text={t("supervisorCopilot.suggestions.heading")} />
          {model.suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              accessibilityRole="button"
              accessibilityLabel={suggestionLabel(suggestion, t)}
              accessibilityHint={t(suggestion.type === "open" ? "supervisorCopilot.suggestions.openHint" : "supervisorCopilot.suggestions.draftHint")}
              onPress={() => runSuggestion(suggestion)}
              style={styles.suggestion}
              testID={`supervisor-copilot-suggestion-${suggestion.id}`}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.suggestionText} numberOfLines={2}>
                {suggestionLabel(suggestion, t)}
              </Text>
              <Ionicons name={suggestion.type === "open" ? "arrow-forward" : "create-outline"} size={16} color={darkTheme.textPrimary} />
            </Pressable>
          ))}
        </>
      ) : null}

      <Heading text={t("supervisorCopilot.quick.heading")} />
      <View style={styles.quickRow}>
        {QUICK.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={t(action.labelKey)}
            onPress={() => (action.screen === "task" ? prepareTask() : open(supervisorHref({ screen: action.screen })))}
            style={styles.quick}
            testID={`supervisor-copilot-quick-${action.id}`}
          >
            <Ionicons name={action.icon} size={14} color={darkTheme.ai.primary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.quickText} numberOfLines={1}>
              {t(action.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Heading text={t("supervisorCopilot.sources.heading")} />
      {model.provenance.map((entry) => (
        <Text
          key={entry.source}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.source, entry.availability !== "verified" && styles.sourceWarn]}
          testID={`supervisor-copilot-source-${entry.source}`}
        >
          {sourceLine(entry)}
        </Text>
      ))}
      {unchecked ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.sourceWarn} testID="supervisor-copilot-unchecked">
          {t("supervisorCopilot.sources.notChecked", { sources: unchecked })}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function suggestionLabel(suggestion: CopilotSuggestion, t: (key: string, options?: Record<string, unknown>) => string): string {
  return suggestion.type === "open"
    ? t(suggestion.labelKey)
    : t("supervisorCopilot.suggestions.draftTask", { room: suggestion.room.number });
}

function Heading({ text }: { text: string }) {
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heading}>
      {text}
    </Text>
  );
}

/* ─── Optional AI wording ─────────────────────────────────────────────────── */

function AiBlock({ controller }: { controller: SupervisorCopilotController }) {
  const { t } = useTranslation();
  const { summary, language, zone } = controller;
  if (summary.status === "disabled") {
    return (
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.overview, styles.unknown]} testID="supervisor-copilot-ai-disabled">
        {t("supervisorCopilot.ai.disabled")}
      </Text>
    );
  }
  const at = (ms: number) => formatHotelTime(new Date(ms), zone, language) ?? "";
  return (
    <View style={styles.ai} testID="supervisor-copilot-ai">
      <View style={styles.aiHeader}>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>{t("copilot.card.badge")}</Text>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiTitle}>
          {t("supervisorCopilot.ai.heading")}
        </Text>
      </View>

      {summary.status === "pending" ? (
        <View style={styles.aiRow} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={darkTheme.ai.primary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiMuted}>
            {t("supervisorCopilot.ai.pending")}
          </Text>
        </View>
      ) : null}

      {summary.status === "ready" ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiText} testID="supervisor-copilot-ai-text">
            {summary.result.summary}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiMuted}>
            {t("supervisorCopilot.ai.interpretation")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiMuted} testID="supervisor-copilot-ai-meta">
            {[
              t("supervisorCopilot.ai.writtenAt", { time: at(summary.result.generatedAt) }),
              summary.result.creditsUsed !== null ? t("supervisorCopilot.ai.creditsUsed", { credits: summary.result.creditsUsed }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {!summary.current ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.sourceWarn} testID="supervisor-copilot-ai-outdated">
              {t("supervisorCopilot.ai.outdated")}
            </Text>
          ) : null}
        </>
      ) : null}

      {summary.status === "failed" ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.sourceWarn} accessibilityLiveRegion="polite" testID="supervisor-copilot-ai-failure">
            {t(`supervisorCopilot.ai.failure.${summary.failure}`)}
          </Text>
          {summary.earlier ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiMuted}>
              {summary.earlier.summary}
            </Text>
          ) : null}
        </>
      ) : null}

      {summary.status === "idle" && !summary.canAsk ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiMuted}>
          {t("supervisorCopilot.ai.noBoard")}
        </Text>
      ) : null}

      {summary.status !== "pending" && !(summary.status === "idle" && !summary.canAsk) && !(summary.status === "failed" && !canRetry(summary.failure)) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(summary.status === "ready" ? "supervisorCopilot.ai.refresh" : "supervisorCopilot.ai.ask")}
          accessibilityHint={t("supervisorCopilot.ai.costNote")}
          onPress={() => void controller.askSummary(summary.status === "ready" || summary.status === "failed")}
          style={styles.aiButton}
          testID="supervisor-copilot-ai-ask"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiButtonText}>
            {t(summary.status === "ready" ? "supervisorCopilot.ai.refresh" : summary.status === "failed" ? "supervisorCopilot.ai.retry" : "supervisorCopilot.ai.ask")}
          </Text>
        </Pressable>
      ) : null}
      {summary.status !== "pending" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.aiMuted}>
          {t("supervisorCopilot.ai.costNote")}
        </Text>
      ) : null}
    </View>
  );
}

/** A failure that no retry can fix is not offered one (the hotel has the feature off or has used its credits). */
function canRetry(failure: string): boolean {
  return failure !== "disabled" && failure !== "credit_limit";
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 13, paddingTop: 10, paddingBottom: 8, gap: 2 },
  heading: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: "rgba(247,244,238,0.45)",
  },
  overview: { fontSize: 14, lineHeight: 20, color: darkTheme.textPrimary },
  unknown: { color: MUTED, fontStyle: "italic" },
  contextChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    marginBottom: 2,
  },
  contextText: { flex: 1, fontSize: 12.5, color: darkTheme.textPrimary },
  contextClear: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  observation: { flexDirection: "row", gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE },
  obsIcon: { marginTop: 2 },
  obsTitle: { fontSize: 14, fontWeight: "700", color: darkTheme.textPrimary },
  obsSub: { fontSize: 12.5, lineHeight: 17, color: MUTED },
  suggestion: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
    backgroundColor: darkTheme.primaryAction,
  },
  suggestionText: { flex: 1, fontSize: 13.5, fontWeight: "700", color: darkTheme.onPrimary },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quick: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: "rgba(247,244,238,0.14)",
    backgroundColor: "rgba(247,244,238,0.05)",
  },
  quickText: { fontSize: 12, color: darkTheme.textPrimary },
  source: { fontSize: 12, lineHeight: 17, color: "rgba(247,244,238,0.6)" },
  sourceWarn: { fontSize: 12, lineHeight: 17, color: "#E8B76A" },
  ai: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: darkTheme.ai.line,
    padding: 10,
    gap: 6,
    backgroundColor: "rgba(247,244,238,0.03)",
  },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiBadge: { backgroundColor: darkTheme.ai.primary, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 10, fontWeight: "700", color: darkTheme.onAi, letterSpacing: 0.4 },
  aiTitle: { fontSize: 12.5, fontWeight: "700", color: darkTheme.textPrimary },
  aiRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiText: { fontSize: 14, lineHeight: 20, color: darkTheme.textPrimary },
  aiMuted: { fontSize: 11.5, lineHeight: 16, color: MUTED },
  aiButton: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: darkTheme.ai.primary,
  },
  aiButtonText: { fontSize: 13, fontWeight: "700", color: darkTheme.ai.primary },
});
