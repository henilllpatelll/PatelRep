import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { localDate } from "@/lib/utils/date";
import { useAppStore } from "@/stores/appStore";
import { displayNameFor } from "@/lib/settings/displayName";
import { R } from "@/components/shared/tokens";
import { Avatar, IconButton } from "@/components/shared/mobileHandoff";
import { HousekeeperHome } from "@/components/home/HousekeeperHomeScreen";
import { SupervisorHome } from "@/components/home/SupervisorHome";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { isEngineeringRole } from "@/lib/engineering/roles";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

export default function HousekeeperHomeScreen() {
  const user = useAppStore((state) => state.user);
  const effectiveRole = user?.effective_role ?? user?.role;

  if (isEngineeringRole(effectiveRole)) {
    return <EngineerHome name={displayNameFor(user) || "Engineer"} />;
  }
  if (effectiveRole === "housekeeping_supervisor") {
    return <SupervisorHome name={displayNameFor(user)} />;
  }
  if (effectiveRole === "front_desk") {
    return <FrontDeskHomeScreen name={displayNameFor(user) || "Front Desk"} />;
  }
  if (effectiveRole === "gm") {
    return <GMHomeScreen name={displayNameFor(user) || "GM"} />;
  }
  return <HousekeeperHome enabled={effectiveRole === "housekeeper"} />;
}

function FrontDeskHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ newReq: "—", inProgress: "—", resolved: "—" });

  useEffect(() => {
    if (!isOnline) return;
    api
      .get<{ data: Array<{ status: string }> }>("/guest-requests?per_page=200")
      .then((res) => {
        const requests = res.data;
        setStats({
          newReq: String(requests.filter((r) => r.status === "open").length),
          inProgress: String(requests.filter((r) => r.status === "in_progress").length),
          resolved: String(requests.filter((r) => r.status === "resolved").length),
        });
      })
      .catch(console.warn);
  }, [isOnline]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{t("home.frontDesk.shiftMeta")}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("home.frontDesk.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.newReq, label: t("home.frontDesk.newRequests"), color: theme.status.clean },
            { value: stats.inProgress, label: t("home.frontDesk.inProgress"), color: theme.status.pickup },
            { value: stats.resolved, label: t("home.frontDesk.resolvedToday"), color: theme.status.ready },
          ].map((stat) => (
            <Card key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
              <Text style={[styles.engineerStatLabel, { color: theme.textMuted }]}>{stat.label}</Text>
            </Card>
          ))}
        </View>
        <StateBlock
          status="empty"
          emptyIcon="chatbubbles-outline"
          emptyTitle={t("home.frontDesk.requestsTitle")}
          emptyBody={t("home.frontDesk.requestsHint")}
          style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
        />
      </ScrollView>
    </View>
  );
}

function GMHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ cleanPct: "—", openWOs: "—", newRequests: "—" });

  useEffect(() => {
    if (!isOnline) return;
    Promise.all([
      api.get<{ data: Array<{ status: string }> }>(`/housekeeping/board?date=${localDate()}`),
      api.get<{ data: Array<{ status: string }> }>("/work-orders?status=open&per_page=200"),
      api.get<{ data: Array<{ status: string }> }>("/guest-requests?status=open&per_page=200"),
    ])
      .then(([boardRes, woRes, grRes]) => {
        const rooms = boardRes.data;
        const cleanCount = rooms.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length;
        const cleanPct = rooms.length > 0 ? Math.round((cleanCount / rooms.length) * 100) : 0;
        setStats({
          cleanPct: `${cleanPct}%`,
          openWOs: String(woRes.data.length),
          newRequests: String(grRes.data.length),
        });
      })
      .catch(console.warn);
  }, [isOnline]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{t("home.gm.shiftMeta")}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("home.gm.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.cleanPct, label: t("home.gm.roomsClean") },
            { value: stats.openWOs, label: t("home.gm.openWOs"), color: theme.status.pickup },
            { value: stats.newRequests, label: t("home.gm.guestRequests"), color: theme.status.clean },
          ].map((stat) => (
            <Card key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, { color: stat.color ?? theme.textPrimary }]}>{stat.value}</Text>
              <Text style={[styles.engineerStatLabel, { color: theme.textMuted }]}>{stat.label}</Text>
            </Card>
          ))}
        </View>
        <StateBlock
          status="empty"
          emptyIcon="notifications-outline"
          emptyTitle={t("home.gm.alertsTitle")}
          emptyBody={t("home.gm.alertsHint")}
          style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  headerMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: "600",
    lineHeight: 34,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 13,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: R.lg,
    padding: 16,
  },
  engineerStats: {
    flexDirection: "row",
    gap: 9,
  },
  engineerStat: {
    flex: 1,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  engineerStatValue: {
    fontSize: 26,
    lineHeight: 28,
  },
  engineerStatLabel: {
    fontSize: 11,
    marginTop: 5,
  },
});
