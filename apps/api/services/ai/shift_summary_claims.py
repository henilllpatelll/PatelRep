"""Database-backed claim around one shift-summary generation (see migration 236).

Every path that ends in a model call + credit charge (cron, manual Generate,
Regenerate) takes the claim first. The claim is decided by Postgres in one
transaction, so it holds across API replicas — no in-process lock is involved.
"""
import asyncio
import logging
import os
import socket
from dataclasses import dataclass
from typing import Any, Callable, Optional

from fastapi import HTTPException

from core.database import supabase

logger = logging.getLogger(__name__)

LEASE_SECONDS = 300
MAX_ATTEMPTS = 3
RETRY_AFTER_SECONDS = 900
HEARTBEAT_SECONDS = LEASE_SECONDS // 3  # renew well inside the lease so a slow model call keeps its claim


class ShiftSummaryClaimUnavailable(Exception):
    """Another worker owns this occurrence, or retry rules forbid another try.
    reason: in_progress | backoff | retry_exhausted"""

    def __init__(self, reason: str, last_error: Optional[str] = None):
        super().__init__(reason)
        self.reason = reason
        self.last_error = last_error


class ShiftSummaryClaimLost(Exception):
    """The lease was taken over while the model call ran. Nothing was written
    and no credits were charged by this (superseded) owner."""


@dataclass(frozen=True)
class Claim:
    token: str
    attempts: int


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def claim_http_error() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail="A handoff for this shift is already being generated. Try again in a minute.",
    )


def acquire_claim(hotel_id: str, shift_id: str, shift_date: str, *,
                  replace_existing: bool, ignore_retry_limits: bool) -> Optional[Claim]:
    """Return a Claim, or None when the summary already exists (caller returns it).
    Raises ShiftSummaryClaimUnavailable when someone else owns it or retries are spent."""
    result = supabase.rpc("claim_shift_summary_generation", {
        "p_tenant_id": hotel_id,
        "p_shift_id": shift_id,
        "p_shift_date": shift_date,
        "p_claimed_by": _worker_id(),
        "p_lease_seconds": LEASE_SECONDS,
        "p_max_attempts": MAX_ATTEMPTS,
        "p_retry_after_seconds": RETRY_AFTER_SECONDS,
        "p_replace_existing": replace_existing,
        "p_ignore_retry_limits": ignore_retry_limits,
    }).execute()
    data = result.data or {}
    if data.get("claimed"):
        return Claim(token=data["claim_token"], attempts=int(data.get("attempts") or 1))
    reason = data.get("reason")
    if reason == "already_generated":
        return None
    raise ShiftSummaryClaimUnavailable(reason or "in_progress", data.get("last_error"))


def finish_claim(hotel_id: str, shift_id: str, shift_date: str, claim: Claim,
                 *, succeeded: bool, error: Optional[str] = None) -> None:
    """Best-effort: a failed bookkeeping write must never mask the real outcome.
    A claim left 'claimed' simply expires and becomes retryable."""
    try:
        supabase.rpc("complete_shift_summary_generation", {
            "p_tenant_id": hotel_id, "p_shift_id": shift_id, "p_shift_date": shift_date,
            "p_claim_token": claim.token, "p_succeeded": succeeded, "p_error": error,
        }).execute()
    except Exception as exc:
        logger.warning("shift-summary claim bookkeeping failed for tenant=%s shift=%s date=%s: %s",
                       hotel_id, shift_id, shift_date, exc)


def renew_claim(hotel_id: str, shift_id: str, shift_date: str, claim: Claim) -> bool:
    """Extend a LIVE lease. False once it expired or the claim was taken over (it is never revived)."""
    result = supabase.rpc("renew_shift_summary_claim", {
        "p_tenant_id": hotel_id, "p_shift_id": shift_id, "p_shift_date": shift_date,
        "p_claim_token": claim.token, "p_lease_seconds": LEASE_SECONDS,
    }).execute()
    return bool(result.data)


async def run_with_lease(hotel_id: str, shift_id: str, shift_date: str, claim: Claim, fn: Callable[[], Any]) -> Any:
    """Run the blocking model call off the event loop while a heartbeat keeps the lease alive.

    A failed renewal is only logged: the authoritative decision is finalize_claim(), which re-checks token AND
    lease in the same transaction that writes and charges, so a lost lease costs one discarded call, never a
    double charge.
    """
    stop = asyncio.Event()

    async def beat() -> None:
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_SECONDS)
                return
            except asyncio.TimeoutError:
                try:
                    if not await asyncio.to_thread(renew_claim, hotel_id, shift_id, shift_date, claim):
                        logger.warning("shift-summary lease lost mid-call tenant=%s shift=%s date=%s",
                                       hotel_id, shift_id, shift_date)
                        return
                except Exception as exc:
                    logger.warning("shift-summary lease renewal failed tenant=%s shift=%s: %s",
                                   hotel_id, shift_id, exc)

    heartbeat = asyncio.create_task(beat())
    try:
        return await asyncio.to_thread(fn)
    finally:
        stop.set()
        await heartbeat


def finalize_claim(hotel_id: str, shift_id: str, shift_date: str, claim: Claim, *,
                   summary: dict, credits: float, replace_existing: bool) -> dict:
    """The single commit point: in ONE database transaction verify token + status + unexpired lease, persist the
    summary, debit credits once (keyed by claim token) and mark the claim succeeded. Returns the function's JSON:
    finalized (bool), reason, charged (bool), summary (row). When finalized is false NOTHING was written or charged."""
    result = supabase.rpc("finalize_shift_summary_generation", {
        "p_tenant_id": hotel_id, "p_shift_id": shift_id, "p_shift_date": shift_date,
        "p_claim_token": claim.token, "p_summary": summary, "p_credits": credits,
        "p_replace_existing": replace_existing,
    }).execute()
    return result.data or {"finalized": False, "reason": "claim_lost"}
