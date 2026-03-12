# Coding Conventions

**Analysis Date:** 2026-03-12

## Naming Patterns

**Files:**
- Python routers: snake_case (e.g., `housekeeping.py`, `tasks.py`)
- Python services: snake_case in services/ subdirectories (e.g., `sop_rag.py`, `failure_predictions.py`)
- TypeScript/React components: PascalCase (e.g., `RoomCard.tsx`, `InspectionModal.tsx`)
- TypeScript files: camelCase for utilities/hooks (e.g., `useAuth.ts`, `client.ts`)
- API response wrappers: Uniform `{ data: ... }` shape (see below)

**Functions:**
- Python: snake_case with leading underscore for private helpers (e.g., `_chunk_text()`, `_sort_key()`)
- TypeScript/React: camelCase for regular functions, PascalCase for React components
- Helper functions in components: camelCase (e.g., `formatTime()`, `getCardClasses()`)
- Zustand stores: camelCase for actions (e.g., `setRooms()`, `setPendingAssignment()`)

**Variables:**
- Python: snake_case universally (e.g., `current_user`, `hotel_id`, `assigned_to`)
- TypeScript: camelCase (e.g., `assignmentMode`, `showRiskOnly`, `pendingAssignments`)
- Constants: UPPER_SNAKE_CASE in Python (e.g., `ALL_STAFF_ROLES`, `CHUNK_SIZE`, `SLA_MINUTES`)
- Constants: UPPER_SNAKE_CASE in TypeScript (e.g., `PUBLIC_ROUTES`, `PROTECTED_GET_ENDPOINTS`)

**Types:**
- TypeScript interfaces: PascalCase, prefixed with export (e.g., `AuthStore`, `RoomPrediction`)
- Python dataclasses: PascalCase (e.g., `CurrentUser`)
- Pydantic models: PascalCase (e.g., `CreateHotelRequest`, `UpdateTaskRequest`)
- Union types (status/priority): UPPER_SNAKE_CASE or string literals in Literal[] (e.g., `Literal["DIRTY", "IN_PROGRESS", "CLEAN"]`)

## Code Style

**Formatting:**
- No explicit formatter configured in web app
- Python follows PEP 8 implicitly (4-space indents observed)
- TypeScript/React follows Next.js ESLint defaults
- Indentation: 2 spaces in TypeScript/React, 4 spaces in Python

**Linting:**
- Web app has ESLint (eslint-config-next) defined but no `.eslintrc` file present
- API has no linting configuration visible
- Code organization prioritizes readability over strict auto-formatting
- eslint-disable-next-line comments used for legitimate exceptions (e.g., `react-hooks/exhaustive-deps`)

**Imports Organization:**
- Python: stdlib → third-party → local (grouped with blank lines)
  - Example: `import io, re, time, json` → `import pdfplumber, anthropic` → `from core.config import settings`
- TypeScript: React/types → external libs → internal imports with aliases
  - Example: `import { useState }` → `import { useQuery } from '@tanstack/react-query'` → `import { apiClient } from '@/lib/api/client'`
- Path aliases in use: `@/*` maps to app root in TypeScript (configured in tsconfig.json)

## Error Handling

**Python API Pattern:**
- HTTPException with status_code + detail for client errors
- Exception raised in handlers caught by FastAPI (not wrapped in try-catch typically)
- Health check endpoint catches exceptions and logs (see main.py lines 74–80)
- Service functions in `services/` return data or raise exceptions; middleware handles JWT errors
- Example from auth.py:
  ```python
  except JWTError as e:
      raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
  ```

**TypeScript/React Pattern:**
- API client catches non-200 responses, extracts error message, throws Error
- Components catch with `.catch(() => ...)` or suppress with optional chaining
- No global error boundary observed in user code (Next.js provides default)
- Example from client.ts:
  ```typescript
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || 'Request failed')
  }
  ```

**Validation:**
- Pydantic field_validator in requests.py for custom validation (e.g., title_required_without_nl)
- Zod not visibly used in frontend; form validation via react-hook-form + Pydantic on backend
- No runtime assertion libraries; Python assertion statements not observed in production code

## Logging

**Framework:** Python uses stdlib `logging` module

**Patterns:**
- Initialize logger in each module: `logger = logging.getLogger(__name__)`
- Log levels used: `logger.warning()`, `logger.error()`
- Logging only in services (AI, predictions, failure_predictions); routers do not log
- Errors include context: `logger.error("Failed to fetch assets for hotel=%s: %s", hotel_id, exc)`
- No structured logging (JSON) observed
- TypeScript/React: no logging infrastructure; `console.log()` not found in provided code
- Non-blocking failures logged as warnings; failures logged as errors

**Example from failure_predictions.py:**
```python
logger.warning("Failed to fetch work orders for asset=%s: %s", asset_id, exc)
logger.error("Failure prediction run failed for hotel=%s: %s", hotel_id, exc)
```

