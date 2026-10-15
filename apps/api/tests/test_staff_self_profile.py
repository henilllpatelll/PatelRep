"""Mobile Settings Phase 2 — self-service profile: preferred name + private avatar.

Handlers are called directly (repo convention). The caller identity is always the verified
CurrentUser, never a request value, so "cannot edit someone else / change role or tenant" is asserted
by (a) the request model rejecting those fields and (b) every query being scoped to the caller.
"""
import io
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

from middleware.auth import CurrentUser
from models.requests import UpdateOwnProfileRequest
from routers import staff as staff_router
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
ME = CurrentUser(user_id="hk-1", hotel_id=H1, role="housekeeper", email="maria@hotel.com")
OTHER_HOTEL_SAME_ID = CurrentUser(user_id="hk-1", hotel_id=H2, role="housekeeper", email="maria@hotel.com")

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _upload(data: bytes, content_type: str) -> UploadFile:
    return UploadFile(filename="x", file=io.BytesIO(data), headers={"content-type": content_type})


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "tenants": [{"id": H1, "name": "Fossil Creek Inn"}, {"id": H2, "name": "Other Hotel"}],
        "user_profiles": [
            {"id": "hk-1", "tenant_id": H1, "full_name": "Maria Vega", "preferred_name": None,
             "avatar_url": "https://cdn.example/gm-set.png", "avatar_path": None},
            {"id": "hk-2", "tenant_id": H1, "full_name": "Other Person", "preferred_name": "Op",
             "avatar_url": None, "avatar_path": None},
        ],
    })
    fake.storage_removed = []
    original_from = fake.storage.from_

    def from_(bucket):
        b = original_from(bucket)
        b.remove = lambda paths: fake.storage_removed.extend((bucket, p) for p in paths)
        return b

    fake.storage.from_ = from_
    monkeypatch.setattr(staff_router, "supabase", fake)
    return fake


def _row(db, uid="hk-1"):
    return next(r for r in db.rows["user_profiles"] if r["id"] == uid)


@pytest.mark.asyncio
async def test_get_profile_returns_identity_from_the_verified_caller(db):
    res = (await staff_router.get_own_profile(ME))["data"]
    assert res["full_name"] == "Maria Vega"
    assert res["email"] == "maria@hotel.com"
    assert res["role"] == "housekeeper"
    assert res["hotel_name"] == "Fossil Creek Inn"
    assert res["avatar_url"] == "https://cdn.example/gm-set.png"
    assert res["has_uploaded_avatar"] is False


@pytest.mark.asyncio
async def test_profile_is_tenant_scoped(db):
    with pytest.raises(HTTPException) as exc:
        await staff_router.get_own_profile(OTHER_HOTEL_SAME_ID)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_preferred_name_trims_and_touches_only_the_callers_row(db):
    res = (await staff_router.update_own_profile(UpdateOwnProfileRequest(preferred_name="  Mari  "), ME))["data"]
    assert res["preferred_name"] == "Mari"
    assert _row(db)["preferred_name"] == "Mari"
    assert _row(db, "hk-2")["preferred_name"] == "Op"
    assert _row(db)["full_name"] == "Maria Vega"


@pytest.mark.asyncio
async def test_update_in_another_tenant_cannot_reach_the_row(db):
    with pytest.raises(HTTPException) as exc:
        await staff_router.update_own_profile(UpdateOwnProfileRequest(preferred_name="Hacked"), OTHER_HOTEL_SAME_ID)
    assert exc.value.status_code == 404
    assert _row(db)["preferred_name"] is None


@pytest.mark.parametrize("field,value", [
    ("role", "gm"), ("tenant_id", "hotel-2"), ("full_name", "New Name"), ("id", "hk-2"),
    ("is_active", False), ("phone", "1"), ("avatar_url", "https://evil.example/x.png"),
    ("avatar_path", "hotel-2/hk-9/x.jpg"), ("permissions", ["all"]),
])
def test_request_model_rejects_every_hotel_managed_field(field, value):
    with pytest.raises(ValidationError):
        UpdateOwnProfileRequest(**{"preferred_name": "Ok", field: value})


