import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { EngineeringSegmented } from "@/components/engineering/EngineeringSegmented";
import { PM_PLAN_MODES, type PmPlanMode } from "@/lib/engineering/pmViews";
import { PmCalendarView } from "./PmCalendarView";
import type { PmListProps } from "./PmTodayView";
import { PmWeekView } from "./PmWeekView";

interface Props extends PmListProps {
  today: string;
  mode: PmPlanMode;
  onModeChange: (mode: PmPlanMode) => void;
}

/** Plan: Week | Calendar over the same real schedule dates. */
export function PmPlanView({ mode, onModeChange, ...rest }: Props) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 14 }} testID="pm-plan">
      <EngineeringSegmented
        compact
        options={PM_PLAN_MODES.map((key) => ({ key, label: t(`pm.plan.${key}`), testID: `pm-plan-${key}` }))}
        value={mode}
        onChange={onModeChange}
        accessibilityLabel={t("pm.views.plan")}
      />
      {mode === "week" ? <PmWeekView {...rest} /> : <PmCalendarView {...rest} />}
    </View>
  );
}
