"""HTTP errors that carry a stable machine-readable code next to the human message."""

from fastapi import HTTPException


class CodedHTTPException(HTTPException):
    """An HTTPException whose ``detail`` stays a plain string.

    Existing clients (the web drawers render ``detail`` directly) keep working unchanged, while newer
    clients branch on ``code`` and read any ``extra`` fields. The response body is
    ``{"detail": <message>, "code": <code>, **extra}`` - see the handler registered in ``main.py``.
    Code that calls the endpoint function directly still sees an ordinary ``HTTPException``.
    """

    def __init__(self, status_code: int, message: str, code: str, **extra) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.extra = extra

    def body(self) -> dict:
        return {"detail": self.detail, "code": self.code, **self.extra}
