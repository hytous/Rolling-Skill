# Chat Stream Rendering Design

## Goal

Eliminate chat jank caused by high-frequency runtime deltas and preserve the original interleaving of assistant output with reasoning and tool activity when a conversation is reloaded.

## Root causes

- Every runtime notification currently schedules `renderAll()`. Text and reasoning deltas therefore rebuild unrelated UI surfaces and detach/re-attach the complete conversation tree up to once per animation frame.
- Persisted activity records retain order only relative to other activity records. When runtime history omits those records, every missing activity is restored immediately before the final assistant message, losing its original assistant-message boundary.

## Design

Introduce a small stream render queue that deduplicates dirty `(turnId, itemId)` pairs and flushes them at a bounded cadence. Streaming text and reasoning notifications use this queue. A flush replaces only the changed item DOM nodes; if an item has not been rendered yet, it falls back to one normal conversation render. Terminal events continue to use an immediate full state render.

Persist an optional `afterAgentMessageId` anchor on each activity record. The anchor is captured when the activity first appears and is not changed when a long-running tool completes after later assistant output. During history merge, anchored missing activity is restored after that assistant message and before the next assistant message. Existing unanchored records keep the legacy fallback before the final assistant message.

## Compatibility and testing

- Existing activity-store files remain readable; the new anchor is optional.
- Stream rendering retains Markdown output and bottom-follow behavior.
- Unit tests cover queue coalescing and anchored history merge.
- Renderer smoke verifies repeated streaming deltas do not replace the surrounding turn block and the final text is complete.

