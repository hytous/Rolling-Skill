# Background Thread Notification Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop invisible runtime threads from flooding Electron renderer IPC while preserving Trace, tool activity, final history, and seamless live output when a thread becomes visible.

**Architecture:** Add a small main-process notification router that classifies low-frequency thread summaries, visible timeline events, and renderer-unused events. A `thread/read` request opens a generation-scoped observation in buffering mode; after the renderer installs the snapshot, it drains catch-up batches until the router atomically switches to live forwarding. Hiding Chat clears the observation, and returning to Chat reloads the runtime snapshot before live streaming resumes.

**Tech Stack:** Electron IPC, CommonJS, vanilla browser JavaScript, Node.js `node:test`, existing renderer smoke harness.

---

## File map

- Create `desktop/rolling-skill/src/runtime-notification-router.cjs`: pure notification classification and generation-scoped snapshot/catch-up/live state.
- Create `desktop/rolling-skill/test/runtime-notification-router.test.cjs`: unit coverage for background filtering, summaries, buffering, stale generations, and overflow.
- Modify `desktop/rolling-skill/src/main.cjs`: route notifications after Trace/activity capture; bind read/drain/clear observation IPC; clear state on runtime lifecycle changes.
- Modify `desktop/rolling-skill/src/preload.cjs`: expose bounded drain/clear APIs.
- Modify `desktop/rolling-skill/renderer/renderer.js`: install snapshots, drain catch-up, suspend while Chat is hidden, and refresh when Chat becomes visible again.
- Modify `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`: simulate observation generations and background output retained by runtime history.
- Modify `desktop/rolling-skill/scripts/renderer-smoke.cjs`: prove background bursts do not mutate the visible timeline and their final output appears after selection.
- Modify `desktop/rolling-skill/test/main-bridge.test.cjs`: assert the controlled IPC surface and routing order.

The repository is intentionally being edited in the existing `main` checkout because required DSH/streaming changes are currently uncommitted there and the user has requested a main-only repository. Do not reset, checkout, or broadly stage the dirty files. The design-only commit already exists; implementation commits are deferred where they would capture unrelated existing hunks.

### Task 1: Pure notification router

**Files:**
- Create: `desktop/rolling-skill/test/runtime-notification-router.test.cjs`
- Create: `desktop/rolling-skill/src/runtime-notification-router.cjs`

- [ ] **Step 1: Write failing classification and observation tests**

Create tests using the desired API:

```js
const assert = require("node:assert/strict")
const {describe, it} = require("node:test")
const {RuntimeNotificationRouter} = require("../src/runtime-notification-router.cjs")

function notification(method, threadId = "thread-a", extra = {}) {
    return {method, params: {threadId, ...extra}}
}

describe("runtime notification router", () => {
    it("forwards only the visible timeline while retaining low-frequency background summaries", () => {
        const router = new RuntimeNotificationRouter()
        const epoch = router.beginObservation("thread-a")
        router.snapshotReady(epoch)
        assert.equal(router.drain(epoch).live, true)

        assert.equal(router.route(notification("item/agentMessage/delta", "thread-a")).forward, true)
        assert.equal(router.route(notification("item/agentMessage/delta", "thread-b")).forward, false)
        assert.equal(router.route(notification("thread/status/changed", "thread-b")).forward, true)
        assert.equal(router.route(notification("thread/tokenUsage/updated", "thread-a")).forward, false)
        assert.equal(router.route({method: "account/rateLimits/updated", params: {}}).forward, false)
    })

    it("discards pre-snapshot activity and drains post-snapshot catch-up before going live", () => {
        const router = new RuntimeNotificationRouter()
        const epoch = router.beginObservation("thread-a")
        router.route(notification("item/agentMessage/delta", "thread-a", {delta: "covered"}))
        router.snapshotReady(epoch)
        router.route(notification("item/agentMessage/delta", "thread-a", {delta: "catch-up"}))

        const catchUp = router.drain(epoch)
        assert.equal(catchUp.live, false)
        assert.deepEqual(catchUp.notifications.map((entry) => entry.params.delta), ["catch-up"])
        assert.deepEqual(router.drain(epoch), {matched: true, live: true, notifications: []})
        assert.equal(router.route(notification("item/agentMessage/delta", "thread-a")).forward, true)
    })

    it("rejects stale epochs and requests a new snapshot after a bounded buffer overflows", () => {
        const router = new RuntimeNotificationRouter({maxBufferedNotifications: 2})
        const oldEpoch = router.beginObservation("thread-a")
        router.snapshotReady(oldEpoch)
        const currentEpoch = router.beginObservation("thread-b")
        assert.deepEqual(router.drain(oldEpoch), {matched: false, live: false, notifications: []})
        router.snapshotReady(currentEpoch)
        for (let index = 0; index < 3; index += 1) {
            router.route(notification("item/agentMessage/delta", "thread-b", {delta: String(index)}))
        }
        assert.equal(router.drain(currentEpoch).reloadRequired, true)
    })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
cd desktop/rolling-skill
node --test test/runtime-notification-router.test.cjs
```

