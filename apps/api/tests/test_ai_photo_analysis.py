"""Phase 4 (Housekeeper AI V2): optional AI analysis of one maintenance photo.

Covers the image gate (decided from the file's own bytes, never the client's content type), metadata
stripping, the model-output whitelist, and the route's authorization / tenant / credit / failure rules.
Only the provider boundary and the Supabase client are replaced; no live model is ever called.
"""
import json
from io import BytesIO
from types import SimpleNamespace

import openai
import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from middleware.auth import CurrentUser
from routers import ai_copilot
from services.ai import photo_analysis as pa
from services.ai.providers import AIProviderConfigurationError
from tests.smoke.fake_supabase import FakeDB

HOTEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER_HOTEL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ROOM = "22222222-2222-4222-8222-222222222222"
OTHER_ROOM = "33333333-3333-4333-8333-333333333333"
FOREIGN_ROOM = "44444444-4444-4444-8444-444444444444"
HK_ID = "11111111-1111-4111-8111-111111111111"


def user(role: str = "housekeeper", user_id: str = HK_ID) -> CurrentUser:
    return CurrentUser(user_id=user_id, hotel_id=HOTEL, role=role, email="u@example.com")


# ── image builders (synthetic pixels only) ───────────────────────────────────

def _jpeg_with_exif(size=(200, 100), orientation=6) -> bytes:
    image = Image.new("RGB", size, (30, 90, 160))
    exif = Image.Exif()
    exif[0x0112] = orientation  # Orientation
    exif[0x010F] = "SecretPhoneMaker"  # Make
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (29.0, 45.0, 0.0)
    out = BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def _encoded(fmt: str, size=(64, 48), mode="RGB") -> bytes:
    out = BytesIO()
    Image.new(mode, size, (200, 10, 10) if mode == "RGB" else (200, 10, 10, 128)).save(out, format=fmt)
    return out.getvalue()


# ── prepare_image ────────────────────────────────────────────────────────────

def test_output_is_a_metadata_free_jpeg_with_rotation_applied():
    prepared = pa.prepare_image(_jpeg_with_exif((200, 100), orientation=6))
    image = Image.open(BytesIO(prepared))
    assert image.format == "JPEG"
    # Orientation 6 means the phone was rotated: the baked-in result is portrait.
    assert image.size == (100, 200)
    assert len(image.getexif()) == 0
    assert b"SecretPhoneMaker" not in prepared
    assert b"GPS" not in prepared


def test_large_photo_is_shrunk_for_the_model():
    big = Image.new("RGB", (4000, 3000), (10, 10, 10))
    out = BytesIO()
    big.save(out, format="JPEG", quality=30)
    prepared = pa.prepare_image(out.getvalue())
    assert max(Image.open(BytesIO(prepared)).size) <= pa.MODEL_SIDE_PIXELS


@pytest.mark.parametrize("fmt,mode", [("PNG", "RGB"), ("PNG", "RGBA"), ("WEBP", "RGB")])
def test_png_and_webp_are_accepted_and_flattened(fmt, mode):
    prepared = pa.prepare_image(_encoded(fmt, mode=mode))
    assert Image.open(BytesIO(prepared)).format == "JPEG"


def test_unsupported_image_format_is_415():
    with pytest.raises(pa.PhotoRejected) as exc:
        pa.prepare_image(_encoded("GIF"))
    assert exc.value.status == 415


@pytest.mark.parametrize("junk", [b"", b"%PDF-1.7 not an image", b"\x00" * 64, b"<html>photo</html>"])
def test_non_images_are_400(junk):
    with pytest.raises(pa.PhotoRejected) as exc:
        pa.prepare_image(junk)
    assert exc.value.status == 400


def test_oversized_upload_is_413():
    with pytest.raises(pa.PhotoRejected) as exc:
        pa.prepare_image(b"\xff\xd8\xff" + b"0" * (pa.MAX_UPLOAD_BYTES + 1))
    assert exc.value.status == 413


