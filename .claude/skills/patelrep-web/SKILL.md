---
name: patelrep-web
description: Next.js 14 App Router patterns and conventions for PatelRep apps/web/
metadata:
  filePattern: "apps/web/**"
  priority: 10
---

# PatelRep Web Layer

You are working on the **Next.js 14 App Router** web dashboard at `apps/web/`.

## Structure

```
apps/web/
├── app/
│   ├── (auth)/           login, reset-password, auth/callback
│   └── (dashboard)/      Protected pages (middleware enforces auth)
│       ├── onboarding/   6-step wizard (Hotel→Rooms→Staff→Opera→SOPs→Done)
│       ├── housekeeping/ Room board, assignments, inspections, rooms
│       ├── engineering/  Work orders, assets, PM schedules
│       ├── scheduling/   Weekly calendar, shifts
│       ├── staff/        Staff list, invitations
│       ├── sop/          SOP library, RAG query modal
│       ├── reports/      Analytics, maintenance PDF
│       ├── billing/      Subscription, usage
│       └── settings/     Hotel profile, integrations (Opera)
├── components/
│   ├── shared/           Header, Sidebar, Providers
│   ├── housekeeping/     RoomCard, RoomStatusBoard, AssignmentSidebar, etc.
│   ├── engineering/      WorkOrderCard, AssetDetail, etc.
│   └── ai/               SOPQueryModal, PredictionPanel
├── lib/
│   ├── api/              Typed API clients (housekeepingApi, staffApi, etc.)
│   ├── hooks/            useAuth.ts, useRole.ts
│   └── utils/            roomStatus.ts, formatting helpers
├── stores/               Zustand: authStore, hotelStore, housekeepingStore, engineeringStore
└── i18n/locales/         en.json, es.json
```

## Auth & Routing

`middleware.ts` handles all auth gates:
- Unauthenticated → `/login`
- No `hotel_id` in JWT → `/onboarding`
- Protected routes: all under `/(dashboard)/`

## Auth State Pattern

```typescript
import { useAuthStore } from '@/stores/authStore'
import { useAuth } from '@/lib/hooks/useAuth'
import { useRole } from '@/lib/hooks/useRole'

// In a component:
const { user, session } = useAuth()
const { isGM, isSupervisor, canAssignRooms, canViewBilling, canManageStaff } = useRole()
```

## API Client Pattern

All API calls use typed clients in `lib/api/`. Each client is an object of async methods.

```typescript
import { housekeepingApi } from '@/lib/api/housekeeping'
import { useQuery, useMutation } from '@tanstack/react-query'

// Fetch:
const { data, isLoading } = useQuery({
  queryKey: ['rooms', hotelId],
  queryFn: () => housekeepingApi.getRooms(hotelId),
})

// Mutate:
const { mutate } = useMutation({
  mutationFn: (payload) => housekeepingApi.updateRoomStatus(roomId, payload),
  onSuccess: () => queryClient.invalidateQueries(['rooms']),
})
```

## Adding a New API Client

Create `lib/api/myFeature.ts`:
```typescript
import { apiClient } from '@/lib/api/client'

export interface MyType { id: string; ... }

export const myFeatureApi = {
  list: async (hotelId: string): Promise<MyType[]> => {
    const res = await apiClient.get<{ data: MyType[] }>(`/my-feature?hotel_id=${hotelId}`)
    return res.data
  },
  create: async (payload: CreateMyTypePayload): Promise<MyType> => {
    const res = await apiClient.post<{ data: MyType }>('/my-feature', payload)
    return res.data
  },
}
```

## Zustand Store Pattern

```typescript
import { create } from 'zustand'

interface MyStore {
  items: Item[]
  isLoading: boolean
  setItems: (items: Item[]) => void
  filteredItems: () => Item[]
}

export const useMyStore = create<MyStore>((set, get) => ({
  items: [],
  isLoading: false,
  setItems: (items) => set({ items }),
  filteredItems: () => {
    const { items } = get()
    return items.filter(...)
  },
}))
```

## Realtime Pattern

```typescript
import { createClient } from '@/lib/supabase/client'

useEffect(() => {
  const supabase = createClient()
  const channel = supabase
    .channel('room_status')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'room_status',
      filter: `hotel_id=eq.${hotelId}`,
    }, (payload) => {
      // Update local state — debounce with 500ms to batch rapid updates
    })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [hotelId])
```

## Role-Gated UI

```tsx
const { isGM, isSupervisor } = useRole()

// Conditionally show:
{(isGM || isSupervisor) && <Button>Invite Staff</Button>}
```

## Styling Conventions

- Tailwind CSS, dark mode via className="dark" on `<html>`
- shadcn/ui components (Button, Card, Dialog, Sheet, Table, Badge, etc.)
- Status colors defined in `lib/utils/roomStatus.ts` — use `STATUS_COLORS[status]`
- Skeleton loading states on every data-dependent component
- Always handle empty state (no data) and error state

## Key Patterns in This Codebase

- **Optimistic UI**: Update local store immediately, then fire API call
- **Drawer pattern**: `RoomDetailDrawer` and `AssignmentSidebar` use Sheet component, 400px width
- **Modal pattern**: `InspectionModal`, `SOPQueryModal` use Dialog component
- **Board pattern**: Status chips + grouped room cards (see `RoomStatusBoard.tsx`)
