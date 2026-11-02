import { useCallback, useMemo, useRef, useState } from "react";
import { createAsset, getAsset, removeAssetPhoto, updateAsset, type AssetCategory, type AssetDetail } from "@/lib/api/assets";
import { uploadAssetPhoto } from "@/lib/api/assetPhoto";
import {
  assetFormChanged,
  buildCreateBody,
  buildUpdateBody,
  classifySaveFailure,
  EMPTY_ASSET_FORM,
  formFromAsset,
  mergeSavedAsset,
  registrationStarted,
  validateAssetForm,
  type AssetFormErrors,
  type AssetFormValues,
  type SaveFailure,
} from "@/lib/engineering/assetForm";
import { newClientRequestId } from "@/lib/engineering/requestId";
import { markAssetListStale } from "@/lib/engineering/useAssetBrowse";
import { primeAsyncResource } from "@/lib/engineering/useAsyncResource";
import { prepareForUpload } from "@/lib/housekeeping/photo";

/** What the person has done to the equipment photograph in this form. Nothing is uploaded until Save. */
export type PhotoChange = { kind: "keep" } | { kind: "new"; uri: string } | { kind: "remove" };

interface Options {
  mode: "create" | "edit";
  scope: string | null;
  /** Edit only: the record as loaded from the server for this editing session. */
  original?: AssetDetail | null;
  categories: readonly AssetCategory[];
  /** Called once, after the server has confirmed everything that was asked for. */
  onSaved: (asset: AssetDetail) => void;
}

export type EditorPhase = "idle" | "saving" | "photo";

/**
 * The Register / Edit equipment lifecycle.
 *
 * Registration: the form generates one record id up front and sends it with every attempt, so a request whose answer
 * never arrived can simply be sent again - the server returns the record it already made, never a second. The photo is
 * a separate step after the record exists; if it fails the equipment IS registered and the person is told exactly that,
 * and retrying the photo never registers anything again.
 *
 * Editing: the save carries the version the person loaded. A stale version is refused by the server; the person then
 * chooses between the latest record and re-applying their own changes on top of it. Only changed fields are sent.
 */
