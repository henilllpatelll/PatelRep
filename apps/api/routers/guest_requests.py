import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from middleware.auth import get_current_user, CurrentUser
from models.requests import (
    CreateGuestMessageRequest,
    CreateGuestRequestRequest,
    CreateGuestRequestSlaPolicyRequest,
    RecordGuestRecoveryActionRequest,
    TransitionGuestRequestRequest,
    UpsertAccessibleRoomFeatureRequest,
)
from core.database import supabase
from datetime import datetime, timedelta, timezone
from services.guest_recovery.contracts import (
    AccessibilityPriorityError,
    InvalidGuestRequestTransition,
    calculate_guest_request_metrics,
    resolve_sla_minutes,
    validate_guest_request_transition,
)
from services.sms.twilio_client import SmsNotConfiguredError, SmsOptedOutError, SmsSendError, send_sms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/guest-requests", tags=["guest-requests"])
GUEST_REQUEST_UPDATE_COLUMNS = {
    "title",
    "description",
    "room_id",
    "guest_name",
    "guest_phone",
    "status",
    "priority",
    "resolved_at",
    "resolved_by",
}
MESSAGE_ROLES = ("front_desk", "housekeeping_supervisor", "engineer", "gm")
SLA_POLICY_ROLES = {"gm", "housekeeping_supervisor"}


def _record_guest_request_event(
    *, request_id: str, event_type: str, current_user: CurrentUser,
    detail: str | None = None, source: str = "staff", metadata: dict | None = None,
) -> None:
    supabase.table("guest_request_events").insert({
        "tenant_id": current_user.hotel_id,
        "guest_request_id": request_id,
        "event_type": event_type,
        "actor_id": current_user.user_id,
        "source": source,
        "detail": detail,
        "metadata": metadata or {},
    }).execute()


def _record_message_delivery(
    *, tenant_id: str, message_id: str, status: str,
    provider_message_id: str | None = None, error_code: str | None = None,
    failure_reason: str | None = None,
) -> None:
    """guest_messages is append-only (migration 072) — delivery state lives in its own event table."""
    supabase.table("guest_message_delivery_events").insert({
        "tenant_id": tenant_id,
        "guest_message_id": message_id,
        "status": status,
        "provider_message_id": provider_message_id,
        "error_code": error_code,
        "failure_reason": failure_reason,
    }).execute()


def _status_timestamp(status: str, now: datetime) -> dict[str, str]:
    timestamp = now.isoformat()
    return {
        "acknowledged": {"acknowledged_at": timestamp},
        "dispatched": {"dispatched_at": timestamp},
        "arrived": {"arrived_at": timestamp},
        "guest_contacted": {"guest_contacted_at": timestamp},
        "resolved": {"resolved_at": timestamp},
        "verified": {"verified_at": timestamp},
        "reopened": {"reopened_at": timestamp},
    }.get(status, {})


