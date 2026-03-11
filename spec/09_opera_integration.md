# PatelRep — Opera Cloud (OHIP) Integration Specification

## 1. Overview

Opera Cloud (OHIP - Oracle Hospitality Integration Platform) is the PMS for the target hotels. Integration provides:
- **Real-time room status changes** (checkout → dirty, check-in → occupied)
- **Reservation data** (arrivals, departures, VIP flags, special requests)
- **Guest profiles** (preferences, VIP tier, contact info)

Integration mode: **Hybrid** — webhooks for real-time critical events, scheduled polling for batch data.

---

## 2. OAuth 2.0 Authorization Flow

### 2.1 Flow Diagram

```
GM clicks "Connect Opera Cloud" in PatelRep Settings
    │
    ▼
PatelRep redirects GM to Oracle OHIP OAuth endpoint:
GET https://[ohip-host]/oauth/v1/token/authorize
    ?client_id={OPERA_OAUTH_CLIENT_ID}
    &response_type=code
    &redirect_uri=https://api.patelrep.com/v1/integrations/opera/callback
    &scope=reservations rooms guest_profile
    &state={random_csrf_token}
    │
    ▼
GM logs into Oracle OHIP portal and authorizes PatelRep access
    │
    ▼
Oracle redirects to:
GET https://api.patelrep.com/v1/integrations/opera/callback
    ?code={authorization_code}&state={csrf_token}
    │
    ▼
FastAPI exchanges code for tokens:
POST https://[ohip-host]/oauth/v1/token
    Body: grant_type=authorization_code
          code={authorization_code}
          client_id={CLIENT_ID}
          client_secret={CLIENT_SECRET}
          redirect_uri={REDIRECT_URI}
    │
    ▼
Response: { access_token, refresh_token, expires_in, hotel_id }
    │
    ▼
Store encrypted in opera_credentials (Supabase Vault)
Set is_connected = TRUE
    │
    ▼
Trigger initial reservation sync (90 days historical)
Redirect GM back to Settings page: "✓ Opera Cloud connected"
```

### 2.2 Token Refresh

```python
# services/opera/auth.py
async def get_valid_access_token(hotel_id: str) -> str:
    creds = await get_opera_credentials(hotel_id)

    if datetime.now() > creds.token_expires_at - timedelta(minutes=5):
        # Token expired or expiring soon — refresh
        response = await httpx.post(
            f"{creds.ohip_base_url}/oauth/v1/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": decrypt(creds.refresh_token),
                "client_id": settings.OPERA_OAUTH_CLIENT_ID,
                "client_secret": settings.OPERA_OAUTH_CLIENT_SECRET,
            }
        )
        new_tokens = response.json()
        await update_opera_credentials(hotel_id, new_tokens)
        return new_tokens["access_token"]

    return decrypt(creds.access_token)
```

---

## 3. Opera Business Events (Webhooks)

### 3.1 Webhook Registration

After OAuth connection, PatelRep registers to receive Business Events from OHIP:

```python
async def register_opera_webhooks(hotel_id: str, ohip_hotel_id: str):
    token = await get_valid_access_token(hotel_id)

    events_to_subscribe = [
        "RESERVATION.CHECKED_OUT",
        "RESERVATION.CHECKED_IN",
        "RESERVATION.MODIFIED",
        "ROOM_STATUS.DO_NOT_DISTURB",
        "ROOM_STATUS.MAKE_UP_ROOM",
    ]

    await ohip_client.post(
        f"/api/integration/v1/hotels/{ohip_hotel_id}/eventsubscriptions",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "subscriptionUrl": "https://api.patelrep.com/v1/webhooks/opera",
            "events": events_to_subscribe,
            "secretKey": generate_webhook_secret(hotel_id),  # For HMAC validation
        }
    )
```

### 3.2 Webhook Handler

```python
# routers/webhooks.py
@router.post("/webhooks/opera")
async def opera_webhook(request: Request):
    payload = await request.body()
    event_data = json.loads(payload)

    # Validate HMAC signature
    await validate_opera_signature(request, payload)

    hotel_id = await get_hotel_id_by_opera_hotel_id(event_data["hotelId"])
    event_type = event_data["eventType"]
    event_payload = event_data["payload"]

    handlers = {
        "RESERVATION.CHECKED_OUT": handle_checkout,
        "RESERVATION.CHECKED_IN": handle_checkin,
        "RESERVATION.MODIFIED": handle_reservation_modified,
        "ROOM_STATUS.DO_NOT_DISTURB": handle_dnd,
        "ROOM_STATUS.MAKE_UP_ROOM": handle_make_up_room,
    }

    handler = handlers.get(event_type)
    if handler:
        await handler(hotel_id, event_payload)

    return {"status": "ok"}
```

### 3.3 Event Handlers

