import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { assetQuickActions, type AssetQuickAction, type AssetRow } from "@/lib/engineering/assetModel";
import { assetLabelRoute, assetRoute, assetSectionRoute } from "@/lib/engineering/routes";

interface Props {
  /** The directory row the actions are for; null closes the sheet. */
  row: AssetRow | null;
  isOnline: boolean;
  canRecordReading: boolean;
  onClose: () => void;
}

const ICON: Record<AssetQuickAction, React.ComponentProps<typeof Ionicons>["name"]> = {
  open: "cube-outline",
  report: "construct-outline",
  reading: "speedometer-outline",
  maintenance: "calendar-outline",
  label: "qr-code-outline",
};

/** Where an action goes. Every destination is an existing screen that reads the record itself under the person's own role. */
function destination(action: AssetQuickAction, row: AssetRow) {
  switch (action) {
    case "open":
      return assetRoute(row.id);
    case "reading":
      return assetSectionRoute(row.id, "readings");
    case "maintenance":
      return assetSectionRoute(row.id, "maintenance");
    case "label":
      return assetLabelRoute(row.id);
    case "report":
      // The same pre-filled report the equipment screen opens: linked to this asset, its room as the location.
      return {
        pathname: "/(app)/work-orders/new",
        params: {
          from: "asset",
          assetId: row.id,
          assetName: row.name,
          assetCategory: row.asset_categories?.code ?? "",
          assetLocation: row.location_text ?? "",
          assetRoomId: row.room_id ?? "",
          assetRoomNumber: row.rooms?.room_number ?? "",
        },
      };
  }
}

/**
 * Shortcuts from a directory card. Nothing here changes data: each action opens the screen where it is done, so the
 * confirmation, permission check and result all happen there. Reporting needs the network because creating does.
 */
export function AssetQuickActionsSheet({ row, isOnline, canRecordReading, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const items = row ? assetQuickActions(row, { isOnline, canRecordReading }) : [];

  return (
    <BottomSheet visible={!!row} title={row?.name ?? t("assets.actions.title")} onClose={onClose} testID="asset-quick-sheet">
      {row
        ? items.map(({ action, disabled }) => {
            const target = destination(action, row);
            const blocked = disabled || !target;
            return (
              <Pressable
                key={action}
                disabled={blocked}
                onPress={() => {
                  onClose();
                  if (target) router.push(target as never);
                }}
                accessibilityRole="button"
                accessibilityState={{ disabled: blocked }}
                accessibilityLabel={t(`assets.actions.${action}`)}
                accessibilityHint={action === "report" && disabled ? t("assets.actions.reportOffline") : undefined}
                style={[styles.row, { borderColor: theme.borderSubtle, opacity: blocked ? 0.45 : 1 }]}
                testID={`asset-quick-${action}`}
              >
                <Ionicons name={ICON[action]} size={20} color={theme.textMuted} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textPrimary }]}>
                  {t(`assets.actions.${action}`)}
                </Text>
                {action === "report" && disabled ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
                    {t("assets.actions.reportOffline")}
                  </Text>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
                )}
              </Pressable>
            );
          })
        : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1 },
  label: { flex: 1, fontSize: 15, fontWeight: "600" },
  note: { flexShrink: 1, maxWidth: "45%", fontSize: 12, textAlign: "right" },
});
