import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { buildLabelHtml, LABEL_HEIGHT_PT, LABEL_WIDTH_PT, type LabelContent } from "@/lib/engineering/assetLabel";

/* What the buttons on the label screen really do. Neither can know how it ended: printing opens the system print
   dialog and sharing opens the system share sheet, and the person - not this app - finishes (or cancels) from there. The
   results only say whether the system dialog could be opened, so the screen never reports "printed" or "shared". */

export type LabelHandoff = "opened" | "unavailable";

/** Opens the system print dialog with the label. */
export async function printLabel(content: LabelContent): Promise<LabelHandoff> {
  await Print.printAsync({ html: buildLabelHtml(content), width: LABEL_WIDTH_PT, height: LABEL_HEIGHT_PT });
  return "opened";
}

/** Renders the label to a PDF and opens the system share sheet (save to Files, AirDrop, email, a printer app...). */
export async function shareLabel(content: LabelContent, dialogTitle: string): Promise<LabelHandoff> {
  if (!(await Sharing.isAvailableAsync())) return "unavailable";
  const { uri } = await Print.printToFileAsync({ html: buildLabelHtml(content), width: LABEL_WIDTH_PT, height: LABEL_HEIGHT_PT });
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle });
  return "opened";
}
