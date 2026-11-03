/* ─── Equipment QR label ────────────────────────────────────────────────────
   The label encodes ONE thing: the versioned asset payload from assetQr.ts (`patelrep:asset:v1:<asset-uuid>`). No
   credentials, no user ids, no property details. A scan is only a lookup key - the scanner resolves it through the
   signed-in person's own property, so a label never authorises anything and a photo of one is worthless elsewhere.

   The human-readable tag is printed beside the code so a damaged or unscannable label can still be typed in. */

import qrcode from "qrcode-generator";
import { buildAssetQrPayload } from "@/lib/engineering/assetQr";

/** Error correction Q (about 25% recoverable): labels get scuffed, wet and painted around. */
const ERROR_CORRECTION = "Q";

export interface QrMatrix {
  size: number;
  /** Row-major: `rows[r][c]` is true for a dark module. */
  rows: boolean[][];
}

export function buildQrMatrix(payload: string): QrMatrix {
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(payload, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c += 1) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return { size, rows };
}

/** Consecutive modules of the same colour, so a row renders as a handful of boxes rather than one per module. */
export function rowRuns(row: readonly boolean[]): Array<{ dark: boolean; length: number }> {
  const runs: Array<{ dark: boolean; length: number }> = [];
  for (const dark of row) {
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) last.length += 1;
    else runs.push({ dark, length: 1 });
  }
  return runs;
}

export function labelPayload(assetId: string): string {
  return buildAssetQrPayload(assetId);
}

export interface LabelContent {
  assetId: string;
  name: string;
  assetTag: string | null;
  location: string | null;
  property: string | null;
}

/** A tag if there is one; otherwise the first block of the id, so a printed label is never anonymous. */
export function labelCode(content: Pick<LabelContent, "assetId" | "assetTag">): string {
  return content.assetTag?.trim() || content.assetId.slice(0, 8).toUpperCase();
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/** Printed size in CSS points: 4 x 2 inch, a common adhesive equipment label. */
export const LABEL_WIDTH_PT = 288;
export const LABEL_HEIGHT_PT = 144;

/**
 * The printable label as a self-contained HTML page (one label per page) for the system print dialog or a PDF.
 * Every piece of text is escaped: names and tags are user-entered, and this HTML is rendered by a web view.
 */
export function buildLabelHtml(content: LabelContent): string {
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(labelPayload(content.assetId), "Byte");
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  const code = escapeHtml(labelCode(content));
  const lines = [
    content.property ? `<div class="property">${escapeHtml(content.property)}</div>` : "",
    `<div class="name">${escapeHtml(content.name)}</div>`,
    `<div class="code">${code}</div>`,
    content.location ? `<div class="location">${escapeHtml(content.location)}</div>` : "",
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { size: ${LABEL_WIDTH_PT}pt ${LABEL_HEIGHT_PT}pt; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: -apple-system, Helvetica, Arial, sans-serif; }
.label { box-sizing: border-box; width: ${LABEL_WIDTH_PT}pt; height: ${LABEL_HEIGHT_PT}pt; padding: 10pt; display: flex; align-items: center; gap: 12pt; }
.qr { flex: 0 0 112pt; width: 112pt; height: 112pt; }
.qr svg { width: 100%; height: 100%; display: block; }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4pt; }
.property { font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: #333; }
.name { font-size: 12pt; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.code { font-family: Menlo, Courier, monospace; font-size: 16pt; font-weight: 700; overflow-wrap: anywhere; }
.location { font-size: 9pt; color: #222; overflow-wrap: anywhere; }
</style></head><body><div class="label"><div class="qr">${svg}</div><div class="text">${lines}</div></div></body></html>`;
}