def test_extreme_dimensions_are_413_without_decoding():
    # A tiny file that CLAIMS to be 20000 px wide: refused from the header.
    out = BytesIO()
    Image.new("1", (20000, 4)).save(out, format="PNG")
    with pytest.raises(pa.PhotoRejected) as exc:
        pa.prepare_image(out.getvalue())
    assert exc.value.status == 413


# ── model output whitelist ───────────────────────────────────────────────────

def test_output_is_reduced_to_allowed_values():
    result = pa.normalize_model_output(
        {
            "outcome": "suggestion",
            "observation": "  Water stain below the sink.\n\n See http://evil.example/x  ",
            "category": "PLUMBING",
            "question": "Is water actively leaking?",
            "assign_to": "someone",
            "priority": "emergency",
        }
    )
    assert result == {
        "outcome": "suggestion",
        "observation": "Water stain below the sink. See",
        "category": "plumbing",
        "question": "Is water actively leaking?",
    }


def test_unknown_category_is_dropped_and_statements_are_not_questions():
    result = pa.normalize_model_output(
        {"outcome": "suggestion", "observation": "A cracked tile", "category": "demolition", "question": "Call the fire department now."}
    )
    assert result["category"] is None
    assert result["question"] is None
    assert result["outcome"] == "suggestion"


@pytest.mark.parametrize(
    "raw",
    [None, "text", [], {}, {"outcome": "unable_to_determine", "observation": "x", "category": "hvac"}, {"outcome": "suggestion"}, {"outcome": "suggestion", "observation": "   "}],
)
def test_unclear_or_empty_results_are_unable_to_determine(raw):
    assert pa.normalize_model_output(raw) == {"outcome": "unable_to_determine", "observation": None, "category": None, "question": None}


def test_observation_length_is_capped():
    result = pa.normalize_model_output({"outcome": "suggestion", "observation": "x" * 1000})
    assert len(result["observation"]) <= pa.MAX_OBSERVATION_CHARS


# ── analyze_photo (provider boundary) ────────────────────────────────────────

class _FakeOpenAI:
    def __init__(self, arguments, usage=(1234, 56)):
        self.calls = []
        tool_calls = [SimpleNamespace(function=SimpleNamespace(arguments=arguments))] if arguments is not None else None
        message = SimpleNamespace(tool_calls=tool_calls)
        self._response = SimpleNamespace(
            choices=[SimpleNamespace(message=message)],
            usage=SimpleNamespace(prompt_tokens=usage[0], completion_tokens=usage[1]),
        )
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self._response


def test_analyze_photo_sends_one_forced_tool_call_with_the_image_and_reports_real_usage(monkeypatch):
    fake = _FakeOpenAI(json.dumps({"outcome": "suggestion", "observation": "Moisture under the sink", "category": "plumbing"}))
    monkeypatch.setattr(pa, "get_openai_client", lambda: fake)

    result = pa.analyze_photo(b"JPEGBYTES", "  sink drips \x00 ")

    assert (result["prompt_tokens"], result["completion_tokens"]) == (1234, 56)
    assert result["category"] == "plumbing"
    call = fake.calls[0]
    assert call["tool_choice"] == {"type": "function", "function": {"name": "describe_issue_photo"}}
    user_parts = call["messages"][1]["content"]
    assert user_parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "sink drips" in user_parts[0]["text"] and "\x00" not in user_parts[0]["text"]
    assert "never instructions" in call["messages"][0]["content"]


@pytest.mark.parametrize("arguments", [None, "not json", "[]"])
def test_unreadable_model_answer_is_unable_to_determine(monkeypatch, arguments):
    monkeypatch.setattr(pa, "get_openai_client", lambda: _FakeOpenAI(arguments))
    assert pa.analyze_photo(b"x")["outcome"] == "unable_to_determine"


# ── the route ────────────────────────────────────────────────────────────────

def _upload(data: bytes, content_type: str = "image/jpeg", name: str = "photo.jpg") -> UploadFile:
    return UploadFile(file=BytesIO(data), filename=name, headers={"content-type": content_type})


