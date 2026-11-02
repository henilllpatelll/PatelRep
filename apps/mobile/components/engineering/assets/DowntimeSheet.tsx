import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ChoiceChips, FieldLabel, InlineError, Note, TextArea } from "@/components/engineering/workorder/sheetKit";
import { restoreAssetDowntime, startAssetDowntime, type AssetDowntime } from "@/lib/api/assets";
import { classifyManagementFailure, type ManagementFailure } from "@/lib/engineering/pmManagement";
import { formatDayTime } from "@/lib/engineering/assetFormat";
import { useTheme } from "@/lib/theme/useTheme";

type Impact = "degraded" | "out_of_service";
type Kind = "unplanned" | "planned";

interface Props {
  visible: boolean;
  asset: { id: string; name: string; activeDowntime: AssetDowntime | null };
  /** This asset's active repairs, offered as an optional link. Linking records the relationship only; it closes nothing. */
  repairs?: readonly { id: string; label: string }[];
  timezone: string | null | undefined;
  language: string;
  isOnline: boolean;
  onClose: () => void;
  /** The server confirmed. `started` / `ended` tell the screen which toast to show. */
  onDone: (result: "started" | "ended" | "already_open") => void;
  onNeedsRefresh?: () => void;
}

/**
 * Record or end downtime. The time and the person are stamped by the server, so neither can be mistyped, and an end can
 * never precede its start. This changes the equipment's recorded service condition only: it does NOT take guest rooms out
 * of order, close a work order or mark anything repaired - those are separate, authorised actions.
 */
export function DowntimeSheet({ visible, asset, repairs = [], timezone, language, isOnline, onClose, onDone, onNeedsRefresh }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const open = asset.activeDowntime;
  const [kind, setKind] = useState<Kind>("unplanned");
  const [impact, setImpact] = useState<Impact>("out_of_service");
  const [notes, setNotes] = useState("");
  const [linked, setLinked] = useState("none");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setKind("unplanned");
    setImpact("out_of_service");
    setNotes("");
    setLinked("none");
    setFailure(null);
  }, [visible, asset.id, open?.id]);

  const submit = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      if (open) {
        await restoreAssetDowntime(asset.id, open.id, notes);
        onDone("ended");
      } else {
        const res = await startAssetDowntime(asset.id, { downtimeType: kind, impactLevel: impact, notes, workOrderId: linked === "none" ? null : linked });
        onDone(res.created ? "started" : "already_open");
      }
      onClose();
    } catch (err) {
      const classified = classifyManagementFailure(err);
      setFailure(classified);
      if (classified.kind === "not_found") onNeedsRefresh?.();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const since = open ? formatDayTime(open.started_at, timezone, language) : null;
  return (
    <BottomSheet
      visible={visible}
      title={open ? t("assets.downtime.endTitle") : t("assets.downtime.startTitle")}
      onClose={busy ? () => undefined : onClose}
      testID="asset-downtime-sheet"
      footer={<Button label={open ? t("assets.downtime.end") : t("assets.downtime.start")} onPress={() => void submit()} loading={busy} disabled={busy || !isOnline} size="lg" testID="asset-downtime-submit" />}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {open ? t("assets.downtime.endBody", { name: asset.name, since: since ?? "" }) : t("assets.downtime.startBody", { name: asset.name })}
      </Text>
      {!open ? (
        <>
          <FieldLabel>{t("assets.downtime.impact")}</FieldLabel>
          <ChoiceChips<Impact>
            value={impact}
            onChange={setImpact}
            testIDPrefix="asset-downtime-impact"
            options={[
              { value: "out_of_service", label: t("assets.history.impact.out_of_service") },
              { value: "degraded", label: t("assets.history.impact.degraded") },
            ]}
          />
          <FieldLabel>{t("assets.downtime.kind")}</FieldLabel>
          <ChoiceChips<Kind>
            value={kind}
            onChange={setKind}
            testIDPrefix="asset-downtime-kind"
            options={[
              { value: "unplanned", label: t("assets.history.type.unplanned") },
              { value: "planned", label: t("assets.history.type.planned") },
            ]}
          />
          {repairs.length > 0 ? (
            <>
              <FieldLabel>{t("assets.downtime.linkRepair")}</FieldLabel>
              <ChoiceChips<string>
                value={linked}
                onChange={setLinked}
                testIDPrefix="asset-downtime-repair"
                options={[{ value: "none", label: t("assets.downtime.noRepair") }, ...repairs.slice(0, 4).map((r) => ({ value: r.id, label: r.label }))]}
              />
            </>
          ) : null}
        </>
      ) : null}
      <FieldLabel>{open ? t("assets.downtime.endNotes") : t("assets.downtime.notes")}</FieldLabel>
      <TextArea value={notes} onChangeText={setNotes} maxLength={500} placeholder={t("assets.downtime.notesPlaceholder")} accessibilityLabel={t("assets.downtime.notes")} testID="asset-downtime-notes" />
      <Note testID="asset-downtime-scope">{open ? t("assets.downtime.endScope") : t("assets.downtime.startScope")}</Note>
      {!isOnline ? <Note tone="warn">{t("pmMgmt.needsConnection")}</Note> : null}
      {failure ? <InlineError testID="asset-downtime-error">{t(`pmMgmt.failure.${failure.kind}`)}</InlineError> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
});
