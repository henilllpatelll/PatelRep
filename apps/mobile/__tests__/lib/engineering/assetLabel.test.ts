jest.mock("expo-print", () => ({ printAsync: jest.fn().mockResolvedValue(undefined), printToFileAsync: jest.fn().mockResolvedValue({ uri: "file:///tmp/label.pdf" }) }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { parseAssetCode } from "@/lib/engineering/assetQr";
import { buildLabelHtml, buildQrMatrix, escapeHtml, labelCode, labelPayload, rowRuns, LABEL_HEIGHT_PT, LABEL_WIDTH_PT } from "@/lib/engineering/assetLabel";
import { printLabel, shareLabel } from "@/lib/engineering/assetLabelActions";

const ID = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e";
const content = { assetId: ID, name: "Chiller <2>", assetTag: "CH-2", location: "Roof", property: "Fossil Creek Inn" };

describe("the label's QR payload", () => {
  it("is exactly the versioned payload the scanner already accepts, and nothing more", () => {
    const payload = labelPayload(ID);
    expect(payload).toBe(`patelrep:asset:v1:${ID}`);
    expect(parseAssetCode(payload)).toEqual({ ok: true, kind: "id", value: ID });
    expect(payload).not.toMatch(/token|secret|key|user|http|@/i);
  });

  it("lower-cases the id so a label printed from any source scans the same", () => {
    expect(labelPayload(ID.toUpperCase())).toBe(`patelrep:asset:v1:${ID}`);
  });
});

describe("the QR matrix", () => {
  const matrix = buildQrMatrix(labelPayload(ID));

  it("is a square with the three finder patterns every scanner locks onto", () => {
    expect(matrix.rows).toHaveLength(matrix.size);
    expect(matrix.rows.every((row) => row.length === matrix.size)).toBe(true);
    const n = matrix.size;
    // The 7x7 finder rings: dark corners, and a dark centre, at top-left, top-right and bottom-left.
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(matrix.rows[r][c]).toBe(true);
      expect(matrix.rows[r + 6][c + 6]).toBe(true);
      expect(matrix.rows[r + 3][c + 3]).toBe(true);
      expect(matrix.rows[r + 1][c + 1]).toBe(false);
    }
  });

  it("is the same code every time for the same equipment, and a different one for other equipment", () => {
    expect(buildQrMatrix(labelPayload(ID))).toEqual(matrix);
    expect(buildQrMatrix(labelPayload("ffffffff-1111-4111-8111-222222222222"))).not.toEqual(matrix);
  });

  it("collapses a row into runs that add back up to its width", () => {
    const runs = rowRuns([true, true, false, true]);
    expect(runs).toEqual([{ dark: true, length: 2 }, { dark: false, length: 1 }, { dark: true, length: 1 }]);
    for (const row of matrix.rows) expect(rowRuns(row).reduce((sum, run) => sum + run.length, 0)).toBe(matrix.size);
  });
});

describe("the printable label", () => {
  it("shows the human-readable tag and falls back to a short id when there is none", () => {
    expect(labelCode({ assetId: ID, assetTag: " CH-2 " })).toBe("CH-2");
    expect(labelCode({ assetId: ID, assetTag: null })).toBe("0B6F3A52");
  });

  it("escapes every piece of user text, so a name cannot inject markup", () => {
    const html = buildLabelHtml({ ...content, name: `<img src=x onerror=alert(1)>`, location: `"A" & 'B'`, property: "<script>x</script>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;A&quot; &amp; &#39;B&#39;");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("is a 4 x 2 inch page carrying the QR and the tag", () => {
    const html = buildLabelHtml(content);
    expect(LABEL_WIDTH_PT / 72).toBeCloseTo(4);
    expect(LABEL_HEIGHT_PT / 72).toBeCloseTo(2);
    expect(html).toContain(`size: ${LABEL_WIDTH_PT}pt ${LABEL_HEIGHT_PT}pt`);
    expect(html).toContain("<svg");
    expect(html).toContain(">CH-2<");
    expect(html).toContain("Fossil Creek Inn");
  });
});

describe("print and share hand off to the system and claim nothing more", () => {
  beforeEach(() => jest.clearAllMocks());

  it("print opens the system print dialog with the label page", async () => {
    expect(await printLabel(content)).toBe("opened");
    expect(Print.printAsync).toHaveBeenCalledWith(expect.objectContaining({ width: LABEL_WIDTH_PT, height: LABEL_HEIGHT_PT, html: expect.stringContaining("CH-2") }));
  });

  it("share renders a PDF and opens the share sheet", async () => {
    expect(await shareLabel(content, "Label")).toBe("opened");
    expect(Print.printToFileAsync).toHaveBeenCalled();
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///tmp/label.pdf", expect.objectContaining({ mimeType: "application/pdf" }));
  });

  it("says plainly when sharing is not available instead of pretending", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    expect(await shareLabel(content, "Label")).toBe("unavailable");
    expect(Print.printToFileAsync).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