## Comments

**When to Comment:**
- Comments used sparingly; code structure is mostly self-documenting
- Section comments with hyphens separate logical blocks:
  ```python
  # ---------------------------------------------------------------------------
  # GET /housekeeping/board
  # ---------------------------------------------------------------------------
  ```
- Inline comments explain non-obvious logic (e.g., "Sort by floor then room_number in Python")
- Comments explain rationale for workarounds (e.g., "supabase-py does not support ordering by joined table columns directly")

**JSDoc/TSDoc:**
- Not used in provided code
- Interface/type definitions are self-descriptive (property names + TS types)
- Function parameter types fully typed; no JSDoc @param tags observed

## Import Organization

**Python Examples:**
- stdlib imports at top (re, datetime, logging, etc.)
- Third-party (fastapi, pydantic, anthropic, etc.)
- Local modules (middleware, models, core, services)

**TypeScript Examples from housekeeping.ts:**
```typescript
import { apiClient } from '@/lib/api/client'  // Local API wrapper
export interface RoomPrediction { ... }        // Types exported before functions
export const housekeepingApi = { ... }         // API methods grouped in object
```

## Function Design

**Size:** Functions are concise; large files (500+ lines) split logically
- `RoomDetailDrawer.tsx` (~500 lines) but each section (helper functions, component, sub-components) is isolated
- `housekeeping.py` routes (~300+ lines) but each route is a separate async function

**Parameters:**
- Python: request bodies as Pydantic models, dependencies injected (current_user, role checks)
- TypeScript: component props use `interface Props { ... }`, callbacks are typed
- Optional params use `Optional[Type] = None` in Python, `?: Type` in TypeScript

**Return Values:**
- Python: `{ "data": ... }` for success, HTTPException for errors
- TypeScript: raw object from api.get/post (caller handles shape via types)
- Functions rarely return null explicitly; None/null used only when semantically appropriate

## Module Design

**Exports:**
- Python routers: `router = APIRouter(...)` exported (imported in main.py)
- Python services: functions exported directly (e.g., `run_asset_failure_predictions()`)
- TypeScript: named exports for types/interfaces, default or named exports for functions
  - Example: `export const useAuthStore = create<AuthStore>(...)`

**Barrel Files:**
- `services/ai/__init__.py` re-exports all public functions (4 functions listed)
- Web app does not use barrel files for components; direct imports used

**Zustand Stores:**
- Single store per domain (authStore, housekeepingStore, engineeringStore)
- State shape: all properties + action methods grouped together
- Derived functions (filteredRooms) use `get()` to access current state
- Example from housekeepingStore:
  ```typescript
  filteredRooms: () => {
    const { rooms, statusFilter, showRiskOnly, predictions } = get()
    // filter logic
  }
  ```

## Response Format Convention

**API Responses:**
- All endpoints return `{ "data": ... }` or `{ "error": ... }` shape
- List responses: `{ "data": [...], "meta": { "page": ..., "per_page": ... } }`
- Single resource: `{ "data": {...} }`
- Health check: `{ "status": "ok", "env": "...", "db_status": "ok" }`
- Error responses: FastAPI auto-generates `{ "detail": "..." }`

## Dependency Injection

**Python:**
- FastAPI dependencies via `Depends()` for auth, role checks
- get_current_user dependency extracts JWT, returns CurrentUser dataclass
- require_role(*roles) dependency returns function that checks roles

**TypeScript:**
- Zustand hooks for global state (useAuthStore, useHousekeepingStore)
- Custom hooks for derived state (useAuth, useRole)
- React Query for async data (useQuery with api methods)
- No DI container; props passed directly

## Code Organization Patterns

**API Routers:**
- One file per domain (hotels.py, rooms.py, housekeeping.py)
- Router prefixes standardized: `/prefix`, tags for OpenAPI grouping
- Helper functions prefixed with underscore
- Queries chained fluently: `.select(...).eq(...).execute()`

**React Components:**
- Functional components only
- Props interface defined above component
- Type definitions for custom types (RoomStatus, RiskLevel)
- Constants (STATUS_LABELS, COLORS) defined at module level as objects/maps
- Sub-components (e.g., TransitionButton) defined as local functions in same file

**Stores (Zustand):**
- State shape defined as interface
- Actions grouped in the store creator
- Derived selectors use `get()` callback pattern
- No reducers; direct state updates via `set()`

## Async Patterns

**Python:**
- All route handlers are `async def`
- Supabase calls are synchronous (no await needed)
- Background tasks passed to internal cron endpoints (not scheduled in-app)

**TypeScript:**
- useQuery from React Query handles async data fetching
- useEffect for initialization; async IIFE inside effect
- Callbacks are async when making API calls
- Promise-based API with error propagation

---

*Convention analysis: 2026-03-12*
