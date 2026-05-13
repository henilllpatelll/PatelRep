import io
import re
import time
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

import pdfplumber
import anthropic
import openai
from openai import OpenAI

from core.config import settings
from core.database import supabase

logger = logging.getLogger(__name__)

openai_client = OpenAI(api_key=settings.openai_api_key)
claude = anthropic.Anthropic(api_key=settings.anthropic_api_key)

# ---------------------------------------------------------------------------
# Chunking constants
# ---------------------------------------------------------------------------
CHUNK_SIZE = 500       # target characters per chunk
CHUNK_OVERLAP = 50     # character overlap between successive chunks

# ---------------------------------------------------------------------------
# Claude system prompt for SOP RAG
# ---------------------------------------------------------------------------
SOP_SYSTEM_PROMPT = """You are the SOP assistant for a hotel. Answer staff questions about hotel procedures using ONLY the provided SOP excerpts.

Rules:
1. Only answer from the provided context. If the answer isn't in the context, say: "I don't have that procedure in your uploaded SOPs. Please check with your supervisor."
2. Format procedures as numbered steps.
3. If the procedure involves tasks that should be created (cleaning setup, VIP service, etc.), end your response with a SUGGESTED_TASKS JSON block.
4. Keep responses concise and action-oriented.
5. If the staff member wrote in Spanish, respond in Spanish.

SUGGESTED_TASKS format (only include if relevant):
SUGGESTED_TASKS: [{"title": "...", "task_type": "housekeeping|engineering|general", "priority": "urgent|normal|low"}]"""


# ---------------------------------------------------------------------------
# Helpers: text chunking
# ---------------------------------------------------------------------------

def _chunk_text(text: str, page_number: int) -> List[dict]:
    """
    Split text into overlapping chunks of ~CHUNK_SIZE characters.

    Strategy:
    1. Split on double newlines (paragraph boundaries) first.
    2. If a paragraph fits within CHUNK_SIZE, accumulate.
    3. If a paragraph is too long, split on single newlines, then by
       character count as a last resort.

    Returns a list of dicts: {"content": str, "page_number": int}
    """
    paragraphs: List[str] = [p.strip() for p in text.split("\n\n") if p.strip()]

    # Expand oversized paragraphs into lines, then into fixed-size slices
    segments: List[str] = []
    for para in paragraphs:
        if len(para) <= CHUNK_SIZE:
            segments.append(para)
        else:
            lines = [ln.strip() for ln in para.split("\n") if ln.strip()]
            current = ""
            for line in lines:
                if not current:
                    current = line
                elif len(current) + 1 + len(line) <= CHUNK_SIZE:
                    current += "\n" + line
                else:
                    segments.append(current)
                    current = line
            if current:
                segments.append(current)

    # Accumulate segments into chunks with overlap
    chunks: List[dict] = []
    current_chunk = ""
    for seg in segments:
        if not current_chunk:
            current_chunk = seg
        elif len(current_chunk) + 2 + len(seg) <= CHUNK_SIZE:
            current_chunk += "\n\n" + seg
        else:
            chunks.append({"content": current_chunk, "page_number": page_number})
            # Carry forward the tail of the previous chunk as overlap
            tail = current_chunk[-CHUNK_OVERLAP:] if len(current_chunk) > CHUNK_OVERLAP else current_chunk
            current_chunk = tail + "\n\n" + seg

    if current_chunk.strip():
        chunks.append({"content": current_chunk, "page_number": page_number})

    return chunks


# ---------------------------------------------------------------------------
# Ingestion pipeline
# ---------------------------------------------------------------------------