Expected: FAIL because `../src/runtime-notification-router.cjs` does not exist.

- [ ] **Step 3: Implement the minimal router**

Implement these exports and invariants:

```js
const SUMMARY_METHODS = new Set([
    "thread/started",
    "thread/archived",
    "thread/unarchived",
    "thread/name/updated",
    "thread/status/changed",
])
const TIMELINE_METHODS = new Set([
    "thread/settings/updated",
    "turn/started",
    "item/started",
    "item/agentMessage/delta",
    "item/completed",
    "turn/completed",
    "error",
])

function notificationThreadId(message) {
    return message?.params?.threadId ?? message?.params?.thread?.id ?? null
}

class RuntimeNotificationRouter {
    constructor({maxBufferedNotifications = 2_000} = {}) {
        this.maxBufferedNotifications = maxBufferedNotifications
        this.nextEpoch = 1
        this.observation = null
    }

    beginObservation(threadId) {
        const epoch = this.nextEpoch++
        this.observation = {
            epoch,
            threadId,
            phase: "snapshot",
            notifications: [],
            overflow: false,
        }
        return epoch
    }

    snapshotReady(epoch) {
        if (this.observation?.epoch !== epoch) return false
        this.observation.phase = "catch-up"
        this.observation.notifications = []
        this.observation.overflow = false
        return true
    }

    clear(epoch = null) {
        if (epoch !== null && this.observation?.epoch !== epoch) return false
        this.observation = null
        return true
    }

    route(message) {
        const method = message?.method
        const threadId = notificationThreadId(message)
        if (SUMMARY_METHODS.has(method)) return {forward: true, kind: "summary"}
        if (!TIMELINE_METHODS.has(method)) return {forward: false, kind: "unused"}
        const observed = this.observation
        if (!observed || threadId !== observed.threadId) {
            return {forward: false, kind: "background"}
        }
        if (observed.phase === "live") return {forward: true, kind: "timeline"}
        if (observed.phase === "catch-up") {
            if (observed.notifications.length >= this.maxBufferedNotifications) {
                observed.overflow = true
            } else {
                observed.notifications.push(message)
            }
        }
        return {forward: false, kind: "buffered"}
    }

    drain(epoch) {
        const observed = this.observation
        if (!observed || observed.epoch !== epoch) {
            return {matched: false, live: false, notifications: []}
        }
        if (observed.overflow) {
            this.observation = null
            return {matched: true, live: false, reloadRequired: true, notifications: []}
        }
        if (observed.notifications.length) {
            return {matched: true, live: false, notifications: observed.notifications.splice(0)}
        }
        observed.phase = "live"
        return {matched: true, live: true, notifications: []}
    }
}

module.exports = {RuntimeNotificationRouter, notificationThreadId}
```

- [ ] **Step 4: Run the router test and verify GREEN**

Run `node --test test/runtime-notification-router.test.cjs`.

Expected: 3 tests pass, 0 fail.

### Task 2: Main/preload routing and observation IPC

