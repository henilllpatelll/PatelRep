"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { engineeringApi, type Asset } from "@/lib/api/engineering";
import { roomsApi } from "@/lib/api/rooms";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EngineeringDrawer } from "@/components/engineering/EngineeringDrawer";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset?: Asset;
}
const empty = {
  name: "",
  category_id: "",
  room_id: "",
  location_text: "",
  asset_tag: "",
  manufacturer: "",
  model: "",
  serial_number: "",
  installation_date: "",
  purchase_date: "",
  warranty_expires: "",
  expected_lifespan_years: "",
  replacement_cost: "",
  notes: "",
};

export function CreateAssetModal({ isOpen, onClose, onSuccess, asset }: Props) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(empty);
  const [locationType, setLocationType] = useState<"room" | "area">("area");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useQuery({
    queryKey: ["asset-categories"],
    queryFn: engineeringApi.listAssetCategories,
    enabled: isOpen,
    staleTime: 300_000,
  });
  const rooms = useQuery({
    queryKey: ["rooms-picker"],
    queryFn: () => roomsApi.list(),
    enabled: isOpen,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!isOpen) return;
    setFields(
      asset
        ? {
            name: asset.name,
            category_id: asset.category_id,
            room_id: asset.room_id ?? "",
            location_text: asset.location_text ?? "",
            asset_tag: asset.asset_tag ?? "",
            manufacturer: asset.manufacturer ?? "",
            model: asset.model ?? "",
            serial_number: asset.serial_number ?? "",
            installation_date: asset.installation_date ?? "",
            purchase_date: asset.purchase_date ?? "",
            warranty_expires: asset.warranty_expires ?? "",
            expected_lifespan_years:
              asset.expected_lifespan_years?.toString() ?? "",
            replacement_cost: asset.replacement_cost?.toString() ?? "",
            notes: asset.notes ?? "",
          }
        : empty,
    );
    setLocationType(asset?.room_id ? "room" : "area");
    setError(null);
  }, [asset, isOpen]);

  function set(key: keyof typeof empty, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  async function save() {
    if (!fields.name.trim() || !fields.category_id) {
      setError(
        !fields.name.trim()
          ? t("engineering.assetsPage.createNameRequired")
          : t("engineering.assetsPage.categoryRequired"),
      );
      return;
    }
    const payload = {
      name: fields.name.trim(),
      category_id: fields.category_id,
      room_id:
        locationType === "room" ? fields.room_id || undefined : undefined,
      location_text:
        locationType === "area"
          ? fields.location_text.trim() || undefined
          : undefined,
      asset_tag: fields.asset_tag.trim() || undefined,
      manufacturer: fields.manufacturer.trim() || undefined,
      model: fields.model.trim() || undefined,
      serial_number: fields.serial_number.trim() || undefined,
      installation_date: fields.installation_date || undefined,
      purchase_date: fields.purchase_date || undefined,
      warranty_expires: fields.warranty_expires || undefined,
      expected_lifespan_years: fields.expected_lifespan_years
        ? Number(fields.expected_lifespan_years)
        : undefined,
      replacement_cost: fields.replacement_cost
        ? Number(fields.replacement_cost)
        : undefined,
      notes: fields.notes.trim() || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      if (asset) await engineeringApi.updateAsset(asset.id, payload);
      else await engineeringApi.createAsset(payload);
      onSuccess();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("engineering.assetsPage.createError"),
      );
    } finally {
      setSaving(false);
    }
  }
  const input = (label: string, key: keyof typeof empty, type = "text") => (
    <label>
      <span className="mb-1.5 block text-sm font-medium text-ink2">
        {label}
      </span>
      <Input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={fields[key]}
        onChange={(event) => set(key, event.target.value)}
      />
    </label>
  );

  return (
    <EngineeringDrawer
      open={isOpen}
      onClose={onClose}
      closeDisabled={saving}
      closeLabel={t("engineering.assetsPage.close")}
      title={
        asset
          ? t("engineering.assetsPage.editAsset")
          : t("engineering.assetsPage.addAsset")
      }
      width="wide"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("engineering.assetsPage.saving")}
              </>
            ) : (
              <>
                <Plus size={14} />
                {asset
                  ? t("engineering.assetsPage.saveChanges")
                  : t("engineering.assetsPage.addAsset")}
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
            {t("engineering.assetsPage.basics")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-ink2">
                {t("engineering.assetsPage.createNameLabel")} *
              </span>
              <Input
                value={fields.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder={t("engineering.assetsPage.createNamePlaceholder")}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium text-ink2">
                {t("engineering.assetsPage.category")} *
              </span>
              <select
                value={fields.category_id}
                onChange={(event) => set("category_id", event.target.value)}
                className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="">
                  {t("engineering.assetsPage.chooseCategory")}
                </option>
                {(categories.data?.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {input(t("engineering.assetsPage.assetTag"), "asset_tag")}
          </div>
        </section>
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
            {t("engineering.assetsPage.location")}
          </p>
          <div className="mt-3">
            <div
              className="mb-3 flex gap-2"
              role="group"
              aria-label={t("engineering.assetsPage.locationType")}
            >
              {(["room", "area"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={locationType === type}
                  onClick={() => setLocationType(type)}
                  className={`rounded-[var(--r-sm)] border px-3 py-2 text-sm font-medium ${locationType === type ? "border-accent bg-accent-soft text-accent" : "border-line text-ink2"}`}
                >
                  {t(
                    `engineering.assetsPage.location${type === "room" ? "Room" : "Area"}`,
                  )}
                </button>
              ))}
            </div>
            {locationType === "room" ? (
              <select
                value={fields.room_id}
                onChange={(event) => set("room_id", event.target.value)}
                className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="">
                  {t("engineering.assetsPage.chooseRoom")}
                </option>
                {((rooms.data as any)?.data ?? []).map((room: any) => (
                  <option key={room.room_id} value={room.room_id}>
                    {room.rooms?.room_number
                      ? `${t("engineering.workOrderCard.room")} ${room.rooms.room_number}`
                      : room.room_id}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={fields.location_text}
                onChange={(event) => set("location_text", event.target.value)}
                placeholder={t(
                  "engineering.assetsPage.createLocationPlaceholder",
                )}
              />
            )}
          </div>
        </section>
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
            {t("engineering.assetsPage.equipment")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {input(t("engineering.assetsPage.manufacturer"), "manufacturer")}
            {input(t("engineering.assetsPage.model"), "model")}
            <div className="sm:col-span-2">
              {input(t("engineering.assetsPage.serialNumber"), "serial_number")}
            </div>
          </div>
        </section>
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
            {t("engineering.assetsPage.lifecycle")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {input(
              t("engineering.assetsPage.installationDate"),
              "installation_date",
              "date",
            )}
            {input(
              t("engineering.assetsPage.purchaseDate"),
              "purchase_date",
              "date",
            )}
            {input(
              t("engineering.assetsPage.fieldLifespan"),
              "expected_lifespan_years",
              "number",
            )}
            {input(
              t("engineering.assetsPage.fieldReplacementCost"),
              "replacement_cost",
              "number",
            )}
          </div>
        </section>
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
            {t("engineering.assetsPage.warranty")}
          </p>
          <div className="mt-3">
            {input(
              t("engineering.assetsPage.createWarrantyExpiresLabel"),
              "warranty_expires",
              "date",
            )}
          </div>
        </section>
        <section>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
              {t("engineering.assetsPage.notes")}
            </span>
            <textarea
              value={fields.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
              className="mt-3 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        </section>
        {error && (
          <p className="flex gap-2 rounded-[var(--r-sm)] border border-alert-line bg-alert-soft p-3 text-sm text-alert">
            <AlertTriangle size={15} />
            {error}
          </p>
        )}
      </div>
    </EngineeringDrawer>
  );
}
