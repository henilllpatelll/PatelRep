import json

from core.config import read_packaged_release_identity


def test_reads_a_valid_packaged_release_identity(tmp_path):
    identity_path = tmp_path / "release_identity.json"
    identity_path.write_text(
        json.dumps({"release_sha": "a" * 40, "release_version": "staging"}),
        encoding="utf-8",
    )

    assert read_packaged_release_identity(identity_path) == {
        "release_sha": "a" * 40,
        "release_version": "staging",
    }


def test_ignores_malformed_packaged_release_identity(tmp_path):
    identity_path = tmp_path / "release_identity.json"
    identity_path.write_text('{"release_sha":"not-a-sha","release_version":"bad value"}', encoding="utf-8")

    assert read_packaged_release_identity(identity_path) == {}