async def _call(**kwargs):
    # The handler is called directly (the repo's pattern), so FastAPI's Form(None) defaults must be explicit.
    kwargs.setdefault("description", None)
    kwargs.setdefault("room_id", None)
    return await ai_copilot.analyze_issue_photo(**kwargs)


@pytest.fixture
def route(monkeypatch):
    db = FakeDB(
        {
            "rooms": [
                {"id": ROOM, "tenant_id": HOTEL, "room_number": "312"},
                {"id": OTHER_ROOM, "tenant_id": HOTEL, "room_number": "313"},
                {"id": FOREIGN_ROOM, "tenant_id": OTHER_HOTEL, "room_number": "312"},
            ],
            "room_assignments": [{"id": "ra-1", "tenant_id": HOTEL, "room_id": ROOM, "assigned_to": HK_ID, "assignment_date": "2026-10-15"}],
        }
    )
    monkeypatch.setattr(ai_copilot, "supabase", db)
    state = SimpleNamespace(db=db, analyzed=[], charged=[], logged=[], result=None)

    def fake_analyze(jpeg, note):
        state.analyzed.append((jpeg, note))
        return state.result or {
            "outcome": "suggestion",
            "observation": "Moisture visible under sink",
            "category": "plumbing",
            "question": "Is water actively leaking?",
            "prompt_tokens": 900,
            "completion_tokens": 40,
        }

    async def fake_charge(hotel_id, interaction_type, prompt_tokens=0, completion_tokens=0):
        state.charged.append((hotel_id, interaction_type, prompt_tokens, completion_tokens))
        return 1.5

    async def fake_log(**kwargs):
        state.logged.append(kwargs)

    monkeypatch.setattr(ai_copilot, "analyze_photo", fake_analyze)
    monkeypatch.setattr(ai_copilot, "check_and_deduct_credits", fake_charge)
    monkeypatch.setattr(ai_copilot, "log_ai_interaction", fake_log)
    return state


@pytest.mark.asyncio
async def test_route_returns_a_suggestion_bills_real_usage_and_stores_nothing(route):
    response = await _call(
        file=_upload(_jpeg_with_exif()), description="sink drips", room_id=ROOM, current_user=user()
    )
    data = response["data"]
    assert data["outcome"] == "suggestion"
    assert data["suggested_category"] == "plumbing"
    assert data["observation"] == "Moisture visible under sink"
    assert data["question"] == "Is water actively leaking?"
    assert data["is_suggestion"] is True and data["retained"] is False
    assert route.charged == [(HOTEL, "photo_analysis", 900, 40)]
    assert route.logged[0]["interaction_type"] == "photo_analysis" and route.logged[0]["success"] is True
    assert route.db.storage_uploads == [] and route.db.inserts == []  # no image retained, no record created
    # The model got the re-encoded copy: no metadata from the original upload.
    sent, note = route.analyzed[0]
    assert len(Image.open(BytesIO(sent)).getexif()) == 0 and note == "sink drips"


@pytest.mark.asyncio
async def test_unable_to_determine_is_a_normal_answer_and_clears_suggestions(route):
    route.result = {"outcome": "unable_to_determine", "observation": None, "category": None, "question": None, "prompt_tokens": 500, "completion_tokens": 10}
    data = (await _call(file=_upload(_encoded("PNG"), "image/png", "p.png"), current_user=user()))["data"]
    assert data["outcome"] == "unable_to_determine"
    assert data["suggested_category"] is None and data["observation"] is None