**Files:**
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`

- [ ] **Step 1: Add failing bridge assertions**

Assert that main imports `RuntimeNotificationRouter`, captures activity before calling `route`, sends only when `route(message).forward`, starts an observation before `runtime.readThread`, marks the snapshot ready after the read, and exposes `runtime:drain-observation` plus `runtime:clear-observation`. Assert preload exposes matching `drainThreadObservation(epoch)` and `clearThreadObservation(epoch)` calls.

- [ ] **Step 2: Run the bridge test and verify RED**

Run `node --test test/main-bridge.test.cjs`.

Expected: FAIL on the missing observation IPC/routing assertions.

- [ ] **Step 3: Wire the router after evidence capture**

Create one router near other main-process runtime state:

```js
const {RuntimeNotificationRouter} = require("./runtime-notification-router.cjs")
const runtimeNotificationRouter = new RuntimeNotificationRouter()
```

In `installClientEvents`, preserve manager handling, active-thread bookkeeping, profile persistence,
Trace recording inside each runtime client, and `activityStore.captureNotification` before routing:

```js
if (!hidden) {
    activityStore?.captureNotification(sourceRuntimeId, message)
    if (runtimeNotificationRouter.route(message).forward) {
        send("runtime:notification", message)
    }
}
```

Clear the router when runtime state becomes stopped/error and whenever the active runtime/workspace is replaced.

- [ ] **Step 4: Make thread reads observation-scoped**

In `runtime:read-thread`, begin observation immediately before `runtime.readThread(threadId)`. On
success, call `snapshotReady(epoch)` and return `rollingSkillObservationEpoch: epoch` beside the
existing thread response. On failure, `clear(epoch)` before rethrowing.

Add handlers:

```js
ipcMain.handle("runtime:drain-observation", (_event, input = {}) =>
    runtimeNotificationRouter.drain(Number(input.epoch)),
)
ipcMain.handle("runtime:clear-observation", (_event, input = {}) =>
    runtimeNotificationRouter.clear(input.epoch == null ? null : Number(input.epoch)),
)
```

After `runtime:start-thread` returns, call `beginObservation(response.thread.id)`,
`snapshotReady(epoch)`, and `drain(epoch)` so a newly created visible thread is live before
`runtime:start-turn` begins.

- [ ] **Step 5: Expose only the bounded preload methods**

Add:

```js
drainThreadObservation: (epoch) =>
    ipcRenderer.invoke("runtime:drain-observation", {epoch}),
clearThreadObservation: (epoch = null) =>
    ipcRenderer.invoke("runtime:clear-observation", {epoch}),
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test test/runtime-notification-router.test.cjs test/main-bridge.test.cjs
```

Expected: all focused tests pass.

### Task 3: Renderer snapshot/catch-up lifecycle

**Files:**
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`

- [ ] **Step 1: Extend the smoke preload with observation state**

Make fake `readThread` return an incrementing `rollingSkillObservationEpoch`. Add fake
`drainThreadObservation` that returns queued post-snapshot notifications once and then `{live:true}`.
Add fake `clearThreadObservation` and smoke inspection counters so tests can assert when Chat is
subscribed or suspended.

- [ ] **Step 2: Add a failing renderer smoke assertion for hidden Chat**

While thread A is visible, switch to thread B or the evaluation surface, emit 100 thread-A deltas,
and assert no thread-A delta is delivered through the simulated renderer notification channel.
Queue a completed thread-A snapshot in the fake runtime, select thread A, and assert the final output
appears after `readThread` plus catch-up.

- [ ] **Step 3: Run renderer smoke and verify RED**

Run `npm run smoke:renderer`.

Expected: FAIL because renderer never drains/clears an observation and the fake background routing
counter shows the invisible thread still subscribed.

- [ ] **Step 4: Install and drain observations after a snapshot**

Track `state.activeThreadObservationEpoch`. After `readThread` is installed and rendered, run:

