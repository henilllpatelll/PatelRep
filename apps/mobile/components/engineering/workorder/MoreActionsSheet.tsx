import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";
import type { RepairActions } from "@/lib/engineering/repairWorkspace";

export type MoreAction = "note" | "evidence" | "hold" | "escalate" | "resumeWork";

interface Props {
  visible: boolean;
  onClose: () => void;
  actions: RepairActions;
  online: boolean;
  onPick: (action: MoreAction) => void;
}

const ROWS: { id: MoreAction; gate: keyof RepairActions["can"]; icon: ComponentProps<typeof Ionicons>["name"]; destructive?: boolean }[] = [
  { id: "note", gate: "note", icon: "create-outline" },
  { id: "evidence", gate: "evidence", icon: "camera-outline" },
  { id: "resumeWork", gate: "resumeWork", icon: "play-outline" },
  { id: "hold", gate: "hold", icon: "pause-outline" },
  { id: "escalate", gate: "escalate", icon: "alert-circle-outline", destructive: true },
];

/** The less-used actions. Only those the state machine allows are listed, so nothing here is a dead end. */
export function MoreActionsSheet({ visible, onClose, actions, online, onPick }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rows = ROWS.filter((row) => actions.can[row.gate]);
  return (
    <BottomSheet visible={visible} title={t("workOrders.repair.more.title")} onClose={onClose} testID="wo-more-sheet">
      <View>
        {rows.length === 0 ? <Text style={{ color: theme.textMuted }}>{t("workOrders.repair.more.none")}</Text> : null}
        {rows.map((row) => {
          const needsOnline = row.id !== "evidence";
          const disabled = needsOnline && !online;
          return (
            <Pressable
              key={row.id}
              onPress={() => onPick(row.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              testID={`wo-more-${row.id}`}
              style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: theme.borderSubtle, opacity: disabled ? 0.5 : 1 }}
            >
              <Ionicons name={row.icon} size={20} color={row.destructive ? theme.status.dirty : theme.textSecondary} />
              <Text style={{ flex: 1, color: row.destructive ? theme.status.dirty : theme.textPrimary, fontSize: 15 }}>{t(`workOrders.repair.more.${row.id}`)}</Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}