@pytest.mark.parametrize("name", ["", "   ", "x" * 41])
def test_preferred_name_validation(name):
    with pytest.raises(ValidationError):
        UpdateOwnProfileRequest(preferred_name=name)


@pytest.mark.asyncio
async def test_empty_update_is_rejected(db):
    with pytest.raises(HTTPException) as exc:
        await staff_router.update_own_profile(UpdateOwnProfileRequest(), ME)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_avatar_upload_uses_opaque_private_path_signed_url_and_replaces_old_file(db):
    _row(db)["avatar_path"] = f"{H1}/hk-1/old.jpg"
    res = (await staff_router.upload_own_avatar(_upload(JPEG, "image/jpeg"), ME))["data"]

    bucket, path, contents = db.storage_uploads[0]
    assert bucket == "avatars"
    assert path.startswith(f"{H1}/hk-1/") and path.endswith(".jpg")
    assert contents == JPEG
    assert _row(db)["avatar_path"] == path
    assert res["avatar_url"].startswith("https://storage.test/signed/avatars/")
    assert res["has_uploaded_avatar"] is True
    assert ("avatars", f"{H1}/hk-1/old.jpg") in db.storage_removed


@pytest.mark.asyncio
async def test_avatar_upload_accepts_png(db):
    await staff_router.upload_own_avatar(_upload(PNG, "image/png"), ME)
    assert db.storage_uploads[0][1].endswith(".png")


@pytest.mark.asyncio
@pytest.mark.parametrize("data,ctype,status", [
    (JPEG, "image/gif", 400),
    (JPEG, "application/pdf", 400),
    (b"<html>not an image</html>", "image/jpeg", 400),   # spoofed MIME type
    (PNG, "image/jpeg", 400),                            # bytes do not match the declared type
    (b"", "image/jpeg", 400),
    (b"\xff\xd8\xff" + b"0" * (2 * 1024 * 1024), "image/jpeg", 413),
], ids=["gif", "pdf", "spoofed-html", "png-as-jpeg", "empty", "too-large"])
async def test_avatar_upload_rejects_bad_files(db, data, ctype, status):
    with pytest.raises(HTTPException) as exc:
        await staff_router.upload_own_avatar(_upload(data, ctype), ME)
    assert exc.value.status_code == status
    assert db.storage_uploads == []
    assert _row(db)["avatar_path"] is None


@pytest.mark.asyncio
async def test_avatar_upload_cleans_up_if_the_profile_row_cannot_be_updated(db):
    with pytest.raises(HTTPException) as exc:
        await staff_router.upload_own_avatar(_upload(JPEG, "image/jpeg"), OTHER_HOTEL_SAME_ID)
    assert exc.value.status_code == 404
    assert db.storage_uploads == []


@pytest.mark.asyncio
async def test_avatar_remove_clears_the_path_and_deletes_the_object(db):
    _row(db)["avatar_path"] = f"{H1}/hk-1/mine.jpg"
    res = (await staff_router.remove_own_avatar(ME))["data"]
    assert _row(db)["avatar_path"] is None
    assert ("avatars", f"{H1}/hk-1/mine.jpg") in db.storage_removed
    assert res["has_uploaded_avatar"] is False
    # Falls back to the GM-set URL, never to someone else's photo.
    assert res["avatar_url"] == "https://cdn.example/gm-set.png"


def test_self_update_guard_migration_protects_hotel_managed_columns():
    sql = (Path(__file__).resolve().parents[3] / "supabase/migrations/212_user_profile_self_service.sql").read_text()
    for col in ("tenant_id", "full_name", "phone", "employee_id", "avatar_url", "avatar_path", "is_active", "hire_date"):
        assert f"NEW.{col}" in sql and f"OLD.{col}" in sql
    for safe in ("preferred_name", "language_pref", "expo_push_token"):
        assert f"NEW.{safe}" not in sql, f"{safe} must stay self-editable"
    assert "'avatars', 'avatars', FALSE" in sql
    assert "CREATE POLICY" not in sql  # avatars bucket is API-only; no client storage policy