```js
async function drainThreadObservation(epoch, threadId, loadToken, runtimeEpoch) {
    while (
        epoch === state.activeThreadObservationEpoch &&
        threadId === state.activeThreadId &&
        loadToken === state.threadLoadToken &&
        runtimeEpoch === state.runtimeEpoch
    ) {
        const batch = await window.rollingSkill.drainThreadObservation(epoch)
        if (!batch.matched || batch.reloadRequired) {
            if (batch.reloadRequired && state.activeThreadId === threadId) void loadThread(threadId)
            return
        }
        for (const message of batch.notifications ?? []) handleNotification(message)
        if (batch.live) return
    }
}
```

Set the epoch from `response.rollingSkillObservationEpoch` before rendering the loaded thread, then
await the drain helper. Stale thread/read tokens must clear only their own epoch.

- [ ] **Step 5: Suspend whenever Chat text is not visible**

Add an idempotent helper:

```js
function suspendThreadObservation() {
    const epoch = state.activeThreadObservationEpoch
    state.activeThreadObservationEpoch = null
    void window.rollingSkill.clearThreadObservation(epoch)
}
```

Call it before New Task, evaluation surface, settings, Trace, Case Draft, Rubric, runtime switch,
workspace switch, archive, and app bootstrap resets. When those views close and the Chat surface with
an active thread is visible again, call `loadThread(state.activeThreadId)` to obtain a fresh snapshot
and observation instead of reusing stale renderer state.

- [ ] **Step 6: Run renderer smoke and focused tests**

Run:

```bash
npm run smoke:renderer
node --test test/runtime-notification-router.test.cjs test/main-bridge.test.cjs test/local-first-surface.test.cjs
```

Expected: smoke reports background routing and catch-up true with `rendererErrors: 0`; focused tests pass.

### Task 4: Full regression and packaged App

**Files:**
- Verify all modified files.
- Build: `Rolling Skill.app` at the repository root.

- [ ] **Step 1: Run full tests**

Run `npm test` from `desktop/rolling-skill`.

Expected: all tests pass with 0 failures.

- [ ] **Step 2: Run renderer smoke and diff validation**

Run `npm run smoke:renderer` and `git diff --check`.

Expected: smoke JSON includes bounded streaming, background notification routing, catch-up recovery,
and `rendererErrors: 0`; diff check exits 0.

- [ ] **Step 3: Build and sign**

Run from repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

Expected: tests pass, packaging succeeds, runtime CLIs are not embedded, and the root
`Rolling Skill.app` is signed with `Rolling Skill Local Development`.

- [ ] **Step 4: Verify signature and packaged files**

Run `codesign --verify --deep --strict --verbose=2 "Rolling Skill.app"` and inspect `app.asar` for
`runtime-notification-router.cjs`.

Expected: signature valid and the router is packaged.

- [ ] **Step 5: Restart only Rolling Skill**

Resolve the exact `Rolling Skill.app/Contents/MacOS/Rolling Skill` PID, terminate that PID, run
`open -n "Rolling Skill.app"`, and verify the new exact process path is running.

### Task 5: Project record and handoff

**Files:**
- Modify outside the product repo: `/Users/wangbaoheng/agent-project-record/agenta/desktop/rolling-skill/onboarding.md`
- Append outside the product repo: `/Users/wangbaoheng/agent-project-record/agenta/desktop/rolling-skill/agent-requirement-log.md`

- [ ] **Step 1: Record the durable architecture rule**

Add one concise onboarding bullet: runtime clients and main-process evidence capture receive every
event, but only the actually visible Chat thread may forward high-frequency timeline notifications to
renderer; returning to a thread must establish snapshot/catch-up/live handoff.

- [ ] **Step 2: Append the requirement final block without reading the log**

Use `project_record.py append-log` with requirement id
`20260819-background-thread-routing`, initial commit `844264ca7c`, final commit `not committed` unless
an implementation-only commit was safely possible, and include fresh verification counts.

- [ ] **Step 3: Validate record size and report**

Run `wc -l` on onboarding (must be below 500), leave existing unrelated dirty record changes intact,
and report the local record path if it cannot be safely pushed separately.
