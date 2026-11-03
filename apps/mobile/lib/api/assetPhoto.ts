import { api } from "./client";
import { setAssetPhoto, type AssetDetail } from "./assets";
import { deletePmEvidence } from "./pm";

/**
 * Uploads a photo for one piece of equipment and makes it that equipment's identity photograph.
 *
 * Three steps, each failing cleanly: (1) an evidence record is created for the asset, (2) the file is uploaded to the
 * private evidence bucket, (3) the server attaches it as the identity photo (and removes the previous one). If step 2
 * fails the empty record is removed; if step 3 fails the uploaded file is removed. Either way a failed attempt leaves
 * nothing behind, and the asset record itself is never touched until step 3 succeeds. Inspection photos are separate
 * evidence records and are never read or replaced here.
 */
export async function uploadAssetPhoto(input: { assetId: string; uri: string; expectedRowVersion?: number | null; signal?: AbortSignal }): Promise<AssetDetail> {
  const created = await api.post<{ data: { id: string } }>(
    "/evidence/records",
    { label: "Equipment photo", evidence_type: "photo", related_entity_type: "asset", related_entity_id: input.assetId },
    { signal: input.signal },
  );
  const evidenceId = created.data.id;
  try {
    const form = new FormData();
    form.append("file", { uri: input.uri, type: "image/jpeg", name: `asset_${Date.now()}.jpg` } as unknown as Blob);
    await api.postForm(`/evidence/records/${evidenceId}/file`, form, { signal: input.signal });
    return await setAssetPhoto(input.assetId, evidenceId, input.expectedRowVersion);
  } catch (err) {
    await deletePmEvidence(evidenceId);
    throw err;
  }
}