def index_sop_document(document_id: str, storage_path: str, hotel_id: str) -> None:
    """
    Full ingestion pipeline: download → parse → chunk → embed → store.

    Called as a FastAPI BackgroundTask. Updates indexing_status throughout.
    """
    try:
        # --- 1. Mark as processing ---
        supabase.table("sop_documents").update({
            "indexing_status": "processing",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", document_id).execute()

        # --- 2. Download PDF from Supabase Storage ---
        pdf_bytes: bytes = supabase.storage.from_("sop-documents").download(storage_path)

        # --- 3. Parse pages with pdfplumber ---
        all_chunks: List[dict] = []
        num_pages = 0

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            num_pages = len(pdf.pages)
            for page in pdf.pages:
                page_num = page.page_number  # 1-based
                page_text = page.extract_text() or ""
                if not page_text.strip():
                    continue
                page_chunks = _chunk_text(page_text, page_num)
                all_chunks.extend(page_chunks)

        if not all_chunks:
            logger.warning("document_id=%s produced 0 chunks after parsing", document_id)
            supabase.table("sop_documents").update({
                "indexing_status": "failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", document_id).execute()
            return

        # --- 4. Generate embeddings in batches of 100 ---
        texts = [c["content"] for c in all_chunks]
        embeddings: List[List[float]] = []

        batch_size = 100
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            response = openai_client.embeddings.create(
                model="text-embedding-3-small",
                input=batch,
            )
            # response.data is ordered the same as input
            batch_embeddings = [item.embedding for item in response.data]
            embeddings.extend(batch_embeddings)

        # --- 5. Store chunks in sop_chunks ---
        rows = []
        for idx, (chunk, embedding) in enumerate(zip(all_chunks, embeddings)):
            rows.append({
                "document_id": document_id,
                "tenant_id": hotel_id,
                "chunk_index": idx,
                "content": chunk["content"],
                "page_number": chunk["page_number"],
                "embedding": embedding,  # list of floats; supabase-py serialises to JSON
                "token_count": len(chunk["content"]) // 4,
                "metadata": {
                    "page_number": chunk["page_number"],
                    "chunk_index": idx,
                },
            })

        # Insert in batches to avoid request size limits
        insert_batch = 50
        for i in range(0, len(rows), insert_batch):
            supabase.table("sop_chunks").insert(rows[i : i + insert_batch]).execute()

        # --- 6. Update sop_documents: mark indexed ---
        supabase.table("sop_documents").update({
            "indexing_status": "indexed",
            "chunk_count": len(rows),
            "page_count": num_pages,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", document_id).execute()

        logger.info(
            "document_id=%s indexed successfully: %d chunks across %d pages",
            document_id,
            len(rows),
            num_pages,
        )

    except Exception as exc:
        logger.exception("Failed to index document_id=%s: %s", document_id, exc)
        try:
            supabase.table("sop_documents").update({
                "indexing_status": "failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", document_id).execute()
        except Exception as update_exc:
            logger.exception("Also failed to mark document as failed: %s", update_exc)


# ---------------------------------------------------------------------------
# RAG query pipeline
# ---------------------------------------------------------------------------

def query_sop(query: str, hotel_id: str, user_id: str) -> dict:
    """
    Perform a RAG query over indexed SOP documents for the given hotel.

    Returns:
        {
            "answer": str,
            "sources": [{"content": str, "similarity": float, "metadata": dict}],
            "suggested_tasks": list,
            "prompt_tokens": int,
            "completion_tokens": int,
        }
    """
    start_ts = time.time()
    prompt_tokens = 0
    completion_tokens = 0

    try:
        # --- 1. Embed the query ---
        embed_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=query,
        )
        query_embedding: List[float] = embed_response.data[0].embedding

        # --- 2. Similarity search via Supabase RPC ---
        # The function in migration 017 uses parameter name "match_hotel_id"
        rpc_result = supabase.rpc(
            "match_sop_chunks",
            {
                "query_embedding": query_embedding,
                "match_hotel_id": hotel_id,
                "match_threshold": 0.75,
                "match_count": 5,
            },
        ).execute()

        chunks = rpc_result.data or []

        # --- 3. No relevant chunks → return early ---
        if not chunks:
            latency_ms = int((time.time() - start_ts) * 1000)
            _log_ai_interaction(
                hotel_id=hotel_id,
                user_id=user_id,
                prompt_tokens=0,
                completion_tokens=0,
                credits_charged=0.0,
                latency_ms=latency_ms,
                success=True,
            )
            return {
                "answer": (
                    "I don't have that procedure in your uploaded SOPs. "
                    "Please check with your supervisor."
                ),
                "sources": [],
                "suggested_tasks": [],
                "prompt_tokens": 0,
                "completion_tokens": 0,
            }

        # --- 4. Fetch document titles for context attribution ---
        doc_ids = list({c["document_id"] for c in chunks})
        doc_result = (
            supabase.table("sop_documents")
            .select("id, title")
            .in_("id", doc_ids)
            .execute()
        )
        doc_title_map: dict = {
            d["id"]: d["title"] for d in (doc_result.data or [])
        }

        # --- 5. Build context string ---
        context_parts = []
        for chunk in chunks:
            doc_title = doc_title_map.get(chunk["document_id"], "SOP Document")
            page_num = (chunk.get("metadata") or {}).get("page_number", "?")
            context_parts.append(
                f"[{doc_title} - Page {page_num}]\n{chunk['content']}"
            )
        context_str = "\n\n---\n\n".join(context_parts)

        user_message = f"SOP Context:\n{context_str}\n\nStaff Question: {query}"

        # --- 6. Call Claude Sonnet ---
        claude_response = claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SOP_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        usage = claude_response.usage
        prompt_tokens = usage.input_tokens
        completion_tokens = usage.output_tokens
        raw_answer: str = claude_response.content[0].text.strip()

        # --- 7. Parse SUGGESTED_TASKS block ---
        suggested_tasks: list = []
        tasks_pattern = re.compile(r"SUGGESTED_TASKS:\s*(\[.*?\])", re.DOTALL)
        match = tasks_pattern.search(raw_answer)
        if match:
            try:
                suggested_tasks = json.loads(match.group(1))
            except (json.JSONDecodeError, ValueError):
                suggested_tasks = []
            # Strip the SUGGESTED_TASKS block from the visible answer
            answer = raw_answer[: match.start()].strip()
        else:
            answer = raw_answer

        # --- 8. Build sources list ---
        sources = [
            {
                "content": c["content"],
                "similarity": c["similarity"],
                "metadata": c.get("metadata") or {},
            }
            for c in chunks
        ]

        # --- 9. Log AI interaction ---
        latency_ms = int((time.time() - start_ts) * 1000)
        _log_ai_interaction(
            hotel_id=hotel_id,
            user_id=user_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            credits_charged=2.0,
            latency_ms=latency_ms,
            success=True,
        )

        return {
            "answer": answer,
            "sources": sources,
            "suggested_tasks": suggested_tasks,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        }

    except (
        openai.RateLimitError,
        openai.AuthenticationError,
        anthropic.RateLimitError,
        anthropic.AuthenticationError,
    ) as exc:
        latency_ms = int((time.time() - start_ts) * 1000)
        logger.warning("SOP query provider unavailable for hotel_id=%s: %s", hotel_id, exc)
        _log_ai_interaction(
            hotel_id=hotel_id,
            user_id=user_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            credits_charged=0.0,
            latency_ms=latency_ms,
            success=False,
            error_message=str(exc),
        )
        raise
    except Exception as exc:
        latency_ms = int((time.time() - start_ts) * 1000)
        logger.exception("SOP query failed for hotel_id=%s: %s", hotel_id, exc)
        _log_ai_interaction(
            hotel_id=hotel_id,
            user_id=user_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            credits_charged=0.0,
            latency_ms=latency_ms,
            success=False,
            error_message=str(exc),
        )
        raise


# ---------------------------------------------------------------------------
# Internal helper: log to ai_interactions
# ---------------------------------------------------------------------------

def _log_ai_interaction(
    hotel_id: str,
    user_id: str,
    prompt_tokens: int,
    completion_tokens: int,
    credits_charged: float,
    latency_ms: int,
    success: bool,
    error_message: Optional[str] = None,
) -> None:
    try:
        supabase.table("ai_interactions").insert({
            "tenant_id": hotel_id,
            "user_id": user_id,
            "interaction_type": "sop_query",
            "model_used": "claude-sonnet-4-6",
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "credits_charged": credits_charged,
            "latency_ms": latency_ms,
            "success": success,
            "error_message": error_message,
        }).execute()
    except Exception as log_exc:
        logger.warning("Failed to log ai_interaction: %s", log_exc)
