from types import SimpleNamespace

from core.schema_readiness import check_schema_readiness


class ReadyDatabase:
    def rpc(self, name, params):
        assert name == "app_schema_readiness"
        assert params == {}
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"ok": True, "missing": []}))


class IncompatibleDatabase:
    def rpc(self, name, params):
        return SimpleNamespace(
            execute=lambda: SimpleNamespace(
                data={"ok": False, "missing": ["assets.last_failure_at"]}
            )
        )


class UnreachableDatabase:
    def rpc(self, name, params):
        raise RuntimeError("RPC unavailable")


def test_schema_readiness_accepts_the_expected_contract():
    result = check_schema_readiness(ReadyDatabase())
    assert result.ready is True
    assert result.missing == []


def test_schema_readiness_reports_the_missing_contract():
    result = check_schema_readiness(IncompatibleDatabase())
    assert result.ready is False
    assert result.missing == ["assets.last_failure_at"]


def test_schema_readiness_does_not_hide_database_errors():
    result = check_schema_readiness(UnreachableDatabase())
    assert result.ready is False
    assert result.missing == ["schema readiness RPC unavailable"]