@router.post("")
async def create_guest_request(
    request: CreateGuestRequestRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Create a new guest request and auto-create a task."""
    if request.category == "accessibility" and request.priority != "urgent":
        raise HTTPException(status_code=422, detail="Accessibility-related requests must use urgent priority")
    policies = supabase.table("guest_request_sla_policies").select(
        "category, priority, guest_impact, sla_minutes"
    ).eq("tenant_id", current_user.hotel_id).execute().data or []
    sla_minutes = resolve_sla_minutes(
        policies,
        category=request.category,
        priority=request.priority or "normal",
        guest_impact=request.guest_impact,
    )
    now = datetime.now(timezone.utc)
    # Insert guest request record
    gr_data = {
        "tenant_id": current_user.hotel_id,
        "title": request.title,
        "description": request.description,
        "room_id": str(request.room_id) if request.room_id else None,
        "guest_name": request.guest_name,
        "guest_phone": request.guest_phone,
        "created_by": current_user.user_id,
        "status": "open",
        "priority": request.priority or "normal",
        "category": request.category,
        "guest_impact": request.guest_impact,
        "sla_minutes": sla_minutes,
        "due_at": (now + timedelta(minutes=sla_minutes)).isoformat(),
        "contact_preference": request.contact_preference,
        "contact_consent_at": now.isoformat() if request.contact_consent else None,
    }
    result = supabase.table("guest_requests").insert(gr_data).execute()

    if result.data:
        gr_id = result.data[0]["id"]
        # Auto-create a housekeeping task linked to this guest request
        task_result = supabase.table("tasks").insert({
            "tenant_id": current_user.hotel_id,
            "title": request.title,
            "description": request.description,
            "task_type": "guest_request",
            "priority": request.priority or "normal",
            "room_id": str(request.room_id) if request.room_id else None,
            "created_by": current_user.user_id,
            "sla_minutes": sla_minutes,
            "due_at": (now + timedelta(minutes=sla_minutes)).isoformat(),
        }).execute()
        if task_result.data:
            task_id = task_result.data[0]["id"]
            refreshed = supabase.table("guest_requests")\
                .update({"task_id": task_id})\
                .eq("id", gr_id)\
                .eq("tenant_id", current_user.hotel_id)\
                .execute()
            if refreshed.data:
                result = refreshed
        else:
            logger.error("Auto-task creation failed for guest_request=%s", gr_id)

        _record_guest_request_event(
            request_id=gr_id,
            event_type="created",
            current_user=current_user,
            metadata={"category": request.category, "priority": request.priority or "normal"},
        )

    return {"data": result.data[0] if result.data else None}


@router.post("/{request_id}/transition")
async def transition_guest_request(
    request_id: str,
    request: TransitionGuestRequestRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    existing = supabase.table("guest_requests").select("*").eq("id", request_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Guest request not found")
    try:
        validate_guest_request_transition(
            current_status=existing["status"], next_status=request.status,
            category=existing.get("category", "service"), priority=existing.get("priority", "normal"),
        )
    except (AccessibilityPriorityError, InvalidGuestRequestTransition) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    update = {"status": request.status, **_status_timestamp(request.status, now)}
    if request.status == "resolved":
        update["resolved_by"] = current_user.user_id
    record = supabase.table("guest_requests").update(update).eq("id", request_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute().data[0]
    _record_guest_request_event(
        request_id=request_id, event_type=request.status, current_user=current_user, detail=request.detail
    )
    return {"data": record}


@router.post("/{request_id}/messages")
async def send_guest_message(
    request_id: str,
    request: CreateGuestMessageRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in MESSAGE_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to contact guests")
    guest_request = supabase.table("guest_requests").select(
        "id, contact_consent_at, contact_opted_out_at, contact_preference, guest_phone"
    ).eq("id", request_id).eq("tenant_id", current_user.hotel_id).maybe_single().execute().data
    if not guest_request:
        raise HTTPException(status_code=404, detail="Guest request not found")
    if request.channel == "sms" and (not guest_request.get("contact_consent_at") or guest_request.get("contact_opted_out_at")):
        raise HTTPException(status_code=422, detail="SMS consent is required and may not be opted out")

    recipient = request.recipient or guest_request.get("guest_phone")
    if not recipient and request.channel == "sms":
        raise HTTPException(status_code=422, detail="No recipient phone number on file for this guest request")

    message = supabase.table("guest_messages").insert({
        "tenant_id": current_user.hotel_id,
        "guest_request_id": request_id,
        "direction": "outbound",
        "channel": request.channel,
        "body": request.body,
        "recipient": recipient,
        "delivery_status": "queued",
        "excluded_from_ai": True,
        "created_by": current_user.user_id,
    }).execute().data[0]

    if request.channel != "sms":
        # Email is out of scope this phase — queue only, no send attempt.
        _record_message_delivery(
            tenant_id=current_user.hotel_id, message_id=message["id"], status="queued",
            failure_reason="channel_not_implemented",
        )
        _record_guest_request_event(
            request_id=request_id, event_type="guest_contacted", current_user=current_user,
            detail="Guest message queued", metadata={"message_id": message["id"], "channel": request.channel},
        )
        return {"data": message}

    try:
        result = send_sms(to=recipient, body=request.body)
    except SmsOptedOutError as exc:
        supabase.table("guest_requests").update({
            "contact_opted_out_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", request_id).eq("tenant_id", current_user.hotel_id).execute()
        _record_message_delivery(
            tenant_id=current_user.hotel_id, message_id=message["id"], status="opted_out",
            error_code=exc.error_code, failure_reason="unsubscribed_recipient",
        )
        _record_guest_request_event(
            request_id=request_id, event_type="note", current_user=current_user,
            detail="Guest opted out of SMS", source="automation",
        )
        raise HTTPException(status_code=422, detail="Guest has opted out of SMS") from exc
    except SmsNotConfiguredError:
        _record_message_delivery(
            tenant_id=current_user.hotel_id, message_id=message["id"], status="queued",
            failure_reason="sms_provider_not_configured",
        )
    except SmsSendError as exc:
        _record_message_delivery(
            tenant_id=current_user.hotel_id, message_id=message["id"], status="failed",
            error_code=exc.error_code, failure_reason="provider_error",
        )
        raise HTTPException(status_code=502, detail="SMS provider rejected the message") from exc
    else:
        _record_message_delivery(
            tenant_id=current_user.hotel_id, message_id=message["id"], status="sent",
            provider_message_id=result["provider_message_id"],
        )

    _record_guest_request_event(
        request_id=request_id, event_type="guest_contacted", current_user=current_user,
        detail="Guest message queued", metadata={"message_id": message["id"], "channel": request.channel},
    )
    return {"data": message}


@router.get("/{request_id}/messages")
async def list_guest_messages(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in MESSAGE_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to view guest messages")
    guest_request = supabase.table("guest_requests").select("id").eq("id", request_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
    if not guest_request:
        raise HTTPException(status_code=404, detail="Guest request not found")
    messages = supabase.table("guest_messages").select(
        "id, direction, channel, body, recipient, delivery_status, created_at"
    ).eq("guest_request_id", request_id).eq(
        "tenant_id", current_user.hotel_id
    ).order("created_at").execute().data or []
    events = supabase.table("guest_message_delivery_events").select(
        "guest_message_id, status, error_code, failure_reason, created_at"
    ).eq("tenant_id", current_user.hotel_id).in_(
        "guest_message_id", [m["id"] for m in messages] or ["00000000-0000-0000-0000-000000000000"]
    ).order("created_at").execute().data or []
    latest: dict[str, dict] = {}
    for event in events:
        latest[event["guest_message_id"]] = event
    for message in messages:
        event = latest.get(message["id"])
        message["effective_delivery_status"] = event["status"] if event else message["delivery_status"]
        message["failure_reason"] = event.get("failure_reason") if event else None
    return {"data": messages}


@router.post("/{request_id}/recovery-actions")
async def record_guest_recovery_action(
    request_id: str,
    request: RecordGuestRecoveryActionRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    guest_request = supabase.table("guest_requests").select("id").eq("id", request_id).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
    if not guest_request:
        raise HTTPException(status_code=404, detail="Guest request not found")
    requires_approval = request.compensation_amount is not None and request.compensation_amount > 0
    if requires_approval and current_user.role not in {"gm", "front_desk"}:
        raise HTTPException(status_code=403, detail="Only front desk or GM may request compensation")
    action = supabase.table("guest_recovery_actions").insert({
        "tenant_id": current_user.hotel_id,
        "guest_request_id": request_id,
        **request.model_dump(),
        "requested_by": current_user.user_id,
        "approved_by": current_user.user_id if current_user.role == "gm" else None,
    }).execute().data[0]
    _record_guest_request_event(
        request_id=request_id, event_type="note", current_user=current_user,
        detail="Service-recovery action recorded", metadata={"action_id": action["id"]},
    )
    return {"data": action}


@router.get("/metrics/summary")
async def get_guest_request_metrics(current_user: CurrentUser = Depends(get_current_user)):
    requests = supabase.table("guest_requests").select(
        "created_at, acknowledged_at, verified_at, due_at, status"
    ).eq("tenant_id", current_user.hotel_id).execute().data or []
    return {"data": calculate_guest_request_metrics(requests)}


@router.get("/accessibility/features")
async def list_accessible_room_features(
    current_user: CurrentUser = Depends(get_current_user),
):
    features = supabase.table("accessible_room_features").select(
        "*, rooms(room_number, floor)"
    ).eq("tenant_id", current_user.hotel_id).order("feature_code").execute().data or []
    return {"data": features}


@router.get("/sla-policies")
async def list_guest_request_sla_policies(
    current_user: CurrentUser = Depends(get_current_user),
):
    policies = supabase.table("guest_request_sla_policies").select("*").eq(
        "tenant_id", current_user.hotel_id
    ).order("created_at").execute().data or []
    policies.sort(
        key=lambda policy: sum(
            policy.get(field) is not None for field in ("category", "priority", "guest_impact")
        ),
        reverse=True,
    )
    return {"data": policies}


@router.post("/sla-policies")
async def create_guest_request_sla_policy(
    request: CreateGuestRequestSlaPolicyRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in SLA_POLICY_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to manage SLA rules")
    if request.category is None and request.priority is None and request.guest_impact is None:
        raise HTTPException(
            status_code=422,
            detail="An SLA rule must set at least one of category, priority, or guest impact",
        )
    # The table has no unique constraint on the triple; enforce it here so the settings UI
    # cannot silently create two rules that the specificity resolver would tie-break arbitrarily.
    duplicates = supabase.table("guest_request_sla_policies").select(
        "id, category, priority, guest_impact"
    ).eq("tenant_id", current_user.hotel_id).execute().data or []
    for policy in duplicates:
        if (
            policy.get("category") == request.category
            and policy.get("priority") == request.priority
            and policy.get("guest_impact") == request.guest_impact
        ):
            raise HTTPException(status_code=409, detail="An SLA rule already exists for this combination")
    record = supabase.table("guest_request_sla_policies").insert({
        "tenant_id": current_user.hotel_id,
        **request.model_dump(),
        "created_by": current_user.user_id,
    }).execute().data[0]
    return {"data": record}


@router.delete("/sla-policies/{policy_id}", status_code=204)
async def delete_guest_request_sla_policy(
    policy_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in SLA_POLICY_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to manage SLA rules")
    existing = supabase.table("guest_request_sla_policies").select("id").eq(
        "id", policy_id
    ).eq("tenant_id", current_user.hotel_id).maybe_single().execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="SLA rule not found")
    supabase.table("guest_request_sla_policies").delete().eq("id", policy_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute()


@router.put("/accessibility/features")
async def upsert_accessible_room_feature(
    request: UpsertAccessibleRoomFeatureRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.role not in {"gm", "housekeeping_supervisor", "engineer"}:
        raise HTTPException(status_code=403, detail="Not authorized to manage accessible-room features")
    room = supabase.table("rooms").select("id").eq("id", str(request.room_id)).eq(
        "tenant_id", current_user.hotel_id
    ).maybe_single().execute().data
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    record = supabase.table("accessible_room_features").upsert({
        "tenant_id": current_user.hotel_id,
        **request.model_dump(mode="json"),
        "last_verified_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="tenant_id,room_id,feature_code").execute().data[0]
    return {"data": record}


@router.get("")
async def list_guest_requests(
    status: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    page: int = Query(1),
    per_page: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    """List guest requests with optional filters."""
    query = supabase.table("guest_requests")\
        .select("*, rooms(room_number)")\
        .eq("tenant_id", current_user.hotel_id)\
        .order("created_at", desc=True)\
        .range((page - 1) * per_page, page * per_page - 1)

    if status:
        query = query.eq("status", status)
    if room_id:
        query = query.eq("room_id", room_id)

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.patch("/{request_id}")
async def update_guest_request(
    request_id: str,
    body: dict,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Update guest request — full edit with cascade to linked task."""
    notes = body.get("notes")
    update_data = {k: v for k, v in body.items() if k in GUEST_REQUEST_UPDATE_COLUMNS}

    if update_data.get("status") == "resolved" and "resolved_at" not in update_data:
        update_data["resolved_at"] = datetime.now(timezone.utc).isoformat()
    if update_data.get("status") == "resolved" and "resolved_by" not in update_data:
        update_data["resolved_by"] = current_user.user_id

    if update_data:
        result = supabase.table("guest_requests")\
            .update(update_data)\
            .eq("id", request_id)\
            .eq("tenant_id", current_user.hotel_id)\
            .execute()
    else:
        result = supabase.table("guest_requests")\
            .select("*")\
            .eq("id", request_id)\
            .eq("tenant_id", current_user.hotel_id)\
            .maybe_single()\
            .execute()

    gr = result.data[0] if isinstance(result.data, list) and result.data else result.data
    if not gr:
        raise HTTPException(status_code=404, detail="Guest request not found")

    # Cascade title/description edits to the linked task
    task_id = gr.get("task_id")
    task_cascade: dict = {}
    if "title" in update_data:
        task_cascade["title"] = update_data["title"]
    if "description" in update_data:
        task_cascade["description"] = update_data["description"]
    if task_id and task_cascade:
        supabase.table("tasks") \
            .update(task_cascade) \
            .eq("id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()

    if task_id and isinstance(notes, str) and notes.strip():
        supabase.table("task_comments").insert({
            "task_id": task_id,
            "tenant_id": current_user.hotel_id,
            "user_id": current_user.user_id,
            "comment": notes.strip(),
        }).execute()

    return {"data": gr}


@router.delete("/{request_id}", status_code=204)
async def delete_guest_request(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user)
):
    gr = supabase.table("guest_requests") \
        .select("task_id") \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .maybe_single() \
        .execute()

    if not gr or not gr.data:
        raise HTTPException(status_code=404, detail="Guest request not found")

    task_id = gr.data.get("task_id")

    supabase.table("guest_requests") \
        .delete() \
        .eq("id", request_id) \
        .eq("tenant_id", current_user.hotel_id) \
        .execute()

    if task_id:
        supabase.table("task_comments") \
            .delete() \
            .eq("task_id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
        supabase.table("tasks") \
            .delete() \
            .eq("id", task_id) \
            .eq("tenant_id", current_user.hotel_id) \
            .execute()
