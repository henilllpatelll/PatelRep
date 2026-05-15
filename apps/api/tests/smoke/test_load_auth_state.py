import base64
import json

from tests.load import load_test


def _fake_jwt(claims: dict) -> str:
    def enc(payload: dict) -> str:
        raw = json.dumps(payload, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{enc({'alg': 'none'})}.{enc(claims)}.signature"


def test_token_from_playwright_local_storage_state(tmp_path):
    token = _fake_jwt({"sub": "user-1", "hotel_id": "hotel-a"})
    state_path = tmp_path / "state.json"
    state_path.write_text(
        json.dumps({
            "cookies": [],
            "origins": [{
                "origin": "https://patelrepweb-production.up.railway.app",
                "localStorage": [{
                    "name": "auth-store",
                    "value": json.dumps({"state": {"session": {"access_token": token}}}),
                }],
            }],
        }),
        encoding="utf-8",
    )

    assert load_test._token_from_auth_state(state_path) == token
    assert load_test._decode_jwt_claims(token)["hotel_id"] == "hotel-a"


def test_session_from_playwright_local_storage_state(tmp_path):
    token = _fake_jwt({"sub": "user-1", "hotel_id": "hotel-a"})
    state_path = tmp_path / "state.json"
    state_path.write_text(
        json.dumps({
            "cookies": [],
            "origins": [{
                "origin": "https://patelrepweb-production.up.railway.app",
                "localStorage": [{
                    "name": "auth-store",
                    "value": json.dumps({
                        "state": {
                            "session": {
                                "access_token": token,
                                "refresh_token": "refresh-token",
                            }
                        }
                    }),
                }],
            }],
        }),
        encoding="utf-8",
    )

    assert load_test._session_from_auth_state(state_path) == {
        "access_token": token,
        "refresh_token": "refresh-token",
    }


def test_persist_refreshed_auth_state_updates_local_storage_session(tmp_path):
    old_token = _fake_jwt({"sub": "user-1", "hotel_id": "hotel-a"})
    new_token = _fake_jwt({"sub": "user-1", "hotel_id": "hotel-a", "fresh": True})
    state_path = tmp_path / "state.json"
    state_path.write_text(
        json.dumps({
            "cookies": [],
            "origins": [{
                "origin": "https://patelrepweb-production.up.railway.app",
                "localStorage": [{
                    "name": "auth-store",
                    "value": json.dumps({
                        "state": {
                            "session": {
                                "access_token": old_token,
                                "refresh_token": "old-refresh",
                            }
                        }
                    }),
                }],
            }],
        }),
        encoding="utf-8",
    )

    load_test._persist_refreshed_auth_state(
        state_path,
        {"access_token": new_token, "refresh_token": "new-refresh"},
    )

    assert load_test._session_from_auth_state(state_path) == {
        "access_token": new_token,
        "refresh_token": "new-refresh",
    }


def test_token_from_supabase_cookie_state(tmp_path):
    token = _fake_jwt({"sub": "user-2", "user_metadata": {"hotel_id": "hotel-b"}})
    state_path = tmp_path / "state.json"
    state_path.write_text(
        json.dumps({
            "cookies": [{
                "name": "sb-test-auth-token",
                "value": json.dumps({"access_token": token}),
            }],
            "origins": [],
        }),
        encoding="utf-8",
    )

    assert load_test._token_from_auth_state(state_path) == token
    assert load_test._decode_jwt_claims(token)["user_metadata"]["hotel_id"] == "hotel-b"
