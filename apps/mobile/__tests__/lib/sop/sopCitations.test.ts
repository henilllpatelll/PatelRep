import { citationDetail, parsePageParam, sourceHref } from "@/lib/sop/citations";
import { normalizeCopilotResponse } from "@/lib/ai/contract";

const DOC = "d0000000-0000-4000-8000-000000000001";
const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;

describe("sourceHref", () => {
  it("links to the cited document, with the cited page when there is one", () => {
    expect(sourceHref({ documentId: DOC, page: null })).toBe(`/(app)/sop/${DOC}`);
    expect(sourceHref({ documentId: DOC, page: 3 })).toBe(`/(app)/sop/${DOC}?page=3`);
  });

  it("never links an id that is not shaped like a document id", () => {
    expect(sourceHref({ documentId: null, page: 3 })).toBeNull();
    expect(sourceHref({ documentId: "../../etc/passwd", page: 1 })).toBeNull();
    expect(sourceHref({ documentId: "doc-1", page: null })).toBeNull();
  });
});

describe("citationDetail", () => {
  it("shows only the parts the source really has", () => {
    expect(citationDetail({ version: null, page: null, section: null }, t)).toBe("");
    expect(citationDetail({ version: 2, page: null, section: null }, t)).toBe('sop.citation.version{"version":2}');
    expect(citationDetail({ version: 2, page: 4, section: null }, t)).toBe('sop.citation.version{"version":2} · copilot.page{"page":4}');
    expect(citationDetail({ version: undefined, page: 4, section: "Room Access" }, t)).toContain("sop.citation.section");
  });
});

describe("parsePageParam", () => {
  it("accepts only a plain positive page number", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(["7", "9"])).toBe(7);
    expect(parsePageParam(undefined)).toBeNull();
    for (const bad of ["0", "-1", "3.5", "abc", "99999", "3; drop"]) expect(parsePageParam(bad)).toBeNull();
  });
});

describe("normalizing a procedure answer", () => {
  const reply = (over: Record<string, unknown> = {}) => ({
    data: {
      response_type: "answer",
      message: "1. Knock twice.",
      model_used: "claude-sonnet-4-6",
      grounded: true,
      reason: null,
      high_risk: true,
      answer_language: "es",
      sources: [
        { content: "Knock twice.", title: "Do Not Disturb Policy", document_id: DOC.toUpperCase(), version: 2, page: 3, section: "Room Access", similarity: 0.91, metadata: { page_number: 3 } },
        { content: "Knock twice.", title: "Do Not Disturb Policy", document_id: DOC, page: 3 },
        { content: "Another", title: "Forged", document_id: "not-an-id", page: 99999 },
      ],
      related_documents: [],
      ...over,
    },
  });

  it("keeps real title, version, page and section, de-duplicates, and unlinks an unusable id", () => {
    const out = normalizeCopilotResponse(reply());
    if (out.kind !== "answer") throw new Error("expected an answer");
    expect(out.sources).toHaveLength(2);
    expect(out.sources[0]).toMatchObject({ title: "Do Not Disturb Policy", documentId: DOC, version: 2, page: 3, section: "Room Access" });
    expect(out.sources[1]).toMatchObject({ title: "Forged", documentId: null, page: null, version: null });
    expect(out.sop).toMatchObject({ grounded: true, highRisk: true, answerLanguage: "es", related: [] });
    expect(out.provenance).toBe("ai");
  });

  it("carries the reason and only valid related documents when there was no verified answer", () => {
    const out = normalizeCopilotResponse(
      reply({
        grounded: false,
        reason: "insufficient",
        model_used: null,
        sources: [],
        related_documents: [
          { id: DOC, title: "Do Not Disturb Policy", category: "Housekeeping" },
          { id: "javascript:alert(1)", title: "Evil" },
          { id: DOC, title: "" },
        ],
      }),
    );
    if (out.kind !== "answer") throw new Error("expected an answer");
    expect(out.sop).toMatchObject({ grounded: false, reason: "insufficient" });
    expect(out.sop?.related).toEqual([{ id: DOC, title: "Do Not Disturb Policy", category: "Housekeeping" }]);
    expect(out.provenance).toBe("deterministic");
  });

  it("ignores a reason it does not know and treats replies without a verdict as plain answers", () => {
    const odd = normalizeCopilotResponse(reply({ reason: "because" }));
    if (odd.kind !== "answer") throw new Error("expected an answer");
    expect(odd.sop?.reason).toBeNull();
    const plain = normalizeCopilotResponse({ data: { response_type: "answer", message: "Hello", sources: [] } });
    if (plain.kind !== "answer") throw new Error("expected an answer");
    expect(plain.sop).toBeUndefined();
  });

  it("reads the document title and version the server confirmed", () => {
    const out = normalizeCopilotResponse({
      data: { response_type: "answer", message: "ok", trusted_context: { document_id: DOC, document_title: "Do Not Disturb Policy", document_version: 2 } },
    });
    expect(out.trustedContext).toEqual({ documentId: DOC, documentTitle: "Do Not Disturb Policy", documentVersion: 2 });
  });
});
