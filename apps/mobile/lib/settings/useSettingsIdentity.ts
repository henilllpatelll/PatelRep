import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { displayNameFor } from "@/lib/settings/displayName";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

const KNOWN_ROLES = new Set([
  "housekeeper",
  "inspector",
  "engineer",
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
export function useSettingsIdentity() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user, isOnline, pendingActions } = useAppStore();
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
    if (!isOnline) return { color: theme.status.outOfOrder, text: t("settings.connection.offline") };
    if (pendingCount > 0) return { color: theme.status.pickup, text: t("settings.connection.syncing") };
    return { color: theme.status.ready, text: t("settings.connection.online") };
  }, [isOnline, pendingCount, t, theme]);

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