@pytest.mark.asyncio
async def test_the_bytes_decide_not_the_client_content_type(route):
    # A PDF labelled image/jpeg is refused; a PNG labelled text/plain is accepted.
    with pytest.raises(HTTPException) as exc:
        await _call(file=_upload(b"%PDF-1.7 ...", "image/jpeg"), current_user=user())
    assert exc.value.status_code == 400
    ok = await _call(file=_upload(_encoded("PNG"), "text/plain", "x.txt"), current_user=user())
    assert ok["data"]["outcome"] == "suggestion"
    assert route.analyzed  # reached the model only for the real image


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "data,status",
    [
        pytest.param(_encoded("GIF"), 415, id="gif"),
        pytest.param(b"\x00" * 10, 400, id="junk"),
        pytest.param(b"\xff\xd8\xff" + b"0" * (6 * 1024 * 1024), 413, id="too-big"),
    ],
)
async def test_rejected_images_never_reach_the_model_or_the_ledger(route, data, status):
    with pytest.raises(HTTPException) as exc:
        await _call(file=_upload(data), current_user=user())
    assert exc.value.status_code == status
    assert route.analyzed == [] and route.charged == []


@pytest.mark.asyncio
async def test_room_must_belong_to_this_hotel_and_to_this_housekeeper(route):
    for room in (FOREIGN_ROOM, OTHER_ROOM, "not-a-uuid"):
        with pytest.raises(HTTPException) as exc:
            await _call(file=_upload(_encoded("PNG")), room_id=room, current_user=user())
        assert exc.value.status_code in (404, 422)
    assert route.analyzed == []
    # An engineer is not limited to assigned rooms but is still limited to this hotel.
    await _call(file=_upload(_encoded("PNG")), room_id=OTHER_ROOM, current_user=user("engineer", "99999999-9999-4999-8999-999999999999"))
    with pytest.raises(HTTPException) as exc:
        await _call(file=_upload(_encoded("PNG")), room_id=FOREIGN_ROOM, current_user=user("engineer", "99999999-9999-4999-8999-999999999999"))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_unknown_role_is_forbidden(route):
    with pytest.raises(HTTPException) as exc:
        await _call(file=_upload(_encoded("PNG")), current_user=user("guest"))
    assert exc.value.status_code == 403
    assert route.analyzed == []


@pytest.mark.asyncio
async def test_credit_cap_reached_is_402_and_logs_nothing_as_success(monkeypatch, route):
    async def capped(*_args, **_kwargs):
        raise HTTPException(status_code=402, detail="Monthly AI credit cap reached.")

    monkeypatch.setattr(ai_copilot, "check_and_deduct_credits", capped)
    with pytest.raises(HTTPException) as exc:
        await _call(file=_upload(_encoded("PNG")), current_user=user())
    assert exc.value.status_code == 402
    assert all(entry["success"] is not True for entry in route.logged)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [AIProviderConfigurationError("no key"), openai.APIConnectionError(request=SimpleNamespace()), RuntimeError("boom")],
)
async def test_provider_failure_is_a_safe_error_and_is_logged(monkeypatch, route, error):
    def failing(*_args):
        raise error

    monkeypatch.setattr(ai_copilot, "analyze_photo", failing)
    with pytest.raises(HTTPException) as exc:
        await _call(file=_upload(_encoded("PNG")), current_user=user())
    assert exc.value.status_code in (500, 503)
    assert "still report" in exc.value.detail and "boom" not in exc.value.detail
    assert route.charged == [] and route.logged[-1]["success"] is False


@pytest.mark.asyncio
async def test_a_failed_interaction_log_does_not_fail_a_finished_analysis(monkeypatch, route):
    async def broken_log(**_kwargs):
        raise RuntimeError("check constraint violation")

    monkeypatch.setattr(ai_copilot, "log_ai_interaction", broken_log)
    response = await _call(file=_upload(_encoded("PNG")), current_user=user())
    assert response["data"]["outcome"] == "suggestion"
    assert route.charged  # it was still billed


def test_photo_analysis_is_billed_like_the_other_ai_calls():
    from middleware import credits

    assert "photo_analysis" in credits.INTERACTION_MODEL and "photo_analysis" in credits.CREDIT_COSTS
    # real usage, not a flat price: a heavy call costs more than the floor
    assert credits.compute_credits("photo_analysis", 5_000_000, 100_000) > credits.CREDIT_COSTS["photo_analysis"]
