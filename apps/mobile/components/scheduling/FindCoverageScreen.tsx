import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { OfferShiftSheet, WaiveGapSheet } from "@/components/scheduling/CoverageActionSheets";
import { ScheduleBanner, ScheduleError, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import {
  approveClaim, classifyCoverageFailure, declineClaim, fetchCandidates, fetchGap, fetchHistory, recordOfferAccepted, withdrawOffer,
  type CoverageCandidate, type CoverageGap, type HistoryEvent,
} from "@/lib/api/schedulingCoverage";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { emitCoverageChanged } from "@/lib/scheduling/coverageSignal";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { assignmentsHref } from "@/lib/navigation/supervisorRoutes";
import { candidateFlagText, candidateSummary, failureText, gapStatusLabel, gapTitle, gapWindow, requiredRoleText } from "@/lib/scheduling/coverageText";
import { formatLongDate, formatWallClock } from "@/lib/scheduling/teamScheduleDates";
import { roleLabel } from "@/lib/scheduling/teamScheduleText";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

type Filter = "all" | "eligible" | "warnings" | "conflicts";
const FILTERS: readonly Filter[] = ["eligible", "all", "warnings", "conflicts"];

/* ─── Find Coverage ─────────────────────────────────────────────────────────
   One uncovered shift, the people who could take it and what is already in motion (offers, claims). Everything shown is
   read from the server; the screen never decides eligibility. Candidates are explained, not scored: reasons they
   qualify, warnings to weigh, and the exact blocker for anyone who cannot. Nobody is called "available" — a person
   without a shift has not agreed to work, and availability is unknown until Phase 5. */

export function FindCoverageScreen({ gapId }: { gapId: string }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const language = i18n.language;
  const { zone } = useHotelToday();

  const [gap, setGap] = useState<CoverageGap | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "failed">("loading");
  const [candidates, setCandidates] = useState<CoverageCandidate[]>([]);
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("eligible");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<CoverageCandidate | null>(null);
  const [waiving, setWaiving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const busy = useRef(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const fresh = await fetchGap(gapId);
      if (mine !== seq.current) return;
      setGap(fresh);
      setState("ready");
    } catch (error) {
      if (mine !== seq.current) return;
      const failure = classifyCoverageFailure(error);
      setState((held) => (failure.raw.kind === "not_found" ? "gone" : held === "ready" ? "ready" : "failed"));
      if (failure.raw.kind !== "not_found") setNotice((held) => held ?? { tone: "error", text: t("teamSchedule.coverage.refreshFailed") });
    }
  }, [gapId, t]);

  const loadCandidates = useCallback(async () => {
    if (!gap || (gap.status !== "open" && gap.status !== "offered")) return;
    try {
      const list = await fetchCandidates(gapId, { q: query, filter });
      setCandidates(list.candidates);
      setCandidatesFailed(false);
    } catch {
      setCandidatesFailed(true);
    }
  }, [gapId, gap?.status, gap?.version, query, filter]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  // Search is applied on the server so a long roster is never filtered from a partial list; a short pause avoids a call per key.
  useEffect(() => {
    const handle = setTimeout(() => void loadCandidates(), query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [loadCandidates, query]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    await Promise.all([load(), loadCandidates()]);
    setRefreshing(false);
  }, [load, loadCandidates]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/team-schedule" as never);
  }, []);

  const reviewRooms = useCallback(() => {
    if (gap?.absentUserId) openSupervisorHref(assignmentsHref({ staffId: gap.absentUserId }));
  }, [gap?.absentUserId]);

  const act = useCallback(async (job: () => Promise<CoverageGap | void>, okText?: string) => {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    try {
      const result = await job();
      emitCoverageChanged();
      if (result) setGap(result);
      else await load();
      if (okText) setNotice({ tone: "info", text: okText });
    } catch (error) {
      const failure = classifyCoverageFailure(error);
      setNotice({ tone: "error", text: failureText(failure, t) });
      if (failure.stale) await load();
    } finally {
      busy.current = false;
    }
  }, [load, t]);

  const onOfferResult = useCallback((next: CoverageGap | null, outcome: "offered" | "assigned" | "stale") => {
    if (outcome === "stale") {
      setPicked(null);
      void load();
      return;
    }
    if (next) setGap(next);
    emitCoverageChanged();
    if (outcome === "assigned") {
      setPicked(null);
      setNotice({ tone: "info", text: t("teamSchedule.coverage.covered") });
    }
  }, [load, t]);

  const toggleHistory = useCallback(async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) {
      try {
        setHistory(await fetchHistory(gapId));
      } catch {
        setHistory([]);
        setNotice({ tone: "error", text: t("teamSchedule.coverage.historyFailed") });
      }
    }
  }, [showHistory, gapId, t]);

  const open = gap?.status === "open" || gap?.status === "offered";
  const pendingOffers = useMemo(() => (gap?.offers ?? []).filter((offer) => offer.status === "pending"), [gap]);
  const pendingClaims = useMemo(() => (gap?.claims ?? []).filter((claim) => claim.status === "pending"), [gap]);
  const mutateOff = !isOnline;

  const header = gap ? (
    <View style={styles.header} testID="find-coverage-header">
      {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("teamSchedule.coverage.offlineReadOnly")} testID="find-coverage-offline" /> : null}
      {notice ? <SheetNotice tone={notice.tone} text={notice.text} testID="find-coverage-notice" /> : null}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <View style={styles.titleRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
            {gapTitle(gap, t)}
          </Text>
          <View style={[styles.chip, { backgroundColor: gap.status === "filled" ? theme.status.cleanSoft : theme.status.pickupSoft, borderColor: gap.status === "filled" ? theme.status.cleanLine : theme.status.pickupLine }]} testID="find-coverage-status">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
              {gapStatusLabel(gap, t)}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="find-coverage-when">
          {formatLongDate(gap.workDate, language)} · {gapWindow(gap, zone, language, t)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("teamSchedule.coverage.requiredRole", { role: requiredRoleText(gap.requiredRole, t) })}
        </Text>
        {gap.absentUserName ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="find-coverage-absent">
            {t("teamSchedule.coverage.callOutBy", { name: gap.absentUserName, kind: gap.absenceKind ? t(`teamSchedule.coverage.kind.${gap.absenceKind}`) : "" })}
          </Text>
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("teamSchedule.coverage.openShiftNoCallOut")}
          </Text>
        )}
        {gap.status === "filled" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.strong, { color: theme.textPrimary }]} testID="find-coverage-filled">
            {t("teamSchedule.coverage.filledBy", { name: gap.filledUserName ?? t("teamSchedule.coverage.someone") })}
          </Text>
        ) : null}
        {gap.status === "waived" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("teamSchedule.coverage.waivedBecause", { reason: gap.resolutionReason ?? "—" })}
          </Text>
        ) : null}
      </View>

      {gap.status === "filled" ? <SheetNotice text={t("teamSchedule.coverage.roomsSeparate")} testID="find-coverage-rooms-separate" /> : null}
      {gap.absentUserId ? <Button label={t("teamSchedule.coverage.action.reviewRooms")} icon="home-outline" variant="secondary" onPress={reviewRooms} testID="find-coverage-review-rooms" /> : null}

      {pendingOffers.length > 0 ? (
        <View style={styles.block} testID="find-coverage-offers">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.pendingOffers").toUpperCase()}
          </Text>
          {pendingOffers.map((offer) => (
            <View key={offer.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={`find-coverage-offer-${offer.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                {offer.userName || t("teamSchedule.coverage.someone")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                {t("teamSchedule.coverage.offerPending")}
                {offer.expiresAt ? ` · ${t("teamSchedule.coverage.offerExpires", { time: formatHotelTime(offer.expiresAt, zone, language) ?? "—" })}` : ""}
              </Text>
              <View style={styles.row}>
                <View style={styles.cell}>
                  <Button label={t("teamSchedule.coverage.action.recordAccepted")} size="sm" disabled={mutateOff} onPress={() => void act(() => recordOfferAccepted(offer.id), t("teamSchedule.coverage.covered"))} testID={`offer-accepted-${offer.id}`} />
                </View>
                <View style={styles.cell}>
                  <Button label={t("teamSchedule.coverage.action.withdraw")} size="sm" variant="secondary" disabled={mutateOff} onPress={() => void act(() => withdrawOffer(gap.id, offer.id))} testID={`offer-withdraw-${offer.id}`} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {pendingClaims.length > 0 ? (
        <View style={styles.block} testID="find-coverage-claims">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.claims").toUpperCase()}
          </Text>
          {pendingClaims.map((claim) => (
            <View key={claim.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={`find-coverage-claim-${claim.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                {claim.userName || t("teamSchedule.coverage.someone")}
              </Text>
              <View style={styles.row}>
                <View style={styles.cell}>
                  <Button label={t("teamSchedule.coverage.action.approve")} size="sm" disabled={mutateOff} onPress={() => void act(() => approveClaim(claim.id, gap.version, true), t("teamSchedule.coverage.covered"))} testID={`claim-approve-${claim.id}`} />
                </View>
                <View style={styles.cell}>
                  <Button label={t("teamSchedule.coverage.action.decline")} size="sm" variant="secondary" disabled={mutateOff} onPress={() => void act(() => declineClaim(claim.id, gap.version))} testID={`claim-decline-${claim.id}`} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {open ? (
        <View style={styles.block}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.candidates").toUpperCase()}
          </Text>
          <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
            <Ionicons name="search" size={18} color={theme.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("teamSchedule.coverage.searchPlaceholder")}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t("teamSchedule.coverage.searchLabel")}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              maxLength={80}
              testID="find-coverage-search"
              style={[styles.searchInput, { color: theme.textPrimary }]}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={8} testID="find-coverage-search-clear">
                <Ionicons name="close-circle" size={18} color={theme.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.filters} accessibilityRole="tablist">
            {FILTERS.map((option) => {
              const selected = option === filter;
              return (
                <Pressable key={option} onPress={() => setFilter(option)} accessibilityRole="tab" accessibilityState={{ selected }} testID={`find-coverage-filter-${option}`} style={[styles.filter, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }]}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.filterText, { color: theme.textPrimary }]}>
                    {t(`teamSchedule.coverage.filter.${option}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="find-coverage-availability-note">
            {t("teamSchedule.coverage.availabilityNote")}
          </Text>
          {candidatesFailed ? <SheetNotice tone="error" text={t("teamSchedule.coverage.candidatesFailed")} testID="find-coverage-candidates-failed" /> : null}
        </View>
      ) : null}
    </View>
  ) : null;

  const footer = gap ? (
    <View style={styles.footer}>
      {open ? <Button label={t(gap.source === "open_shift" ? "teamSchedule.coverage.action.cancelOpen" : "teamSchedule.coverage.action.waive")} variant="ghost" disabled={mutateOff} onPress={() => setWaiving(true)} testID="find-coverage-waive" /> : null}
      <Button label={t(showHistory ? "teamSchedule.coverage.action.hideHistory" : "teamSchedule.coverage.action.history")} variant="ghost" onPress={() => void toggleHistory()} testID="find-coverage-history-toggle" />
      {showHistory ? (
        <View testID="find-coverage-history">
          {(history ?? []).length === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("teamSchedule.coverage.historyEmpty")}
            </Text>
          ) : (
            (history ?? []).map((event) => (
              <Text key={event.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
                {`${event.at ? formatHotelTime(event.at, zone, language) ?? "" : ""} · ${t(`teamSchedule.coverage.event.${event.resourceType}.${event.action}`, { defaultValue: `${event.resourceType} ${event.action}` })}${event.actorName ? ` · ${event.actorName}` : ""}${event.reason ? ` — ${event.reason}` : ""}`}
              </Text>
            ))
          )}
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="find-coverage">
      <View style={[styles.bar, { paddingTop: insets.top + 8, borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="find-coverage-back" style={styles.backHit}>
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.barTitle, { color: theme.textPrimary }]}>
          {t("teamSchedule.coverage.findTitle")}
        </Text>
      </View>
      {state === "loading" ? (
        <ScheduleSkeleton />
      ) : state === "gone" ? (
        <View style={styles.center} testID="find-coverage-gone">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
            {t("teamSchedule.coverage.gone")}
          </Text>
          <Button label={t("teamSchedule.coverage.action.returnToSchedule")} onPress={back} testID="find-coverage-gone-back" />
        </View>
      ) : state === "failed" ? (
        <ScheduleError failure={null} onRetry={() => void load()} t={t} />
      ) : (
        <FlatList
          data={open ? candidates : []}
          keyExtractor={(item) => item.userId}
          ListHeaderComponent={header ?? undefined}
          ListFooterComponent={footer ?? undefined}
          ListEmptyComponent={open && !candidatesFailed ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, styles.empty, { color: theme.textMuted }]} testID="find-coverage-no-candidates">
              {t(query ? "teamSchedule.coverage.noMatch" : "teamSchedule.coverage.noCandidates")}
            </Text>
          ) : undefined}
          renderItem={({ item }) => <CandidateCard candidate={item} zone={zone} language={language} disabled={mutateOff} onPress={() => setPicked(item)} t={t} />}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          testID="find-coverage-list"
        />
      )}
      <OfferShiftSheet gap={picked ? gap : null} candidate={picked} isOnline={isOnline} zone={zone} language={language} onResult={onOfferResult} onClose={() => setPicked(null)} t={t} />
      <WaiveGapSheet gap={waiving ? gap : null} isOnline={isOnline} onClose={() => setWaiving(false)} onResult={(next) => { setWaiving(false); emitCoverageChanged(); if (next) { setGap(next); setNotice({ tone: "info", text: t("teamSchedule.coverage.waived") }); } else void load(); }} t={t} />
    </View>
  );
}

function CandidateCard({ candidate, zone, language, disabled, onPress, t }: { candidate: CoverageCandidate; zone: string | null; language?: string; disabled: boolean; onPress: () => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  const theme = useTheme();
  const summary = candidateSummary(candidate, t);
  const flags = candidate.eligible ? candidate.warnings : candidate.blockers.slice(1);
  const roles = candidate.roles.map((role) => roleLabel(role, t)).join(", ");
  const shifts = candidate.existingShifts.slice(0, 2).map((shift) => `${formatLongDate(shift.workDate, language)} ${formatWallClock(shift.workDate, shift.startTime, shift.workDate, zone, language)}`).join(" · ");
  const label = [candidate.name, roles, summary, ...flags.map((f) => candidateFlagText(f, t))].filter(Boolean).join(". ");
  return (
    <Pressable
      onPress={onPress}
      disabled={!candidate.eligible || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !candidate.eligible || disabled }}
      testID={`candidate-${candidate.userId}`}
      style={({ pressed }) => [styles.candidate, { backgroundColor: theme.surface, borderColor: candidate.eligible ? theme.borderSubtle : theme.border, opacity: candidate.eligible ? 1 : 0.7 }, pressed && { opacity: 0.8 }]}
    >
      <Avatar name={candidate.name} size={44} />
      <View style={styles.candidateText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
          {candidate.name || t("teamSchedule.coverage.someone")}
        </Text>
        {roles ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
            {roles}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.strong, { color: candidate.eligible ? theme.textPrimary : theme.status.pickup }]} testID={`candidate-summary-${candidate.userId}`}>
          {summary}
        </Text>
        {flags.filter((f) => f !== "availability_unknown").map((flag) => (
          <Text key={flag} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
            • {candidateFlagText(flag, t)}
          </Text>
        ))}
        {candidate.eligible ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.flag.availability_unknown")}
          </Text>
        ) : null}
        {shifts ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("teamSchedule.coverage.offer.alsoScheduled", { shifts })}
          </Text>
        ) : null}
      </View>
      {candidate.eligible ? <Ionicons name="chevron-forward" size={18} color={theme.textMuted} /> : null}
    </Pressable>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  backHit: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  barTitle: { flex: 1, fontSize: 20, fontWeight: "800" },
  list: { paddingHorizontal: 16, paddingTop: 12 },
  header: { gap: 12, paddingBottom: 12 },
  block: { gap: 8 },
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12.5, fontWeight: "800" },
  body: { fontSize: 14.5, lineHeight: 20 },
  strong: { fontWeight: "700" },
  name: { fontSize: 16, fontWeight: "800" },
  hint: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  row: { flexDirection: "row", gap: 8 },
  cell: { flex: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15.5, minHeight: MIN_TARGET },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { minHeight: MIN_TARGET - 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, justifyContent: "center" },
  filterText: { fontSize: 14, fontWeight: "700" },
  candidate: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: R.md, padding: 12, minHeight: MIN_TARGET + 16 },
  candidateText: { flex: 1, minWidth: 0, gap: 2 },
  separator: { height: 10 },
  empty: { textAlign: "center", paddingVertical: 16 },
  footer: { gap: 6, paddingTop: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
});
