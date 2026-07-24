"""Fake Twilio REST client for credential-free unit tests (D-01)."""

from __future__ import annotations


class FakeTwilioRestException(Exception):
    """Mirrors twilio.base.exceptions.TwilioRestException's `code` attribute."""

    def __init__(self, code: int, msg: str = "", status: int = 400) -> None:
        super().__init__(msg or f"Twilio error {code}")
        self.code = code
        self.status = status
        self.msg = msg


class _FakeMessageInstance:
    def __init__(self, sid: str, status: str) -> None:
        self.sid = sid
        self.status = status


class _FakeMessageList:
    def __init__(self, owner: "FakeTwilioClient") -> None:
        self._owner = owner

    def create(self, *, to: str, from_: str, body: str, status_callback: str | None = None):
        self._owner.sent.append(
            {"to": to, "from_": from_, "body": body, "status_callback": status_callback}
        )
        if self._owner.raise_code is not None:
            raise FakeTwilioRestException(self._owner.raise_code, "forced by test")
        return _FakeMessageInstance(self._owner.next_sid, self._owner.next_status)


class FakeTwilioClient:
    """Records every send. Set `raise_code=21610` to simulate an opted-out recipient."""

    def __init__(self, *, next_sid: str = "SM_fake_0001", next_status: str = "queued",
                 raise_code: int | None = None) -> None:
        self.sent: list[dict] = []
        self.next_sid = next_sid
        self.next_status = next_status
        self.raise_code = raise_code
        self.messages = _FakeMessageList(self)
