import { Linking } from "react-native";
import { ApiError } from "@/lib/api/client";
import { getLibraryFile } from "@/lib/api/sop";

export type OpenOriginalResult = "opened" | "offline" | "unavailable";

/**
 * Open the ORIGINAL approved document. The server issues a short-lived link only for a document this person may
 * read (their hotel, current, not retired), so a revoked document simply stops opening. `page` jumps a PDF to the
 * cited page; viewers that ignore the fragment still open the file.
 */
export async function openOriginalDocument(documentId: string, page?: number | null): Promise<OpenOriginalResult> {
  try {
    const { data } = await getLibraryFile(documentId);
    const url = typeof data?.url === "string" ? data.url : "";
    if (!/^https:\/\//i.test(url)) return "unavailable";
    await Linking.openURL(page && page > 0 ? `${url}#page=${page}` : url);
    return "opened";
  } catch (error) {
    if (error instanceof ApiError) return "unavailable";
    return "offline";
  }
}
