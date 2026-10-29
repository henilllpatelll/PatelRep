import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { ChipRow, FailureNotice } from "@/components/scheduling/requestParts";
import { ScheduleBanner, ScheduleEmptyCard, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { Button } from "@/components/ui/Button";
import {
  claimOpenShift,
  fetchMyClaims,
  fetchMyOffers,
  fetchOpenShifts,
  respondToOffer,
  withdrawClaim,
  type MyClaim,
  type MyOffer,
  type OfferedShift,
  type OpenShift,
} from "@/lib/api/schedulingOffers";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useRemote, useRequestAction } from "@/lib/scheduling/requestHooks";
import { faceWindow } from "@/lib/scheduling/publishText";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

/* ─── My shift offers, open shifts and requests (employee) ──────────────────
   A shift OFFER is a question, not a shift: nothing appears on the employee's schedule until they accept AND the server
   confirms (the screen re-reads on success and says "On your schedule" only for an accepted offer). A CLAIM is interest in
   an open shift that a supervisor decides. Everything shown is the employee's own and the shift itself: never the person
   who was called out, other candidates or other people's requests. */

type Tab = "offers" | "open" | "requests";
const TABS: readonly Tab[] = ["offers", "open", "requests"];

export function MyOffersScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const zone = useAppStore((state) => state.hotelTimezone) ?? null;
  const language = i18n.language;
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "open" ? "open" : params.tab === "requests" ? "requests" : "offers");
  const offers = useRemote(fetchMyOffers, []);
  const open = useRemote(fetchOpenShifts, [], tab === "open");
  const claims = useRemote(fetchMyClaims, [], tab === "requests");
  const action = useRequestAction();
  const [refreshing, setRefreshing] = useState(false);

  const current = tab === "offers" ? offers : tab === "open" ? open : claims;
  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([offers.refresh(), tab === "open" ? open.refresh() : Promise.resolve(), tab === "requests" ? claims.refresh() : Promise.resolve()]);
    setRefreshing(false);
  };

  const answer = async (offer: MyOffer, accept: boolean) => {
    const done = await action.run(() => respondToOffer(offer.id, accept), () => void offers.refresh());
    if (done === null) return;
    toast.success(t(accept ? "scheduling.offers.accepted" : "scheduling.offers.declined"));
    await offers.refresh();
  };
  const confirmAccept = (offer: MyOffer) =>
    Alert.alert(t("scheduling.offers.acceptTitle"), t("scheduling.offers.acceptMessage", { date: formatLongDate(offer.shift.workDate, language), window: windowOf(offer.shift, zone, language) }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("scheduling.offers.accept"), onPress: () => void answer(offer, true) },
    ]);
  const claim = async (row: OpenShift) => {
    const done = await action.run(() => claimOpenShift(row.shift.id), () => void open.refresh());
    if (done === null) return;
    toast.success(t("scheduling.offers.claimSent"));
    await Promise.all([open.refresh(), claims.refresh()]);
  };
  const withdraw = async (claimId: string) => {
    const done = await action.run(() => withdrawClaim(claimId), () => void open.refresh());
    if (done === null) return;
    toast.success(t("scheduling.offers.claimWithdrawn"));
    await Promise.all([open.refresh(), claims.refresh()]);
  };

  const live = (offers.data ?? []).filter((offer) => offer.status === "pending");
  const past = (offers.data ?? []).filter((offer) => offer.status !== "pending");

  return (
    <ScreenFrame title={t("scheduling.offers.title")} kicker={t("scheduling.offers.kicker")} fallback="/(app)/scheduling" testID="my-offers">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor={theme.primaryAction} />}
        keyboardShouldPersistTaps="handled"
      >
        {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("scheduling.offers.offline")} testID="my-offers-offline" /> : null}
        <ChipRow options={TABS} value={tab} onChange={setTab} labelFor={(option) => `${t(`scheduling.offers.tab.${option}`)}${option === "offers" && live.length > 0 ? ` (${live.length})` : ""}`} testID="my-offers-tabs" wrap />
        {action.failure ? <FailureNotice failure={action.failure} t={t} testID="my-offers-failure" /> : null}
        {current.failure && current.data ? <FailureNotice failure={current.failure} t={t} testID="my-offers-refresh-failed" /> : null}

        {current.status === "loading" && !current.data ? <ScheduleSkeleton /> : null}
        {current.status === "failed" && !current.data ? (
          <View style={styles.stack}>
            {current.failure ? <FailureNotice failure={current.failure} t={t} testID="my-offers-load-failed" /> : null}
            <Button label={t("common.retry")} variant="secondary" onPress={() => void current.refresh()} testID="my-offers-retry" />
          </View>
        ) : null}

        {tab === "offers" && offers.data ? (
          <View style={styles.stack}>
            {live.length === 0 ? <ScheduleEmptyCard title={t("scheduling.offers.noOffersTitle")} body={t("scheduling.offers.noOffersBody")} testID="my-offers-empty" /> : null}
            {live.map((offer) => (
              <ShiftCard key={offer.id} shift={offer.shift} zone={zone} language={language} testID={`offer-${offer.id}`}>
                {offer.expiresAt ? (
                  <Muted text={t("scheduling.offers.expires", { time: formatHotelTime(new Date(offer.expiresAt), zone, language) ?? "" })} />
                ) : null}
                <Muted text={t("scheduling.offers.notYet")} />
                <View style={styles.buttons}>
                  <View style={styles.cell}>
                    <Button label={t("scheduling.offers.accept")} onPress={() => confirmAccept(offer)} disabled={!isOnline || action.busy} testID={`offer-accept-${offer.id}`} />
                  </View>
                  <View style={styles.cell}>
                    <Button label={t("scheduling.offers.decline")} variant="secondary" onPress={() => void answer(offer, false)} disabled={!isOnline || action.busy} testID={`offer-decline-${offer.id}`} />
                  </View>
                </View>
              </ShiftCard>
            ))}
            {past.length > 0 ? (
              <>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.h2, { color: theme.textPrimary }]}>
                  {t("scheduling.offers.recent")}
                </Text>
                {past.map((offer) => (
                  <ShiftCard key={offer.id} shift={offer.shift} zone={zone} language={language} testID={`offer-past-${offer.id}`}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: offer.status === "accepted" ? theme.status.ready : theme.textSecondary }]}>
                      {t(`scheduling.offers.status.${offer.status}`)}
                    </Text>
                  </ShiftCard>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {tab === "open" && open.data ? (
          <View style={styles.stack}>
            {open.data.length === 0 ? <ScheduleEmptyCard title={t("scheduling.offers.noOpenTitle")} body={t("scheduling.offers.noOpenBody")} testID="my-open-empty" /> : null}
            {open.data.map((row) => (
              <ShiftCard key={row.shift.id} shift={row.shift} zone={zone} language={language} testID={`open-${row.shift.id}`}>
                {row.myClaimId ? (
                  <>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: theme.textPrimary }]}>
                      {t("scheduling.offers.status.claimPending")}
                    </Text>
                    <Button label={t("scheduling.offers.withdraw")} variant="secondary" onPress={() => void withdraw(row.myClaimId as string)} disabled={!isOnline || action.busy} testID={`open-withdraw-${row.shift.id}`} />
                  </>
                ) : row.canClaim ? (
                  <>
                    <Muted text={t("scheduling.offers.claimHint")} />
                    <Button label={t("scheduling.offers.claim")} onPress={() => void claim(row)} disabled={!isOnline || action.busy} testID={`open-claim-${row.shift.id}`} />
                  </>
                ) : (
                  <Muted text={t("scheduling.offers.cannotClaim")} testID={`open-blocked-${row.shift.id}`} />
                )}
              </ShiftCard>
            ))}
          </View>
        ) : null}

        {tab === "requests" && claims.data ? (
          <View style={styles.stack}>
            {claims.data.length === 0 ? <ScheduleEmptyCard title={t("scheduling.offers.noClaimsTitle")} body={t("scheduling.offers.noClaimsBody")} testID="my-claims-empty" /> : null}
            {claims.data.map((entry: MyClaim) => (
              <ShiftCard key={entry.id} shift={entry.shift} zone={zone} language={language} testID={`claim-${entry.id}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: entry.status === "approved" ? theme.status.ready : theme.textSecondary }]}>
                  {t(`scheduling.offers.claimStatus.${entry.status}`)}
                </Text>
                {entry.status === "pending" ? (
                  <Button label={t("scheduling.offers.withdraw")} variant="secondary" onPress={() => void withdraw(entry.id)} disabled={!isOnline || action.busy} testID={`claim-withdraw-${entry.id}`} />
                ) : null}
              </ShiftCard>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

function windowOf(shift: OfferedShift, zone: string | null, language?: string): string {
  return faceWindow({ userId: "", shiftId: shift.id, shiftName: shift.name, workDate: shift.workDate, startTime: shift.startTime, endTime: shift.endTime }, zone, language);
}

function ShiftCard({ shift, zone, language, testID, children }: { shift: OfferedShift; zone: string | null; language?: string; testID: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
        {formatLongDate(shift.workDate, language)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {[shift.name, windowOf(shift, zone, language)].filter(Boolean).join(" · ")}
      </Text>
      {shift.requiredRole ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
          {shift.requiredRole}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Muted({ text, testID }: { text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID={testID}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  stack: { gap: 12 },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: "800" },
  body: { fontSize: 14.5, lineHeight: 20, fontWeight: "600" },
  muted: { fontSize: 13, lineHeight: 18 },
  h2: { fontSize: 15, fontWeight: "700", marginTop: 6 },
  status: { fontSize: 14, fontWeight: "700" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { flexGrow: 1, minWidth: 130 },
});
