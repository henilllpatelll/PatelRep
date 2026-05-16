import httpx
from datetime import date, datetime, timedelta
from core.database import supabase
from core.config import settings
from services.opera.auth import get_valid_access_token, get_opera_credentials


def ohip_request(method: str, path: str, hotel_id: str, opera_hotel_code: str = "", **kwargs) -> dict:
    """
    Make a request to the OHIP gateway.
    Required headers per spec: Authorization, x-app-key, x-hotelid.
    Returns empty dict if hotel not connected or on recoverable errors.
    """
    creds = get_opera_credentials(hotel_id)
    if not creds:
        return {}

    token = get_valid_access_token(hotel_id)
    if not token:
        return {}

    ohip_base = creds.get("ohip_base_url") or settings.opera_oauth_base_url
    url = f"{ohip_base}{path}"

    # x-hotelid must be the Opera property code (not our UUID)
    hotel_code = opera_hotel_code or creds.get("hotel_id_opera", "")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "x-app-key": settings.opera_app_key,
        "x-hotelid": hotel_code,
    }

    try:
        response = httpx.request(method, url, headers=headers, timeout=15.0, **kwargs)
        response.raise_for_status()
        return response.json()
    except httpx.TimeoutException:
        return {}
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 404):
            return {}
        raise


def map_opera_reservation(opera_res: dict) -> dict:
    """Map an Opera Cloud reservation dict to PatelRep schema fields."""
    guest = opera_res.get("guestProfile", {})
    guest_name = f"{guest.get('firstName', '')} {guest.get('lastName', '')}".strip()
    return {
        "guest_name": guest_name or None,
        "guest_email": guest.get("email"),
        "vip_flag": bool(guest.get("vipCode")),
        "vip_code": guest.get("vipCode"),
        "checkin_time": opera_res.get("arrivalDateTime"),
        "checkout_time": opera_res.get("departureDateTime"),
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


def upsert_opera_reservation(hotel_id: str, opera_res: dict) -> None:
    """Insert/update an Opera reservation in the local cache table."""
    mapped = map_opera_reservation(opera_res)
    reservation_id = mapped.get("opera_reservation_id")
    if not reservation_id:
        return

    room_id = None
    if mapped.get("room_number_opera"):
        room_result = supabase.table("rooms")\
            .select("id")\
            .eq("tenant_id", hotel_id)\
            .eq("room_number", mapped["room_number_opera"])\
            .maybe_single()\
            .execute()
        if room_result and room_result.data:
            room_id = room_result.data["id"]

    supabase.table("opera_reservations").upsert({
        "tenant_id": hotel_id,
        "opera_reservation_id": reservation_id,
        "room_id": room_id,
        "room_number_opera": mapped.get("room_number_opera"),
        "guest_name": mapped.get("guest_name"),
        "guest_email": mapped.get("guest_email"),
        "vip_code": mapped.get("vip_code"),
        "special_requests": mapped.get("special_requests"),
        "preferences": mapped.get("preferences", {}),
        "adults": mapped.get("adults", 1),
        "arrival_date": opera_res.get("arrivalDate"),
        "arrival_time": opera_res.get("arrivalTime"),
        "departure_date": opera_res.get("departureDate"),
        "departure_time": opera_res.get("departureTime"),
        "status": opera_res.get("reservationStatus", "RESERVED"),
        "rate_code": mapped.get("rate_code"),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="tenant_id,opera_reservation_id").execute()

    if room_id:
        supabase.table("room_status").update({
            "guest_name": mapped.get("guest_name"),
            "vip_flag": mapped.get("vip_flag", False),
            "checkin_time": mapped.get("checkin_time"),
            "checkout_time": mapped.get("checkout_time"),
        }).eq("room_id", room_id).execute()


def sync_reservations(hotel_id: str) -> dict:
    """
    Fetch today's and tomorrow's arrivals from Opera Cloud.
    Endpoint: GET /rsv/v1/hotels/{hotelId}/reservations
    Returns {"synced": count, "error": None|str}.
    """
    creds = get_opera_credentials(hotel_id)
    if not creds or not creds.get("hotel_id_opera"):
        return {"synced": 0, "error": "Opera not connected or hotel_id_opera not set"}

    opera_hotel_id = creds["hotel_id_opera"]
    today = date.today()
    tomorrow = today + timedelta(days=1)

    data = ohip_request(
        "GET",
        f"/rsv/v1/hotels/{opera_hotel_id}/reservations",
        hotel_id,
        opera_hotel_code=opera_hotel_id,
        params={
            "dateRangeStart": today.isoformat(),
            "dateRangeEnd": tomorrow.isoformat(),
            "roomStatusType": "ARRIVALS",
            "limit": 200,
        },
    )

    reservations = data.get("reservations", [])
    synced = 0
    for res in reservations:
        try:
            upsert_opera_reservation(hotel_id, res)
            synced += 1
        except Exception:
            pass

    supabase.table("opera_credentials").update({
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", hotel_id).execute()

    return {"synced": synced, "error": None}


def bootstrap_opera_data(hotel_id: str) -> dict:
    """
    Pull 90 days of historical reservation data for AI cold-start.
    Called once after initial connection.
    """
    creds = get_opera_credentials(hotel_id)
    if not creds or not creds.get("hotel_id_opera"):
        return {"synced": 0}

    opera_hotel_id = creds["hotel_id_opera"]
    start_date = date.today() - timedelta(days=90)
    end_date = date.today()
    offset = 0
    total_synced = 0

    while True:
        data = ohip_request(
            "GET",
            f"/rsv/v1/hotels/{opera_hotel_id}/reservations",
            hotel_id,
            opera_hotel_code=opera_hotel_id,
            params={
                "dateRangeStart": start_date.isoformat(),
                "dateRangeEnd": end_date.isoformat(),
                "roomStatusType": "HISTORY",
                "limit": 100,
                "offset": offset,
            },
        )
        reservations = data.get("reservations", [])
        if not reservations:
            break

        for res in reservations:
            try:
                upsert_opera_reservation(hotel_id, res)
                total_synced += 1
            except Exception:
                pass

        offset += len(reservations)
        if offset >= data.get("totalResults", 0):
            break

    return {"synced": total_synced}


def push_room_status_to_opera(hotel_id: str, room_number: str, new_status: str) -> None:
    """
    Push PatelRep room status back to Opera Cloud (bidirectional sync).
    Endpoint: PUT /hsk/v1/hotels/{hotelId}/rooms/status
    Body: housekeepingRoomStatusCriteria with roomList array.
    """
    creds = get_opera_credentials(hotel_id)
    if not creds or not creds.get("hotel_id_opera"):
        return

    opera_status_map = {
        "DIRTY": "DIRTY",
        "CLEAN": "CLEAN",
        "INSPECTED": "INSPECTED",
        "OOO": "OUT_OF_ORDER",
        "IN_PROGRESS": "DIRTY",
        "PICKUP": "PICKUP",
    }
    opera_status = opera_status_map.get(new_status, "DIRTY")
    opera_hotel_id = creds["hotel_id_opera"]

    try:
        ohip_request(
            "PUT",
            f"/hsk/v1/hotels/{opera_hotel_id}/rooms/status",
            hotel_id,
            opera_hotel_code=opera_hotel_id,
            json={
                "housekeepingRoomStatusCriteria": {
                    "roomList": [{"roomNumber": room_number}],
                    "housekeepingRoomStatus": opera_status,
                }
            },
        )
    except Exception:
        pass  # Opera push failures never block PatelRep operations
