/* Who the shared offline queues belong to: `${tenant_id}:${user_id}` of the signed-in person, or null.
   Kept separate from appStore and the SQLite module so both can read it without an import cycle.
   Queued writes are stamped with this at enqueue time and only ever replayed while it is unchanged. */

let ownerScope: string | null = null;

export function setQueueOwner(scope: string | null): void {
  ownerScope = scope;
}

export function getQueueOwner(): string | null {
  return ownerScope;
}
