const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const vm = require("node:vm")

const {
    NEW_TASK_CONVERSATION_ID,
    createThreadViewStateStore,
} = require("../renderer/thread-view-state.js")

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial))
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null
        },
        setItem(key, value) {
            values.set(key, String(value))
        },
        removeItem(key) {
            values.delete(key)
        },
        value(key) {
            return values.get(key)
        },
    }
}

function identity(conversationId, overrides = {}) {
    return {
        runtimeId: "codex:alpha",
        workspaceRoot: "/workspace/one",
        conversationId,
        ...overrides,
    }
}

function testStore(options = {}) {
    return createThreadViewStateStore({
        storage: memoryStorage(),
        now: () => "2026-08-11T00:00:00.000Z",
        ...options,
    })
}

describe("thread view state", () => {
    it("publishes the same factory as a browser global", () => {
        const source = readFileSync(join(__dirname, "../renderer/thread-view-state.js"), "utf8")
        const context = {console}
        vm.createContext(context)
        vm.runInContext(source, context)

        assert.equal(
            typeof context.RollingSkillThreadViewState.createThreadViewStateStore,
            "function",
        )
        assert.equal(
            context.RollingSkillThreadViewState.NEW_TASK_CONVERSATION_ID,
            "__new_task__",
        )
    })

    it("isolates drafts and scroll positions by runtime, workspace, and conversation", () => {
        const store = testStore()

        store.set(identity("thread-1"), {draft: "one", scrollTop: 321, atBottom: false})
        store.set(identity("thread-2"), {draft: "two", scrollTop: 12, atBottom: true})
        store.set(identity("thread-1", {workspaceRoot: "/workspace/two"}), {draft: "workspace"})
        store.set(identity("thread-1", {runtimeId: "codebuddy:beta"}), {draft: "runtime"})

        assert.deepEqual(store.get(identity("thread-1")), {
            draft: "one",
            scrollTop: 321,
            atBottom: false,
            updatedAt: "2026-08-11T00:00:00.000Z",
        })
        assert.equal(store.get(identity("thread-2")).draft, "two")
        assert.equal(
            store.get(identity("thread-1", {workspaceRoot: "/workspace/two"})).draft,
            "workspace",
        )
        assert.equal(
            store.get(identity("thread-1", {runtimeId: "codebuddy:beta"})).draft,
            "runtime",
        )
    })

    it("keeps a new-task draft and migrates it to the runtime-created thread", () => {
        const store = testStore()
        const newTask = identity(NEW_TASK_CONVERSATION_ID)
        const thread = identity("thread-created")
        store.set(newTask, {draft: "unsent prompt", scrollTop: 0, atBottom: true})

        assert.equal(store.migrate(newTask, thread), true)
        assert.equal(store.get(newTask), null)
        assert.equal(store.get(thread).draft, "unsent prompt")
    })

    it("clears only the submitted conversation draft and preserves its scroll state", () => {
        const store = testStore()
        store.set(identity("submitted"), {draft: "sent", scrollTop: 88, atBottom: false})
        store.set(identity("active"), {draft: "still editing"})

        assert.equal(store.clearDraft(identity("submitted")), true)
        assert.deepEqual(store.get(identity("submitted")), {
            draft: "",
            scrollTop: 88,
            atBottom: false,
            updatedAt: "2026-08-11T00:00:00.000Z",
        })
        assert.equal(store.get(identity("active")).draft, "still editing")
    })

    it("persists state across store instances", () => {
        const storage = memoryStorage()
        testStore({storage}).set(identity("thread-1"), {
            draft: "persisted",
            scrollTop: 54,
            atBottom: false,
        })

        const restored = testStore({storage})
        assert.equal(restored.get(identity("thread-1")).draft, "persisted")
        assert.equal(restored.get(identity("thread-1")).scrollTop, 54)
    })

    it("truncates long drafts and evicts the least recently updated entries", () => {
        const timestamps = [
            "2026-08-11T00:00:01.000Z",
            "2026-08-11T00:00:02.000Z",
            "2026-08-11T00:00:03.000Z",
        ]
        const store = testStore({
            storage: memoryStorage(),
            maxEntries: 2,
            maxDraftLength: 5,
            now: () => timestamps.shift(),
        })

        store.set(identity("old"), {draft: "123456789"})
        store.set(identity("middle"), {draft: "middle"})
        store.set(identity("new"), {draft: "new"})

        assert.equal(store.get(identity("old")), null)
        assert.equal(store.get(identity("middle")).draft, "middl")
        assert.equal(store.get(identity("new")).draft, "new")
        assert.equal(store.size(), 2)
    })

    it("normalizes invalid scroll values without damaging an existing draft", () => {
        const store = testStore()
        store.set(identity("thread-1"), {draft: "keep", scrollTop: 20, atBottom: false})
        store.set(identity("thread-1"), {scrollTop: -10, atBottom: "yes"})

        assert.deepEqual(store.get(identity("thread-1")), {
            draft: "keep",
            scrollTop: 0,
            atBottom: true,
            updatedAt: "2026-08-11T00:00:00.000Z",
        })
    })

    it("continues in memory when localStorage reads or writes fail", () => {
        const storage = {
            getItem() {
                throw new Error("blocked read")
            },
            setItem() {
                throw new Error("quota")
            },
        }
        const store = testStore({storage})

        assert.doesNotThrow(() => store.set(identity("thread-1"), {draft: "available"}))
        assert.equal(store.get(identity("thread-1")).draft, "available")
    })

    it("ignores corrupted or structurally invalid persisted entries", () => {
        const corrupt = memoryStorage({"rolling-skill.thread-view-state.v1": "{broken"})
        const invalid = memoryStorage({
            "rolling-skill.thread-view-state.v1": JSON.stringify({
                version: 1,
                entries: {
                    invalid: {draft: {not: "text"}, scrollTop: "far", atBottom: "sometimes"},
                },
            }),
        })

        assert.equal(testStore({storage: corrupt}).size(), 0)
        assert.equal(testStore({storage: invalid}).size(), 0)
    })

    it("rejects incomplete identities instead of allowing state to leak", () => {
        const store = testStore()

        assert.equal(store.set(identity("thread", {runtimeId: ""}), {draft: "x"}), false)
        assert.equal(store.set(identity("thread", {workspaceRoot: ""}), {draft: "x"}), false)
        assert.equal(store.set(identity(""), {draft: "x"}), false)
        assert.equal(store.size(), 0)
    })
})
