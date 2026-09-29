"""Authorization guards used by Tasks list bulk mutations."""

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import TransitionGuestRequestRequest, UpdateTaskRequest
from routers import guest_requests as guest_requests_router
from routers import tasks as tasks_router


@pytest.mark.asyncio
async def test_front_desk_cannot_change_task_priority_with_the_bulk_path():
    with pytest.raises(HTTPException) as error:
        await tasks_router.update_task(
            "task-1",
            UpdateTaskRequest(priority="urgent"),
            CurrentUser(user_id="front-desk", hotel_id="hotel-1", role="front_desk", email="fd@example.com"),
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_front_desk_cannot_cancel_guest_request_with_the_bulk_path():
    with pytest.raises(HTTPException) as error:
        await guest_requests_router.transition_guest_request(
            "request-1",
            TransitionGuestRequestRequest(status="cancelled"),
            CurrentUser(user_id="front-desk", hotel_id="hotel-1", role="front_desk", email="fd@example.com"),
        )
    assert error.value.status_code == 403