export function useAssetEditor({ mode, scope, original = null, categories, onSaved }: Options) {
  const [seed] = useState(() => (mode === "edit" && original ? formFromAsset(original) : EMPTY_ASSET_FORM));
  const [values, setValues] = useState<AssetFormValues>(seed);
  const [photo, setPhoto] = useState<PhotoChange>({ kind: "keep" });
  const [errors, setErrors] = useState<AssetFormErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhase] = useState<EditorPhase>("idle");
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** The save went through but the photo step did not. */
  const [photoFailed, setPhotoFailed] = useState(false);
  /** Registration only: the equipment now exists on the server. */
  const [registered, setRegistered] = useState<AssetDetail | null>(null);

  const recordId = useRef(newClientRequestId());
  const busy = useRef(false);
  const baseline = useRef<AssetFormValues>(seed);
  const version = useRef<number | null>(original?.row_version ?? null);
  const current = useRef<AssetDetail | null>(original);
  const saved = useRef<AssetDetail | null>(null);

  const update = useCallback((patch: Partial<AssetFormValues>) => {
    setValues((prev) => ({ ...prev, ...patch }));
    setFailure((prev) => (prev && prev.kind !== "conflict" ? null : prev));
    setErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      if ("name" in patch) delete next.name;
      if ("categoryId" in patch) delete next.categoryId;
      if ("assetTag" in patch) delete next.assetTag;
      if ("location" in patch || "locationNote" in patch) delete next.location;
      if ("installationDate" in patch) delete next.installationDate;
      if ("warrantyExpires" in patch) delete next.warrantyExpires;
      if ("notes" in patch) delete next.notes;
      for (const key of ["manufacturer", "model", "serialNumber"] as const) if (key in patch) delete next[key];
      return next;
    });
  }, []);

  const dirty = useMemo(
    () => (mode === "create" ? registrationStarted(values) || photo.kind === "new" : assetFormChanged(baseline.current, values) || photo.kind !== "keep"),
    [mode, values, photo],
  );

  const finish = useCallback(
    (asset: AssetDetail) => {
      markAssetListStale();
      if (mode === "edit" && current.current) {
        primeAsyncResource(scope, `asset:${asset.id}`, mergeSavedAsset(current.current, asset, values, categories));
      }
      onSaved(asset);
    },
    [categories, mode, onSaved, scope, values],
  );

  /** The photograph step, shared by registration and editing. Returns the record after it, or null when it failed. */
  const runPhoto = useCallback(
    async (asset: AssetDetail): Promise<AssetDetail | null> => {
      if (photo.kind === "keep") return asset;
      setPhase("photo");
      try {
        if (photo.kind === "remove") return await removeAssetPhoto(asset.id);
        const uri = await prepareForUpload(photo.uri);
        return await uploadAssetPhoto({ assetId: asset.id, uri, expectedRowVersion: version.current ?? asset.row_version });
      } catch (err) {
        setPhotoFailed(true);
        setFailure(classifySaveFailure(err));
        return null;
      }
    },
    [photo],
  );

  const submit = useCallback(async () => {
    if (busy.current) return;
    const found = validateAssetForm(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setShowErrors(true);
      return;
    }
    busy.current = true;
    setPhase("saving");
    setFailure(null);
    setPhotoFailed(false);
    try {
      if (mode === "create") {
        let asset = saved.current;
        if (!asset) {
          asset = await createAsset(buildCreateBody(values, recordId.current));
          saved.current = asset;
          setRegistered(asset);
        }
        const withPhoto = await runPhoto(asset);
        if (!withPhoto) return;
        saved.current = withPhoto;
        return finish(withPhoto);
      }

      const target = current.current;
      if (!target) return;
      let asset: AssetDetail = target;
      const body = buildUpdateBody(baseline.current, values, version.current);
      if (body) {
        asset = await updateAsset(target.id, body);
        // The edit is now on the server: later steps and retries start from it, never from the old record.
        baseline.current = values;
        version.current = asset.row_version ?? null;
      }
      const withPhoto = await runPhoto(asset);
      if (!withPhoto) return;
      return finish(withPhoto);
    } catch (err) {
      const reason = classifySaveFailure(err);
      setFailure(reason);
      if (reason.kind === "tag_in_use") {
        setErrors((prev) => ({ ...prev, assetTag: "tag_in_use" }));
        setShowErrors(true);
      }
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }, [finish, mode, runPhoto, values]);

  /** Re-reads the record behind a conflict. Either shows the latest (discarding edits) or keeps the person's edits on top of it. */
  const resolveConflict = useCallback(
    async (choice: "latest" | "mine") => {
      const id = current.current?.id;
      if (!id || busy.current) return;
      busy.current = true;
      try {
        const latest = await getAsset(id);
        current.current = latest;
        version.current = latest.row_version ?? null;
        if (choice === "latest") {
          const fresh = formFromAsset(latest);
          baseline.current = fresh;
          setValues(fresh);
          setPhoto({ kind: "keep" });
        }
        setFailure(null);
      } catch (err) {
        setFailure(classifySaveFailure(err));
      } finally {
        busy.current = false;
      }
    },
    [],
  );

  /** Registration whose photo failed: skip it and open the (already registered) equipment. */
  const skipPhoto = useCallback(() => {
    const asset = saved.current;
    if (asset) finish(asset);
  }, [finish]);

  return {
    values,
    update,
    photo,
    setPhoto,
    errors,
    showErrors,
    phase,
    saving: phase !== "idle",
    failure,
    photoFailed,
    registered,
    dirty,
    submit,
    resolveConflict,
    skipPhoto,
    dismissFailure: () => setFailure(null),
  };
}
