import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { getPartStock, listInventoryParts } from "@/lib/api/workOrders";
import { classifyLoadFailure } from "@/lib/engineering/loadState";
import {
  stagePart,
  stagedPartIssue,
  type ConsumedPartRow,
  type InventoryPart,
  type PartStockLocation,
  type StagedPart,
} from "@/lib/engineering/repairWorkspace";
import { ChoiceChips, FieldLabel, InlineError, LineInput, Note, TextArea, sheetStyles } from "./sheetKit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  /** Parts chosen so far. Nothing is deducted until the completion is accepted by the server. */
  parts: readonly StagedPart[];
  freeText: string;
  onChange: (next: { parts: StagedPart[]; freeText: string }) => void;
  /** Consumption the server has already recorded against this order. */
  recorded: readonly ConsumedPartRow[];
  canEdit: boolean;
}

/** Parts used, from the hotel's own inventory. This stages the selection; the server consumes it at completion. */
export function PartsSheet({ visible, onClose, online, parts, freeText, onChange, recorded, canEdit }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [inventory, setInventory] = useState<InventoryPart[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<"forbidden" | "failed" | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<InventoryPart | null>(null);
  const [stock, setStock] = useState<PartStockLocation[] | null>(null);
  const [stockFailed, setStockFailed] = useState(false);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const requested = useRef(0);

  useEffect(() => {
    if (!visible || !canEdit || inventory || !online) return;
    const mine = ++requested.current;
    listInventoryParts().then(
      (rows) => requested.current === mine && (setInventory(rows), setLoadFailed(null)),
      (err) => requested.current === mine && setLoadFailed(classifyLoadFailure(err) === "forbidden" ? "forbidden" : "failed")
    );
  }, [visible, canEdit, inventory, online]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = inventory ?? [];
    const found = needle ? rows.filter((p) => p.name.toLowerCase().includes(needle) || (p.sku ?? "").toLowerCase().includes(needle)) : rows;
    return found.slice(0, 12);
  }, [inventory, query]);

  function choose(part: InventoryPart) {
    setSelected(part);
    setStock(null);
    setStockFailed(false);
    setLocationId(null);
    setQuantity("1");
    getPartStock(part.id).then(
      (rows) => {
        const withStock = rows.filter((r) => Number(r.quantity) > 0);
        setStock(withStock);
        if (withStock.length === 1) setLocationId(withStock[0].location_id);
      },
      () => setStockFailed(true)
    );
  }

  const qty = Number(quantity.replace(",", "."));
  const location = stock?.find((s) => s.location_id === locationId);
  const draft: StagedPart | null =
    selected && location
      ? {
          partId: selected.id,
          name: selected.name,
          unit: selected.unit,
          locationId: location.location_id,
          locationName: location.engineering_part_locations?.name ?? null,
          quantity: qty,
          available: Number(location.quantity),
        }
      : null;
  const draftIssue = draft ? stagedPartIssue(draft) : null;

  function add() {
    if (!draft || draftIssue) return;
    onChange({ parts: stagePart(parts, draft), freeText });
    setSelected(null);
    setStock(null);
    setQuery("");
  }

  function remove(index: number) {
    onChange({ parts: parts.filter((_, i) => i !== index), freeText });
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("workOrders.repair.parts.title")}
      onClose={onClose}
      tall
      testID="wo-parts-sheet"
      footer={<Button label={t("workOrders.repair.parts.done")} onPress={onClose} size="lg" testID="wo-parts-done" />}
    >
      <View style={sheetStyles.stack}>
        {recorded.length > 0 ? (
          <>
            <FieldLabel>{t("workOrders.repair.parts.recorded")}</FieldLabel>
            {recorded.map((row) => (
              <Text key={row.id} style={{ color: theme.textPrimary, fontSize: 14 }}>
                {row.engineering_parts?.name ?? "—"} × {Math.abs(Number(row.quantity_delta))}
                {row.engineering_part_locations?.name ? `  ·  ${row.engineering_part_locations.name}` : ""}
              </Text>
            ))}
          </>
        ) : null}

        {canEdit ? (
          <>
            <FieldLabel>{t("workOrders.repair.parts.staged")}</FieldLabel>
            {parts.length === 0 ? (
              <Text style={{ color: theme.textDisabled, fontSize: 13.5 }}>{t("workOrders.repair.parts.none")}</Text>
            ) : (
              parts.map((part, index) => {
                const issue = stagedPartIssue(part);
                return (
                  <View key={`${part.partId}-${part.locationId}`} style={sheetStyles.row} testID={`wo-staged-part-${index}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textPrimary, fontSize: 14.5, fontWeight: "700" }}>
                        {part.name} × {part.quantity}
                        {part.unit ? ` ${part.unit}` : ""}
                      </Text>
                      <Text style={{ color: issue ? theme.status.dirty : theme.textMuted, fontSize: 12.5 }}>
                        {issue ? t(`workOrders.repair.parts.issue.${issue}`) : part.locationName ?? ""}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => remove(index)}
                      accessibilityRole="button"
                      accessibilityLabel={t("workOrders.repair.parts.remove", { name: part.name })}
                      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={theme.textMuted} />
                    </Pressable>
                  </View>
                );
              })
            )}
            <Note tone="warn">{t("workOrders.repair.parts.deductNote")}</Note>

            <FieldLabel>{t("workOrders.repair.parts.search")}</FieldLabel>
            <LineInput value={query} onChangeText={setQuery} placeholder={t("workOrders.repair.parts.searchPlaceholder")} editable={online} testID="wo-parts-search" accessibilityLabel={t("workOrders.repair.parts.search")} />
            {!online ? <Note>{t("workOrders.repair.parts.needsConnection")}</Note> : null}
            {loadFailed ? <InlineError>{t(loadFailed === "forbidden" ? "workOrders.repair.parts.forbidden" : "workOrders.repair.parts.loadFailed")}</InlineError> : null}
            {online && !inventory && !loadFailed ? <ActivityIndicator color={theme.primaryAction} /> : null}
            {!selected
              ? matches.map((part) => (
                  <Pressable
                    key={part.id}
                    onPress={() => choose(part)}
                    accessibilityRole="button"
                    accessibilityLabel={t("workOrders.repair.parts.pick", { name: part.name, count: part.total_on_hand })}
                    testID={`wo-part-${part.id}`}
                    style={{ minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: theme.borderSubtle }}
                  >
                    <Text style={{ color: theme.textPrimary, fontSize: 14.5 }}>{part.name}</Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>
                      {part.sku ? `${part.sku}  ·  ` : ""}
                      {t("workOrders.repair.parts.onHand", { count: part.total_on_hand })}
                    </Text>
                  </Pressable>
                ))
              : null}

            {selected ? (
              <View style={sheetStyles.stack}>
                <Text style={{ color: theme.textPrimary, fontSize: 15, fontWeight: "700" }}>{selected.name}</Text>
                {stockFailed ? <InlineError>{t("workOrders.repair.parts.stockFailed")}</InlineError> : null}
                {!stock && !stockFailed ? <ActivityIndicator color={theme.primaryAction} /> : null}
                {stock && stock.length === 0 ? <InlineError>{t("workOrders.repair.parts.outOfStock")}</InlineError> : null}
                {stock && stock.length > 0 ? (
                  <>
                    <FieldLabel required>{t("workOrders.repair.parts.location")}</FieldLabel>
                    <ChoiceChips
                      options={stock.map((s) => ({
                        value: s.location_id,
                        label: s.engineering_part_locations?.name ?? "—",
                        hint: t("workOrders.repair.parts.onHand", { count: Number(s.quantity) }),
                      }))}
                      value={locationId}
                      onChange={setLocationId}
                      testIDPrefix="wo-part-location"
                    />
                    <FieldLabel required>{t("workOrders.repair.parts.quantity")}</FieldLabel>
                    <LineInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" invalid={draftIssue != null} testID="wo-part-quantity" accessibilityLabel={t("workOrders.repair.parts.quantity")} />
                    {draftIssue && draftIssue !== "noLocation" ? <InlineError>{t(`workOrders.repair.parts.issue.${draftIssue}`)}</InlineError> : null}
                    <Button label={t("workOrders.repair.parts.add")} onPress={add} disabled={!draft || draftIssue != null} testID="wo-part-add" />
                  </>
                ) : null}
                <Button label={t("common.cancel")} variant="ghost" size="sm" onPress={() => setSelected(null)} />
              </View>
            ) : null}

            <FieldLabel>{t("workOrders.repair.parts.freeText")}</FieldLabel>
            <TextArea
              value={freeText}
              onChangeText={(text) => onChange({ parts: [...parts], freeText: text })}
              placeholder={t("workOrders.partsPlaceholder")}
              style={{ minHeight: 60 }}
              testID="parts-used"
              accessibilityLabel={t("workOrders.repair.parts.freeText")}
            />
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}
