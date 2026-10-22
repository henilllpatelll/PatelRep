"""Inspection evidence must be linked to the failed checklist item."""

from io import BytesIO

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from middleware.auth import CurrentUser
from routers import housekeeping as housekeeping_router
from tests.smoke.fake_supabase import FakeDB


SUPERVISOR = CurrentUser(
    user_id="sup-1",
    hotel_id="hotel-a",
    role="housekeeping_supervisor",
    email="sup@example.com",
)


@pytest.mark.asyncio
async def test_inspection_photo_is_stored_on_its_matching_result(monkeypatch):
    db = FakeDB({
        "inspections": [{"id": "inspection-1", "tenant_id": "hotel-a"}],
        "inspection_results": [{
            "id": "result-1",
            "inspection_id": "inspection-1",
            "template_item_id": "item-1",
            "tenant_id": "hotel-a",
            "result": "fail",
            "photo_url": None,
        }],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    photo = UploadFile(
        filename="evidence.png",
        file=BytesIO(b"png-bytes"),
        headers=Headers({"content-type": "image/png"}),
    )

    response = await housekeeping_router.upload_inspection_photo(
        "inspection-1", "item-1", photo, SUPERVISOR
    )

    assert response["data"]["template_item_id"] == "item-1"
    # Private bucket + a stored path; the response is a short-lived signed link, never a permanent public address.
    stored = db.rows["inspection_results"][0]
    assert stored["photo_url"] is None
    assert stored["photo_path"].startswith("hotel-a/inspections/inspection-1/item-1-")
    assert response["data"]["url"].startswith("https://storage.test/signed/inspection-evidence/")
    assert db.storage_uploads[0][0] == "inspection-evidence"
