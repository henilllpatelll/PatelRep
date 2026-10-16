import type { SOPDocument } from "@/lib/api/sop";
import {
  documentStatus,
  formatDocumentDate,
  freshnessOf,
  looksLikeQuestion,
  searchDocuments,
  sortDocuments,
  suggestedQuestions,
} from "@/lib/sop/library";

function doc(over: Partial<SOPDocument> & { id: string; title: string }): SOPDocument {
  return {
    description: null,
    category: null,
    page_count: 2,
    indexing_status: "indexed",
    created_at: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

const DOCS = [
  doc({ id: "a", title: "Do Not Disturb Policy", category: "Housekeeping", created_at: "2026-10-03T00:00:00Z" }),
  doc({ id: "b", title: "Chemical Handling", category: "Safety", description: "Bleach and cleaners", created_at: "2026-10-02T00:00:00Z" }),
  doc({ id: "c", title: "Limpieza de habitación", category: "Housekeeping", created_at: "2026-10-01T00:00:00Z", indexing_status: "pending" }),
];

describe("searchDocuments", () => {
  it("keeps everything for an empty search", () => {
    expect(searchDocuments(DOCS, "   ")).toHaveLength(3);
  });

  it("matches by title, category and description, without needing the assistant", () => {
    expect(searchDocuments(DOCS, "disturb").map((d) => d.id)).toEqual(["a"]);
    expect(searchDocuments(DOCS, "safety").map((d) => d.id)).toEqual(["b"]);
    expect(searchDocuments(DOCS, "bleach").map((d) => d.id)).toEqual(["b"]);
  });

  it("requires every word and ignores case and accents", () => {
    expect(searchDocuments(DOCS, "housekeeping policy").map((d) => d.id)).toEqual(["a"]);
    expect(searchDocuments(DOCS, "HABITACION limpieza").map((d) => d.id)).toEqual(["c"]);
    expect(searchDocuments(DOCS, "disturb chemical")).toEqual([]);
  });
});

describe("looksLikeQuestion", () => {
  it.each(["How do I handle DND?", "what is the spill procedure", "¿Cómo limpio un derrame?", "puedo entrar si hay letrero", "we found a wallet in the lobby today"])(
    "treats %p as a question",
    (text) => expect(looksLikeQuestion(text)).toBe(true),
  );
  it.each(["", "ab", "chemical", "lost found"])("treats %p as a name to look up", (text) => expect(looksLikeQuestion(text)).toBe(false));
});

describe("documentStatus", () => {
  it("claims approval only when the hotel's own record says so", () => {
    expect(documentStatus({ approval: undefined })).toEqual({ kind: "uploaded", version: null, reviewDate: null });
    expect(documentStatus({ approval: null })).toEqual({ kind: "uploaded", version: null, reviewDate: null });
    expect(
      documentStatus({ approval: { state: "approved", version: 2, effective_date: null, review_date: "2027-01-05", approved_at: null } }),
    ).toEqual({ kind: "approved", version: 2, reviewDate: "2027-01-05" });
  });
});

describe("formatDocumentDate", () => {
  it("formats real dates in the app language and never invents one", () => {
    expect(formatDocumentDate("2026-10-02", "en")).toBe("Oct 2, 2026");
    expect(formatDocumentDate("2026-10-02", "es")).toMatch(/2/);
    expect(formatDocumentDate(null, "en")).toBeNull();
    expect(formatDocumentDate("not a date", "en")).toBeNull();
  });
});

describe("suggestedQuestions", () => {
  it("offers a question only for procedures the assistant can answer from", () => {
    expect(suggestedQuestions(DOCS).map((s) => s.documentId)).toEqual(["a", "b"]);
    expect(suggestedQuestions(DOCS.map((d) => ({ ...d, ai_ready: false })))).toEqual([]);
    expect(suggestedQuestions([])).toEqual([]);
  });

  it("honours the server's ai_ready flag and the limit", () => {
    const many = Array.from({ length: 6 }, (_, i) => doc({ id: `d${i}`, title: `Doc ${i}`, ai_ready: true, created_at: `2026-10-0${i + 1}T00:00:00Z` }));
    const out = suggestedQuestions(many);
    expect(out).toHaveLength(3);
    expect(out[0].documentId).toBe("d5");
  });
});

describe("sortDocuments / freshnessOf", () => {
  it("lists newest first without mutating the input", () => {
    const input = [...DOCS].reverse();
    expect(sortDocuments(input).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(input.map((d) => d.id)).toEqual(["c", "b", "a"]);
  });

  it("reports the age of a saved copy in the coarsest honest unit", () => {
    const now = 10_000_000_000;
    expect(freshnessOf(now - 20_000, now)).toEqual({ unit: "justNow", value: 0 });
    expect(freshnessOf(now - 5 * 60_000, now)).toEqual({ unit: "minutes", value: 5 });
    expect(freshnessOf(now - 3 * 3_600_000, now)).toEqual({ unit: "hours", value: 3 });
    expect(freshnessOf(now - 2 * 86_400_000, now)).toEqual({ unit: "days", value: 2 });
    expect(freshnessOf(now + 5000, now).unit).toBe("justNow");
  });
});
