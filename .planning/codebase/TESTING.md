# Testing Patterns

**Analysis Date:** 2026-03-12

## Test Framework

**Runner:**
- pytest 8.2.2 (Python API testing)
- No test framework visible for web/mobile apps

**Assertion Library:**
- Python: assert statements with comparison operators (built-in)

**Run Commands:**
```bash
pytest apps/api/tests/               # Run all API tests
pytest apps/api/tests/smoke/         # Run smoke tests only
pytest -v                            # Verbose output
```

**Configuration:**
- pytest.ini or pyproject.toml not visibly present
- conftest.py handles environment setup at `apps/api/tests/smoke/conftest.py`

## Test File Organization

**Location:**
- Co-located pattern: `apps/api/tests/smoke/` directory parallel to `apps/api/`
- Web app: no test files found

**Naming:**
- Pattern: `test_*.py` (pytest discovery convention)
- Current files: `test_health.py`, `test_endpoints.py`

**Structure:**
```
apps/
├── api/
│   ├── main.py
│   ├── routers/
│   ├── services/
│   ├── middleware/
│   └── tests/
│       └── smoke/
│           ├── conftest.py
│           ├── test_health.py
│           └── test_endpoints.py
```

## Test Structure

**Suite Organization:**

Tests use pytest class-based grouping for related assertions:

```python
class TestAuthProtection:
    """Verify all endpoints require authentication."""

    @pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
    def test_protected_endpoint_no_auth(self, endpoint):
        """Protected endpoints should return 401 or 403 without auth."""
        response = client.get(endpoint)
        assert response.status_code in (401, 403)
```

**Patterns:**
- Class methods have docstrings explaining what they verify
- Parametrized tests with `@pytest.mark.parametrize()` for testing multiple endpoints
- Test functions use descriptive names: `test_<action>_<condition>`
- Assertions include error messages for debugging:
  ```python
  assert response.status_code in (401, 403), (
      f"{endpoint} returned {response.status_code}, expected 401 or 403"
  )
  ```

**Setup/Teardown:**
- conftest.py sets environment variables before app import
- No explicit fixtures beyond environment setup
- TestClient instantiated at module level (module-scoped fixture implicit)

## Setup and Configuration

**Environment Setup (conftest.py):**

```python
import pytest
import os

# Set test environment variables before importing app
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-minimum-32-characters-long!!")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_placeholder")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_test_placeholder")
os.environ.setdefault("CRON_SECRET", "test-cron-secret")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("APP_URL", "http://localhost:3000")
os.environ.setdefault("API_URL", "http://localhost:8000")
```

**Key Pattern:** Environment variables set BEFORE app imports to prevent initialization with production values.

## Test Client

**FastAPI TestClient:**

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

- TestClient provides sync interface to async app
- Requests made with `.get()`, `.post()`, etc.
- Response includes `.status_code`, `.json()`, `.headers`, `.content`

## Test Types

**Smoke Tests:**
- Location: `apps/api/tests/smoke/`
- Purpose: Verify endpoints respond (not 500) and auth gates work
- Not unit tests; integration-level checks

**Coverage by Category:**

**Authentication Protection:**
- TestAuthProtection class
- Parametrized tests check all endpoints in `PROTECTED_GET_ENDPOINTS` list
- Tests: no auth header (401/403), invalid token (401/403)

```python
@pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
def test_protected_endpoint_no_auth(self, endpoint):
    response = client.get(endpoint)
    assert response.status_code in (401, 403)
```

**Health/System Checks:**
- TestHealthEndpoints class
- Verifies `/health` returns 200 with correct fields (status, env)
- Checks response content-type is application/json

**Router Registration:**
- TestAPIRoutersRegistered class
- Confirms routers are mounted by checking they return 401/403 (not 404)
- Tests: billing, lost-found, logbook, reports endpoints

**POST Endpoint Security:**
- TestPostEndpointsNeedAuth class
- Verifies POST endpoints also require auth
- Tests: tasks, logbook, guest-requests, lost-found, internal cron

**Response Format:**
- TestResponseFormat class
- Checks response bodies have expected shape (data, error, status)
- Verifies auth failures return non-empty responses

## Mocking

**Current Approach:**
- No mocking framework detected (unittest.mock not imported)
- Tests use real TestClient against app with test environment vars
- Supabase/OpenAI/Stripe not mocked; test values used (see conftest)

