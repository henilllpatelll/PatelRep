import { api } from "@/lib/api/client";

// Shared between the full chat screen (app/(app)/copilot/index.tsx) and the
// corner card's inline chat (components/shared/CopilotCard.tsx) so both
// surfaces hit /ai/copilot/chat and the 3 confirm endpoints identically.

export type TaskPreview = { title: string; task_type: string; priority: string; room_number?: string };
export type WorkOrderPreview = { title: string; category: string; priority: string; room_number?: string };
export type GuestRequestPreview = { request_type: string; description: string; room_number?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  task_preview?: TaskPreview;
  work_order_preview?: WorkOrderPreview;
  guest_request_preview?: GuestRequestPreview;
};

export type CopilotChatResponse = {
  message: string;
  intent: string;
  task_preview?: TaskPreview;
  work_order_preview?: WorkOrderPreview;
  guest_request_preview?: GuestRequestPreview;
};

export function sendCopilotMessage(text: string, role: string | null | undefined): Promise<CopilotChatResponse> {
  // context must be an object -- the API validates Optional[dict] and reads
  // intent_hint from it; a bare string fails validation with a 422.
  return api.post<CopilotChatResponse>("/ai/copilot/chat", {
    message: text,
    context: { source: "mobile", role: role ?? null },
  });
}

export function confirmTask(preview: TaskPreview): Promise<unknown> {
  return api.post("/ai/tasks/confirm", { ...preview, use_ai: true });
}

export function confirmWorkOrder(preview: WorkOrderPreview): Promise<unknown> {
  return api.post("/work-orders", { ...preview });
}

export function confirmGuestRequest(preview: GuestRequestPreview): Promise<unknown> {
  return api.post("/ai/guest-requests/confirm", { ...preview });
}
