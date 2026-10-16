import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const extras = options ? Object.values(options).join("|") : "";
      return extras ? `${key}:${extras}` : key;
    },
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

import { router } from "expo-router";
import { AssistantMessageView } from "@/components/ai/AssistantMessageView";
import { SopAnswerNotes } from "@/components/sop/SopAnswerNotes";
import { SourceCitationCard } from "@/components/sop/SourceCitationCard";
import type { AssistantSource, SopAnswerMeta } from "@/lib/ai/contract";
import { toPersistable, type AssistantMessage } from "@/lib/ai/conversationState";

const DOC = "d0000000-0000-4000-8000-000000000001";
const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
const source = (over: Partial<AssistantSource> = {}): AssistantSource => ({
  title: "Do Not Disturb Policy",
  excerpt: "Knock twice and announce housekeeping.",
  page: 3,
  documentId: DOC,
  version: 2,
  section: null,
  ...over,
});
const meta = (over: Partial<SopAnswerMeta> = {}): SopAnswerMeta => ({ grounded: true, reason: null, highRisk: false, answerLanguage: "en", related: [], ...over });

beforeEach(() => jest.clearAllMocks());

describe("SourceCitationCard", () => {
  it("shows the real title, version and page, and opens the cited document at that page", () => {
    const { getByText, getByTestId } = wrap(<SourceCitationCard source={source()} />);
    expect(getByText("Do Not Disturb Policy")).toBeTruthy();
    expect(getByTestId("source-citation-detail").props.children).toBe("sop.citation.version:2 · copilot.page:3");
    fireEvent.press(getByTestId("source-citation-open"));
    expect(router.push).toHaveBeenCalledWith(`/(app)/sop/${DOC}?page=3`);
  });

  it("routes through the caller when it must close its own sheet first", () => {
    const onOpenHref = jest.fn();
    const { getByTestId } = wrap(<SourceCitationCard source={source({ page: null })} onOpenHref={onOpenHref} />);
    fireEvent.press(getByTestId("source-citation-open"));
    expect(onOpenHref).toHaveBeenCalledWith(`/(app)/sop/${DOC}`);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("leaves out version and section it was not given, and never links an unusable id", () => {
    const { queryByTestId } = wrap(<SourceCitationCard source={source({ version: null, section: null, page: null, documentId: null })} />);
    expect(queryByTestId("source-citation-detail")).toBeNull();
    expect(queryByTestId("source-citation-open")).toBeNull();
  });

  it("never shows a confidence percentage", () => {
    const { queryByText } = wrap(<SourceCitationCard source={source()} />);
    expect(queryByText(/%/)).toBeNull();
  });
});

describe("SopAnswerNotes", () => {
  it("says a cited answer was written from the approved procedures", () => {
    const { getByText, queryByTestId } = wrap(<SopAnswerNotes sop={meta()} hasSources appLanguage="en" />);
    expect(getByText("sop.notes.grounded")).toBeTruthy();
    expect(queryByTestId("sop-answer-ungrounded")).toBeNull();
    expect(queryByTestId("sop-answer-high-risk")).toBeNull();
  });

  it("explains why there is no verified answer and offers only the approved documents it was given", () => {
    const onOpenHref = jest.fn();
    const sop = meta({ grounded: false, reason: "no_match", related: [{ id: DOC, title: "Do Not Disturb Policy", category: null }] });
    const { getByTestId, getByText } = wrap(<SopAnswerNotes sop={sop} hasSources={false} appLanguage="en" onOpenHref={onOpenHref} />);
    expect(getByText("sop.notes.reason.no_match")).toBeTruthy();
    fireEvent.press(getByTestId("sop-related-document"));
    expect(onOpenHref).toHaveBeenCalledWith(`/(app)/sop/${DOC}`);
  });

  it("keeps the original procedure in front of the person for risky topics", () => {
    const { getByTestId } = wrap(<SopAnswerNotes sop={meta({ highRisk: true })} hasSources appLanguage="en" />);
    expect(getByTestId("sop-answer-high-risk")).toBeTruthy();
  });

  it("labels an answer written in the other language as AI-written", () => {
    const { getByTestId, rerender, queryByTestId } = wrap(<SopAnswerNotes sop={meta({ answerLanguage: "es" })} hasSources appLanguage="en" />);
    expect(getByTestId("sop-answer-translated")).toBeTruthy();
    rerender(
      <ThemeProvider>
        <SopAnswerNotes sop={meta({ answerLanguage: "es" })} hasSources appLanguage="es" />
      </ThemeProvider>,
    );
    expect(queryByTestId("sop-answer-translated")).toBeNull();
  });

  it("offers a follow-up that puts the cursor back in the composer", () => {
    const onFollowUp = jest.fn();
    const { getByTestId } = wrap(<SopAnswerNotes sop={meta()} hasSources appLanguage="en" onFollowUp={onFollowUp} />);
    fireEvent.press(getByTestId("sop-follow-up"));
    expect(onFollowUp).toHaveBeenCalledTimes(1);
  });
});

describe("a procedure answer inside the conversation", () => {
  const message: AssistantMessage = {
    id: "m1",
    role: "assistant",
    content: "1. Knock twice.",
    at: Date.now(),
    kind: "answer",
    provenance: "ai",
    sources: [source()],
    sop: meta({ highRisk: true }),
  };
  const conversation = { chooseOption: jest.fn(), editAction: jest.fn(), confirm: jest.fn(), dismissAction: jest.fn(), send: jest.fn(), online: true, sending: false };

  it("shows the answer, how it stands, and a citation card for each source", () => {
    const { getByTestId, getAllByTestId } = wrap(<AssistantMessageView message={message} conversation={conversation} />);
    expect(getByTestId("assistant-reply")).toBeTruthy();
    expect(getByTestId("sop-answer-notes")).toBeTruthy();
    expect(getAllByTestId("source-citation")).toHaveLength(1);
  });

  it("is not written to saved history: a policy sentence without its source card would read as uncited", () => {
    const saved = toPersistable([{ id: "u1", role: "user", content: "What if DND?", at: 1 }, message]);
    expect(saved[1].proposedGuestRequest).toBe(true);
  });
});