**What IS Tested:**
- HTTP layer (status codes, content types)
- Auth gates (JWT validation, role checks)
- Endpoint registration

**What IS NOT Tested:**
- Business logic (room status transitions, assignments, AI calls)
- Database operations (no fixtures for test data)
- Service layer functions (AI predictions, RAG, Opera sync)

**Recommendation if Mocking Needed:**
- Use `unittest.mock` or `pytest-mock` for patching supabase client
- Fixture pattern:
  ```python
  @pytest.fixture
  def mock_supabase(monkeypatch):
      mock_client = MagicMock()
      monkeypatch.setattr("core.database.supabase", mock_client)
      return mock_client
  ```

## Fixtures and Test Data

**No Fixtures Defined:**
- conftest.py only sets environment variables
- No test data fixtures or factories observed
- No database fixtures (no test database setup)

**Test Data Strategy (if needed):**
- Create fixtures in conftest.py returning mock data
- Pattern observed in codebase for data shapes (Pydantic models, dicts)
- Example structure:
  ```python
  @pytest.fixture
  def sample_hotel():
      return {
          "id": "test-hotel-123",
          "name": "Test Hotel",
          "room_count": 50,
          "tenant_id": "test-tenant-123"
      }
  ```

## Coverage

**Requirements:** None enforced

**Tracked:** Smoke test file lists 19 protected endpoints; all checked

**Gaps:**
- No unit tests for routers, services, models
- No integration tests with real Supabase
- No tests for AI services (SOP RAG, predictions)
- No tests for Opera integration sync
- No tests for Stripe webhook handling
- Web app has no test files

## Test Execution Context

**Test Isolation:**
- Each test method is independent
- Shared TestClient means state could persist between tests (not observed in code)
- No cleanup logic visible

**Async Testing:**
- All route handlers are async; TestClient handles sync/async conversion
- No explicit `@pytest.mark.asyncio` decorators needed (handled by TestClient)

## Common Test Patterns

**Parametrized Testing:**

```python
PROTECTED_GET_ENDPOINTS = [
    "/v1/rooms",
    "/v1/housekeeping/board",
    "/v1/tasks",
    # ... 16 more endpoints
]

@pytest.mark.parametrize("endpoint", PROTECTED_GET_ENDPOINTS)
def test_protected_endpoint_no_auth(self, endpoint):
    response = client.get(endpoint)
    assert response.status_code in (401, 403)
```

**Assertion Pattern with Context:**

```python
assert response.status_code in (401, 403), (
    f"{endpoint} returned {response.status_code}, expected 401 or 403"
)
```

## Testing Best Practices Observed

1. **Descriptive test names:** `test_protected_endpoint_without_auth` (what it does)
2. **Docstrings:** Each class/test method has a docstring explaining intent
3. **Environment isolation:** conftest.py sets all vars before imports
4. **Parametrization:** Avoid code duplication for multiple endpoints
5. **Grouped assertions:** Related tests grouped in classes

## Testing Best Practices NOT Yet Applied

1. **Mocking:** External services (Supabase, OpenAI, Stripe) not mocked
2. **Fixtures:** No reusable test data factories
3. **Database testing:** No test database setup or seeding
4. **Service layer tests:** No unit tests for business logic
5. **Web app tests:** No tests for React components or hooks
6. **Integration tests:** No end-to-end workflow tests (e.g., hotel signup → room import → assignment)

## Where to Add Tests

**High Priority (Blockers for Business Logic):**
- `apps/api/services/ai/predictions.py` — room readiness predictions affect operations
- `apps/api/services/opera/sync.py` — critical for hotel data flow
- `apps/api/routers/housekeeping.py` — status transitions must be correct
- `apps/api/routers/rooms.py` — room import/update logic

**Medium Priority (Feature Completeness):**
- `apps/api/routers/scheduling.py` — shift/assignment business rules
- `apps/api/routers/billing.py` — credit metering, subscription logic
- `apps/api/services/ai/sop_rag.py` — RAG query and chunking logic

**Lower Priority (Infrastructure):**
- Web components (tested manually/QA)
- Mobile app (tested via EAS)
- Webhook handlers (smoke tests check registration)

---

*Testing analysis: 2026-03-12*
