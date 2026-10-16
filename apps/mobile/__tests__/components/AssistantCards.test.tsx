import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.room ? `${key}:${options.room}` : options?.name ? `${key}:${options.name}` : key),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { ActionConfirmPanel } from "@/components/ai/ActionConfirmPanel";
import { AssistantMessageView } from "@/components/ai/AssistantMessageView";
import { ContextChip } from "@/components/ai/ContextChip";
import { LimitationCard } from "@/components/ai/AssistantCards";
import type { ActionItem, AssistantMessage } from "@/lib/ai/conversationState";
import { guestRequestDraftFromRaw, taskDraftFromRaw, workOrderDraftFromRaw } from "@/lib/ai/drafts";
import { GENERAL_CONTEXT, normalizeLaunch } from "@/lib/ai/launch";
import { summarizePreview } from "@/lib/ai/actionSummary";

const item = (preview: ActionItem["preview"], overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: "a1",
  preview,
  status: "ready",
  requestKey: "k",
  failure: null,
  failureMessage: null,
  deduplicated: false,
  ...overrides,
});
const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
const workOrder = () => workOrderDraftFromRaw({ title: "Bathroom sink leaking", category: "plumbing", priority: "normal", room_number: "312", room_id: "r-312" })!;
const noop = () => {};