```python
async def handle_checkout(hotel_id: str, payload: dict):
    """RESERVATION.CHECKED_OUT → mark room Dirty"""
    room_number = payload["roomNumber"]
    room = await get_room_by_number(hotel_id, room_number)
    if not room:
        return  # Room not in PatelRep (not configured yet)

    await update_room_status(
        room_id=room.id,
        status="DIRTY",
        guest_name=None,
        checkin_time=None,
        checkout_time=None,
        vip_flag=False,
        change_source="opera_webhook"
    )
    # Supabase Realtime auto-broadcasts to connected clients

async def handle_checkin(hotel_id: str, payload: dict):
    """RESERVATION.CHECKED_IN → update room with guest profile"""
    room_number = payload["roomNumber"]
    reservation = payload["reservation"]
    room = await get_room_by_number(hotel_id, room_number)

    vip_code = reservation.get("guestProfile", {}).get("vipCode", "")

    await update_room_status(
        room_id=room.id,
        guest_name=f"{reservation['guestProfile']['firstName']} {reservation['guestProfile']['lastName']}",
        vip_flag=bool(vip_code),
        change_source="opera_webhook"
    )
    # Also cache reservation
    await upsert_opera_reservation(hotel_id, reservation)

async def handle_dnd(hotel_id: str, payload: dict):
    """ROOM_STATUS.DO_NOT_DISTURB → set dnd_flag"""
    room = await get_room_by_number(hotel_id, payload["roomNumber"])
    await supabase.table("room_status")\
        .update({"dnd_flag": True, "updated_at": "now()"})\
        .eq("room_id", room.id)\
        .execute()

async def handle_make_up_room(hotel_id: str, payload: dict):
    """Guest requests room service → create housekeeping task"""
    room = await get_room_by_number(hotel_id, payload["roomNumber"])
    # Auto-create task
    await create_task({
        "title": f"Make Up Room - {room.room_number}",
        "task_type": "housekeeping",
        "priority": "normal",
        "room_id": room.id,
        "is_ai_created": True,
        "created_by": "system",
    })
```

---

## 4. Scheduled Polling (Every 30 Minutes)

### 4.1 Reservation Sync

```python
# POST /internal/opera/sync-reservations
async def sync_reservations(hotel_id: str):
    token = await get_valid_access_token(hotel_id)
    creds = await get_opera_credentials(hotel_id)
    today = date.today()
    tomorrow = today + timedelta(days=1)

    # Fetch today's + tomorrow's arrivals
    response = await ohip_client.get(
        f"/api/rsv/v1/hotels/{creds.hotel_id_opera}/reservations",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "dateRangeStart": today.isoformat(),
            "dateRangeEnd": tomorrow.isoformat(),
            "roomStatusType": "ARRIVALS",
            "limit": 200
        }
    )
    reservations = response.json()["reservations"]

    for res in reservations:
        await upsert_opera_reservation(hotel_id, res)
        # Update room_status with upcoming guest info
        await update_room_checkin_context(hotel_id, res)

    # Update last_sync_at
    await update_opera_sync_time(hotel_id)
```

### 4.2 Data Mapping: Opera → PatelRep

```python
def map_opera_reservation_to_room_context(opera_res: dict) -> dict:
    guest = opera_res.get("guestProfile", {})
    return {
        "guest_name": f"{guest.get('firstName', '')} {guest.get('lastName', '')}".strip(),
        "guest_email": guest.get("email"),
        "vip_flag": bool(guest.get("vipCode")),
        "vip_code": guest.get("vipCode"),
        "checkin_time": parse_opera_datetime(opera_res.get("arrivalDateTime")),
        "checkout_time": parse_opera_datetime(opera_res.get("departureDateTime")),
        "special_requests": opera_res.get("comments", ""),
        "preferences": {
            "bed_type": opera_res.get("roomFeatures", {}).get("bedType"),
            "floor_preference": opera_res.get("roomFeatures", {}).get("floorPreference"),
        },
        "adults": opera_res.get("adults", 1),
        "room_number_opera": opera_res.get("roomNumber"),
        "opera_reservation_id": opera_res.get("reservationId"),
        "rate_code": opera_res.get("rateCode"),
    }
```

---

## 5. Opera Initial Bootstrap (Onboarding)

During hotel onboarding, after Opera is connected, trigger a 90-day historical sync:

```python
async def bootstrap_opera_data(hotel_id: str):
    """
    Run once during onboarding to populate historical data for AI cold-start.
    Pulls 90 days of reservation history to seed:
    - Room type usage patterns
    - Checkout timing patterns
    - Historical occupancy (used by predictions as proxy until real data accumulates)
    """
    token = await get_valid_access_token(hotel_id)
    creds = await get_opera_credentials(hotel_id)

    start_date = date.today() - timedelta(days=90)
    end_date = date.today()

    # Paginate through 90 days of checked-out reservations
    offset = 0
    while True:
        response = await ohip_client.get(
            f"/api/rsv/v1/hotels/{creds.hotel_id_opera}/reservations",
            params={
                "dateRangeStart": start_date.isoformat(),
                "dateRangeEnd": end_date.isoformat(),
                "roomStatusType": "HISTORY",
                "limit": 100,
                "offset": offset
            }
        )
        data = response.json()
        reservations = data.get("reservations", [])
        if not reservations:
            break

        for res in reservations:
            await upsert_opera_reservation(hotel_id, res)

        offset += len(reservations)
        if offset >= data.get("totalResults", 0):
            break
```

