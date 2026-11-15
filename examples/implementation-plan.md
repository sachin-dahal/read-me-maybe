# Implementation Plan: Offline Mode for Notes

Make the notes app usable on a plane. Edits are saved locally first and synced once the connection comes back.

> [!IMPORTANT]
> Conflicts are the risky part. If the same note changes on two devices while offline, we keep both versions and let the user pick.

## Proposed changes

| File | Change |
| --- | --- |
| `src/sync/queue.ts` | **New.** Persists pending edits in IndexedDB |
| `src/sync/worker.ts` | Retries the queue with exponential backoff |
| `src/notes/store.ts` | Reads from the local cache first |
| `src/ui/StatusPill.tsx` | Shows *Offline*, *Syncing…* or *Up to date* |

## How it fits together

```mermaid
flowchart LR
    A[Edit a note] --> B[(Local cache)]
    B --> C{Online?}
    C -- Yes --> D[Sync worker]
    C -- No --> E[Pending queue]
    E -- connection back --> D
    D --> F[(Server)]
```

## Tasks

- [x] Add the IndexedDB queue
- [x] Read notes from the local cache
- [ ] Retry failed syncs with backoff
- [ ] Conflict picker UI

## Sync worker sketch

```ts
export async function flush(queue: Queue): Promise<void> {
  for (const edit of await queue.pending()) {
    await retry(() => api.save(edit), { attempts: 5, backoff: 'exponential' });
    await queue.done(edit.id);
  }
}
```

## Verification

1. Turn on airplane mode, edit three notes, and reload. The edits are still there.
2. Reconnect. The status pill goes from *Syncing…* to *Up to date* within five seconds.
3. Edit the same note on two devices while offline, reconnect, and check that the conflict picker appears.
