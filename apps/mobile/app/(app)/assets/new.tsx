import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AssetEditor } from "@/components/engineering/assets/form/AssetEditor";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";
import type { AssetDetail } from "@/lib/api/assets";
import { canManageAssets } from "@/lib/engineering/roles";
import { ASSETS_LIST_ROUTE, assetRoute } from "@/lib/engineering/routes";
import { useAppStore } from "@/stores/appStore";

/** Engineering -> Assets -> Add Asset. A full-screen form; on success it opens the new equipment's own page. */
export default function RegisterAssetScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const role = user?.effective_role ?? user?.role;

  // Hidden tab screens stay mounted: every visit gets a blank form (and a new record id), never the previous one.
  const [visit, setVisit] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVisit((n) => n + 1);
    }, []),
  );

  const leave = useCallback(() => (router.canGoBack() ? router.back() : router.replace(ASSETS_LIST_ROUTE as never)), []);
  const saved = useCallback((asset: AssetDetail) => {
    const target = assetRoute(asset.id);
    router.replace((target ?? ASSETS_LIST_ROUTE) as never);
  }, []);

  if (!canManageAssets(role)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + 8 }} testID="asset-form-forbidden">
        <StateBlock status="error" errorIcon="lock-closed-outline" errorMessage={t("engineeringState.forbidden")} onRetry={leave} retryLabel={t("common.back")} />
      </View>
    );
  }
  return <AssetEditor key={visit} mode="create" onSaved={saved} onLeave={leave} />;
}
