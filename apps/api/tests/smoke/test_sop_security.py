import pytest
from fastapi import BackgroundTasks, HTTPException

from middleware.auth import CurrentUser
from routers import sop as sop_router


USER = CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm", email="gm@example.com")


class FakeUploadFile:
    def __init__(self, filename: str, content: bytes, content_type: str = "application/pdf"):
        self.filename = filename
        self.content_type = content_type
        self._content = content
        self._offset = 0

    async def read(self, size: int = -1) -> bytes:
        if self._offset >= len(self._content):
            return b""
        if size is None or size < 0:
            size = len(self._content) - self._offset
        start = self._offset
        self._offset = min(len(self._content), self._offset + size)
        return self._content[start:self._offset]


@pytest.mark.asyncio
async def test_sop_upload_rejects_filename_path_separators():
    with pytest.raises(HTTPException) as exc:
        await sop_router.upload_sop_document(
            background_tasks=BackgroundTasks(),
            file=FakeUploadFile("../evil.pdf", b"%PDF-1.4"),
            title="Evil",
            current_user=USER,
        )

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_sop_upload_rejects_oversized_pdf_before_storage(monkeypatch):
    storage_calls = []

    class FakeSupabase:
        @property
        def storage(self):
            storage_calls.append("storage")
            return self

        def from_(self, *_args):
            return self

        def upload(self, *_args, **_kwargs):
            storage_calls.append("upload")

    monkeypatch.setattr(sop_router, "supabase", FakeSupabase())

    with pytest.raises(HTTPException) as exc:
        await sop_router.upload_sop_document(
            background_tasks=BackgroundTasks(),
            file=FakeUploadFile("large.pdf", b"x" * (sop_router.MAX_SOP_UPLOAD_BYTES + 1)),
            title="Large",
            current_user=USER,
        )

    assert exc.value.status_code == 413
    assert storage_calls == []
