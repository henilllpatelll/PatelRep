import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AssetEditor } from "@/components/engineering/assets/form/AssetEditor";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";
import { getAsset, type AssetDetail } from "@/lib/api/assets";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import { canManageAssets } from "@/lib/engineering/roles";
import { ASSETS_LIST_ROUTE, assetRoute } from "@/lib/engineering/routes";
import { useAppStore } from "@/stores/appStore";

type Loaded = { asset: AssetDetail } | { failure: LoadFailure; status: number | null } | null;

/** Engineering -> Assets -> Asset Detail -> More -> Edit Asset. Always edits a fresh read, so the version it saves against is current. */
export default function EditAssetScreen() {
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const role = user?.effective_role ?? user?.role;
  const id = typeof assetId === "string" ? assetId : "";

  // Hidden tab screens stay mounted: each visit re-reads the record and starts a clean form.
  const [visit, setVisit] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(null);
  useFocusEffect(
    useCallback(() => {
      setVisit((n) => n + 1);
    }, []),
  );
  useEffect(() => {
    if (!id || visit === 0) return;
    const abort = new AbortController();
    setLoaded(null);
    getAsset(id, abort.signal)
      .then((asset) => !abort.signal.aborted && setLoaded({ asset }))
      .catch((err) => {
        if (abort.signal.aborted) return;
        const status = (err as { status?: unknown } | null)?.status;
        setLoaded({ failure: classifyLoadFailure(err), status: typeof status === "number" ? status : null });
      });
    return () => abort.abort();
  }, [id, visit]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace((assetRoute(id) ?? ASSETS_LIST_ROUTE) as never);
  }, [id]);

  if (!canManageAssets(role)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + 8 }} testID="asset-form-forbidden">
        <StateBlock status="error" errorIcon="lock-closed-outline" errorMessage={t("engineeringState.forbidden")} onRetry={leave} retryLabel={t("common.back")} />
      </View>
    );
  }
  if (!loaded || "failure" in loaded) {
    const failure = loaded && "failure" in loaded ? loaded : null;
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + 8 }} testID="asset-form-state">
        {!failure ? (
          <StateBlock status="loading" />
        ) : failure.status === 404 ? (
          <StateBlock status="empty" emptyIcon="cube-outline" emptyTitle={t("assets.detail.unavailableTitle")} emptyBody={t("assets.detail.unavailableBody")} />
        ) : (
          <StateBlock
            status="error"
            errorIcon={failure.failure === "offline" || !isOnline ? "cloud-offline-outline" : undefined}
            errorMessage={failure.failure === "forbidden" ? t("engineeringState.forbidden") : failure.failure === "offline" || !isOnline ? t("assets.form.offlineEdit") : t("engineeringState.loadFailed")}
            onRetry={() => setVisit((n) => n + 1)}
            retryLabel={t("common.retry")}
          />
        )}
      </View>
    );
  }
  return <AssetEditor key={`${loaded.asset.id}:${visit}`} mode="edit" original={loaded.asset} onSaved={leave} onLeave={leave} />;
}
