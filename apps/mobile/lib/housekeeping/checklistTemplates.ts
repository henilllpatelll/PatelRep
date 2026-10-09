import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGetChecklistTemplates, type ChecklistTemplate } from "@/lib/housekeeping/cleanSession";

const KEY_PREFIX = "@patelrep/checklist_templates/v1/";

/**
 * Last-known copy of the hotel's configured cleaning checklists. It is only a
 * stand-in so a clean can start without a connection; the server snapshot taken
 * at session start always replaces it.
 */
export async function loadCachedTemplates(tenantId: string): Promise<ChecklistTemplate[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + tenantId);
    return raw ? (JSON.parse(raw) as ChecklistTemplate[]) : null;
  } catch {
    return null;
  }
}

export async function refreshCachedTemplates(tenantId: string): Promise<ChecklistTemplate[] | null> {
  try {
    const templates = await apiGetChecklistTemplates();
    if (templates.length > 0) {
      await AsyncStorage.setItem(KEY_PREFIX + tenantId, JSON.stringify(templates));
    }
    return templates;
  } catch {
    return null;
  }
}
