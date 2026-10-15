import { useMemo } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useTranslation } from "react-i18next";
import { useSyncOverview } from "@/lib/offline/useSyncOverview";
import { buildDiagnostics, type DiagnosticEntry } from "@/lib/support/diagnostics";
import { useAppStore } from "@/stores/appStore";

/** Built only while a support screen is open; nothing is collected in the background. */
export function useDiagnostics(): { entries: DiagnosticEntry[]; ready: boolean } {
  const { i18n } = useTranslation();
  const user = useAppStore((s) => s.user);
  const { overview } = useSyncOverview();
  const build = Platform.OS === "ios" ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode;
  const role = user?.effective_role ?? user?.role ?? null;

  const entries = useMemo(
    () =>
      buildDiagnostics({
        appVersion: Constants.expoConfig?.version ?? null,
        build: build ?? null,
        platform: Platform.OS,
        osVersion: Platform.Version,
        role,
        language: i18n.language,
        online: overview.online,
        // Sync facts are only included once the queues were really read; an unread queue is not "0".
        lastSyncedAt: overview.lastSyncedAt,
        pending: overview.reliable ? overview.pending : null,
        failed: overview.reliable ? overview.attention : null,
        syncStatus: overview.status,
      }),
    [build, role, i18n.language, overview],
  );
  return { entries, ready: overview.reliable };
}