describe("ActionConfirmPanel — the one confirm-before-it-exists drawer", () => {
  function panel(overrides: Partial<React.ComponentProps<typeof ActionConfirmPanel>> = {}) {
    const props = { item: item(workOrder()), online: true, onEdit: jest.fn(), onConfirm: jest.fn(), onCancel: jest.fn(), onDone: jest.fn(), ...overrides };
    return { ...wrap(<ActionConfirmPanel {...props} />), props };
  }

  it("lists every field being committed, including what was inferred", () => {
    const { getByLabelText } = panel();
    expect(getByLabelText(/Bathroom sink leaking/)).toBeTruthy();
    expect(getByLabelText(/312/)).toBeTruthy();
    expect(getByLabelText(/copilot.action.workOrderCategory.plumbing/)).toBeTruthy();
    expect(getByLabelText(/copilot.action.priority.normal/)).toBeTruthy();
  });

  it("creates only on the explicit press", () => {
    const { getByTestId, props } = panel();
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("confirm-create"));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("lets the person edit the details before confirming", () => {
    const { getByTestId, getByLabelText, props } = panel();
    fireEvent.press(getByTestId("confirm-edit"));
    fireEvent.changeText(getByLabelText("copilot.action.fields.title"), "Kitchenette sink leaking");
    expect(props.onEdit).toHaveBeenCalledWith({ title: "Kitchenette sink leaking" });
  });

  it("cannot be pressed twice while it is being created", () => {
    const { getByTestId, props } = panel({ item: item(workOrder(), { status: "confirming" }) });
    expect(getByTestId("confirm-create").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("confirm-create"));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(getByTestId("confirm-cancel").props.accessibilityState?.disabled ?? getByTestId("confirm-cancel").props.disabled).toBeTruthy();
  });

  it("refuses an incomplete draft and says why", () => {
    const empty = item({ kind: "task", draft: { ...taskDraftFromRaw({ title: "x" })!.draft, title: "" } as never });
    const { getByTestId, getByText } = panel({ item: empty });
    expect(getByTestId("confirm-create").props.accessibilityState.disabled).toBe(true);
    expect(getByText("assistant.confirm.incomplete")).toBeTruthy();
  });

  it("requires a connection, and says so, instead of pretending to queue", () => {
    const { getByTestId } = panel({ online: false });
    expect(getByTestId("confirm-offline")).toBeTruthy();
    expect(getByTestId("confirm-create").props.accessibilityState.disabled).toBe(true);
  });

  it("warns when a room is shown that the server has not matched to this hotel", () => {
    const unverified = workOrderDraftFromRaw({ title: "Leak", room_number: "9999" })!;
    const { getByText } = panel({ item: item(unverified) });
    expect(getByText("copilot.action.roomUnverified:9999")).toBeTruthy();
  });

  it("shows success only after the server confirmed, and a failure as a failure", () => {
    const failed = panel({ item: item(workOrder(), { status: "failed", failure: "unconfirmed" }) });
    expect(failed.getByTestId("confirm-failure")).toBeTruthy();
    expect(failed.queryByTestId("confirm-success")).toBeNull();
    failed.unmount();

    const done = panel({ item: item(workOrder(), { status: "confirmed" }) });
    expect(done.getByTestId("confirm-success")).toBeTruthy();
    fireEvent.press(done.getByTestId("confirm-done"));
    expect(done.props.onDone).toHaveBeenCalled();
  });

  it("summarises task, work order and guest request drafts with the right fields", () => {
    const t = (key: string) => key;
    const keys = (preview: ActionItem["preview"]) => summarizePreview(preview, t).map((row) => row.key);
    expect(keys(taskDraftFromRaw({ title: "Towels", room_number_display: "214" })!)).toEqual(["action", "room", "title", "priority"]);
    expect(keys(workOrder())).toEqual(["action", "room", "title", "category", "priority"]);
    expect(keys(guestRequestDraftFromRaw({ title: "Crib", room_number: "412", guest_name: "Pat" })!)).toEqual(["action", "room", "title", "guest", "category", "priority"]);
  });
});

describe("AssistantMessageView — message cards", () => {
  const conversation = { chooseOption: jest.fn(), editAction: jest.fn(), confirm: jest.fn(), dismissAction: jest.fn(), send: jest.fn(), online: true, sending: false };
  const base: AssistantMessage = { id: "m1", role: "assistant", content: "", at: Date.now() };

  it("renders a notice as a human sentence, with a retry only where asking again can help", () => {
    const unavailable = wrap(<AssistantMessageView message={{ ...base, kind: "notice", notice: "unavailable", askedText: "hello" }} conversation={conversation} />);
    expect(unavailable.getByText("copilot.notice.unavailable")).toBeTruthy();
    fireEvent.press(unavailable.getByTestId("assistant-retry"));
    expect(conversation.send).toHaveBeenCalledWith("hello");
    unavailable.unmount();

    const permission = wrap(<AssistantMessageView message={{ ...base, kind: "notice", notice: "permission", askedText: "hello" }} conversation={conversation} />);
    expect(permission.queryByTestId("assistant-retry")).toBeNull();
  });

  it("never shows a raw payload or server detail for a notice", () => {
    const { toJSON } = wrap(<AssistantMessageView message={{ ...base, kind: "notice", notice: "unknown", content: "{\"detail\":\"Traceback (most recent call last)\"}" }} conversation={conversation} />);
    expect(JSON.stringify(toJSON())).not.toContain("Traceback");
  });

  it("shows sources for an SOP answer and nothing invented when there are none", () => {
    const withSources = wrap(
      <AssistantMessageView
        message={{ ...base, content: "Strip the bed first.", kind: "answer", provenance: "ai", sources: [{ title: "Linen SOP", excerpt: null, page: 2, documentId: "d1" }] }}
        conversation={conversation}
      />,
    );
    expect(withSources.getByTestId("assistant-sources")).toBeTruthy();
    withSources.unmount();
    const without = wrap(<AssistantMessageView message={{ ...base, content: "Hi", kind: "answer", sources: [] }} conversation={conversation} />);
    expect(without.queryByTestId("assistant-sources")).toBeNull();
  });

  it("marks only AI-written answers as not authoritative", () => {
    const ai = wrap(<AssistantMessageView message={{ ...base, content: "Maybe.", kind: "answer", provenance: "ai" }} conversation={conversation} />);
    expect(ai.getByTestId("assistant-disclaimer")).toBeTruthy();
    ai.unmount();
    const rule = wrap(<AssistantMessageView message={{ ...base, content: "Room 214.", kind: "answer", provenance: "deterministic" }} conversation={conversation} />);
    expect(rule.queryByTestId("assistant-disclaimer")).toBeNull();
  });

  it("explains an action this app cannot take instead of acting on it", () => {
    const { getByText } = wrap(<AssistantMessageView message={{ ...base, kind: "unsupported" }} conversation={conversation} />);
    expect(getByText("copilot.unsupportedReply")).toBeTruthy();
  });

  it("keeps the corner card's inline editable form when no drawer is wired (other roles)", () => {
    const message: AssistantMessage = { ...base, content: "ok", kind: "actions", actions: [item(taskDraftFromRaw({ title: "Towels" })!)] };
    const legacy = wrap(<AssistantMessageView message={message} conversation={conversation} compact />);
    expect(legacy.getByTestId("action-confirm")).toBeTruthy();
    legacy.unmount();
    const unified = wrap(<AssistantMessageView message={message} conversation={conversation} onReviewAction={jest.fn()} />);
    expect(unified.queryByTestId("action-confirm")).toBeNull();
    expect(unified.getByTestId("action-review")).toBeTruthy();
  });

  it("does not offer two clarification answers at once while one is being sent", () => {
    const message: AssistantMessage = { ...base, content: "Which?", kind: "clarify", options: [{ label: "Task", intentHint: "task_creation" }], askedText: "x" };
    const { getByTestId } = wrap(<AssistantMessageView message={message} conversation={{ ...conversation, sending: true }} />);
    fireEvent.press(getByTestId("assistant-option-task_creation"));
    expect(conversation.chooseOption).not.toHaveBeenCalled();
  });
});

describe("LimitationCard", () => {
  it("disables the retry for an offline device that is still offline", () => {
    const { getByTestId } = wrap(<LimitationCard kind="offline" online={false} onRetry={noop} />);
    expect(getByTestId("assistant-retry").props.accessibilityState?.disabled ?? getByTestId("assistant-retry").props.disabled).toBeTruthy();
  });

  it("can carry a way forward", () => {
    const onAction = jest.fn();
    const { getByTestId } = wrap(<LimitationCard kind="credit_limit" online onAction={onAction} actionLabel="Ask a supervisor" />);
    act(() => {
      fireEvent.press(getByTestId("assistant-notice-action"));
    });
    expect(onAction).toHaveBeenCalled();
  });
});

describe("ContextChip", () => {
  it("is hidden for the plain context and shows the verified room otherwise", () => {
    const hidden = wrap(<ContextChip context={GENERAL_CONTEXT} label={{ text: null, verified: false }} onClear={noop} />);
    expect(hidden.queryByTestId("assistant-context-chip")).toBeNull();
    hidden.unmount();

    const room = normalizeLaunch({ contextType: "room", entityId: "11111111-1111-4111-8111-111111111111" });
    const onClear = jest.fn();
    const shown = wrap(<ContextChip context={room} label={{ text: "218", verified: true }} onClear={onClear} />);
    expect(shown.getByLabelText("assistant.context.about:assistant.context.roomWith:218".replace("assistant.context.roomWith:218", "assistant.context.roomWith:218"))).toBeTruthy();
    fireEvent.press(shown.getByTestId("assistant-context-clear"));
    expect(onClear).toHaveBeenCalled();
  });
});
