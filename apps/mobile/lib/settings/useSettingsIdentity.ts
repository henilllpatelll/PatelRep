import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { displayNameFor } from "@/lib/settings/displayName";
import type { SyncOverview } from "@/lib/offline/syncOverview";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

const KNOWN_ROLES = new Set([
  "housekeeper",
  "inspector",
  "engineer",
  "chief_engineer",
  "housekeeping_supervisor",
  "front_desk",
  "gm",
]);

function fallbackRoleLabel(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Who is signed in, where they work, and whether their work is synced — shared by every Settings screen. */
/** `overview` (from useSyncOverview) makes the connection chip reflect every queue, not just the action queue. */
export function useSettingsIdentity(overview?: SyncOverview) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const pendingActions = useAppStore((s) => s.pendingActions);
  const [hotelName, setHotelName] = useState<string | null>(null);
  const pendingCount = pendingActions.length;

  useEffect(() => {
    if (!user?.tenant_id) return;
    let mounted = true;
    api
      .get<{ data: { name: string } }>(`/hotels/${user.tenant_id}`)
      .then((res) => {
        if (mounted && res.data?.name) setHotelName(res.data.name);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [user?.tenant_id]);

  const role = user?.effective_role ?? user?.role ?? null;
  const roleLabel = role ? (KNOWN_ROLES.has(role) ? t(`staff.roles.${role}`) : fallbackRoleLabel(role)) : null;

  const connection = useMemo(() => {
    if (overview) {
      if (overview.attention > 0) return { color: theme.status.dirty, text: t("settings.connection.attention", { count: overview.attention }) };
      if (overview.status === "syncing") return { color: theme.status.pickup, text: t("settings.connection.syncing") };
      if (!overview.online) {
        return { color: theme.status.outOfOrder, text: overview.pending > 0 ? t("settings.connection.offlinePending", { count: overview.pending }) : t("settings.connection.offline") };
      }
      if (overview.pending > 0) return { color: theme.status.pickup, text: t("settings.connection.pending", { count: overview.pending }) };
      return { color: overview.reliable ? theme.status.ready : theme.textMuted, text: overview.reliable ? t("settings.connection.onlineSynced") : t("settings.connection.online") };
    }
    if (!isOnline) return { color: theme.status.outOfOrder, text: t("settings.connection.offline") };
    if (pendingCount > 0) return { color: theme.status.pickup, text: t("settings.connection.syncing") };
    return { color: theme.status.ready, text: t("settings.connection.online") };
  }, [overview, isOnline, pendingCount, t, theme]);

  return {
    user,
    name: displayNameFor(user) || t("settings.staffFallback"),
    role,
    roleLabel,
    hotelName,
    isOnline,
    pendingCount,
    connection,
  };
}