---

## 6. Opera Room Import (Onboarding Wizard)

```python
async def import_rooms_from_opera(hotel_id: str):
    """Import room inventory from Opera Cloud during onboarding"""
    token = await get_valid_access_token(hotel_id)
    creds = await get_opera_credentials(hotel_id)

    response = await ohip_client.get(
        f"/api/hskp/v1/hotels/{creds.hotel_id_opera}/rooms",
        headers={"Authorization": f"Bearer {token}"},
    )
    opera_rooms = response.json()["rooms"]

    for opera_room in opera_rooms:
        # Map Opera room type codes to PatelRep room types
        room_type = await get_or_create_room_type(
            hotel_id=hotel_id,
            code=opera_room["roomType"],
            name=opera_room["roomTypeDescription"],
        )
        await create_room({
            "hotel_id": hotel_id,
            "room_number": opera_room["roomNumber"],
            "floor": int(opera_room["floor"]),
            "room_type_id": room_type.id,
            "opera_room_id": opera_room["roomId"],
        })
```

---

## 7. Opera API Endpoints Used

| OHIP API | Endpoint | Purpose |
|---|---|---|
| Reservations API v1 | `GET /api/rsv/v1/hotels/{hotelId}/reservations` | Fetch arrivals/departures |
| Reservations API v1 | `GET /api/rsv/v1/hotels/{hotelId}/reservations/{resId}` | Get single reservation |
| Housekeeping API v1 | `GET /api/hskp/v1/hotels/{hotelId}/rooms` | Import room inventory |
| Housekeeping API v1 | `PUT /api/hskp/v1/hotels/{hotelId}/rooms/{roomNumber}/status` | Sync room status back to Opera |
| Guest Profiles API v1 | `GET /api/crm/v1/hotels/{hotelId}/profiles/{profileId}` | Fetch VIP + preferences |
| Event Subscriptions API | `POST /api/integration/v1/hotels/{hotelId}/eventsubscriptions` | Register webhook |
| OAuth API | `POST /oauth/v1/token` | Token exchange + refresh |

---

## 8. Opera → PatelRep Status Mapping

| Opera Room Status | PatelRep Status | Notes |
|---|---|---|
| `DIRTY` | `DIRTY` | Direct map |
| `CLEAN` | `CLEAN` | Direct map |
| `INSPECTED` | `INSPECTED` | Direct map |
| `OUT_OF_ORDER` | `OOO` | Direct map |
| `PICKUP` | `PICKUP` | Stayover light service |
| `DO_NOT_DISTURB` | `DIRTY` + `dnd_flag=true` | Keep as dirty, flag DND |

---

## 9. Bidirectional Sync (PatelRep → Opera)

When a room is marked `INSPECTED` in PatelRep, push the status back to Opera:

```python
async def push_room_status_to_opera(hotel_id: str, room: Room, new_status: str):
    """Sync room status changes back to Opera Cloud"""
    creds = await get_opera_credentials(hotel_id)
    if not creds.is_connected:
        return  # No integration, skip

    opera_status_map = {
        "DIRTY": "DIRTY",
        "CLEAN": "CLEAN",
        "INSPECTED": "INSPECTED",
        "OOO": "OUT_OF_ORDER",
        "IN_PROGRESS": "DIRTY",  # Opera doesn't have in-progress, keep as dirty
    }

    token = await get_valid_access_token(hotel_id)
    await ohip_client.put(
        f"/api/hskp/v1/hotels/{creds.hotel_id_opera}/rooms/{room.opera_room_id}/status",
        headers={"Authorization": f"Bearer {token}"},
        json={"roomStatus": opera_status_map.get(new_status, "DIRTY")}
    )
```

---

## 10. Integration Error Handling

```python
class OperaIntegrationError(Exception):
    pass

async def ohip_request(method: str, url: str, **kwargs) -> dict:
    try:
        response = await httpx_client.request(method, url, timeout=10.0, **kwargs)
        response.raise_for_status()
        return response.json()
    except httpx.TimeoutException:
        # Log but don't crash app — Opera unavailability shouldn't block operations
        await log_opera_error(hotel_id, "timeout", url)
        raise OperaIntegrationError("Opera Cloud timeout — operations continuing without sync")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            # Token expired — refresh and retry
            await refresh_opera_token(hotel_id)
            return await ohip_request(method, url, **kwargs)  # Retry once
        await log_opera_error(hotel_id, str(e.response.status_code), url)
        raise OperaIntegrationError(f"Opera API error: {e.response.status_code}")
```

**Key principle:** Opera Cloud is a data enrichment layer, not a dependency. If Opera is unreachable, PatelRep continues operating — staff can manually update room status. Opera errors are logged and shown in the integrations status panel but never block hotel operations.
