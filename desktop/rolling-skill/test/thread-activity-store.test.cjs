const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    ThreadActivityStore,
    SUPPORTED_ACTIVITY_TYPES,
} = require("../src/thread-activity-store.cjs")

const temporaryDirectories = []

function temporaryStore(options = {}) {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-thread-activity-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "thread-activity.json")
    return {directory, path, store: new ThreadActivityStore(path, options)}
}

function notification(method, type, item = {}, ids = {}) {
    return {
        method,
        params: {
            threadId: ids.threadId ?? "thread-1",
            turnId: ids.turnId ?? "turn-1",
            item: {id: ids.itemId ?? `${type}-1`, type, ...item},
        },
    }
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

describe("thread activity persistence", () => {
    it("captures supported started/completed items and keeps only compact safe fields", () => {
        const {path, store} = temporaryStore({maxTextLength: 80})
        assert.deepEqual(
            [...SUPPORTED_ACTIVITY_TYPES].sort(),
            [
                "collabAgentToolCall",
                "commandExecution",
                "contextCompaction",
                "dynamicToolCall",
                "fileChange",
                "mcpToolCall",
                "subAgentActivity",
            ],
        )

        store.recordNotification(
            "codex:alpha",
            notification("item/started", "commandExecution", {
                command: "billing-cli query --token top-secret-value",
                aggregatedOutput: "must never be persisted",
                cwd: "/private/workspace",
                status: "inProgress",
            }),
            "2026-08-11T00:00:00.000Z",
        )
        store.recordNotification(
            "codex:alpha",
            notification("item/completed", "commandExecution", {
                command: "billing-cli query --token top-secret-value",
                aggregatedOutput: "must never be persisted",
                status: "completed",
                exitCode: 0,
                durationMs: 27,
            }),
            "2026-08-11T00:00:01.000Z",
        )
        store.recordNotification(
            "codex:alpha",
            notification("item/completed", "mcpToolCall", {
                server: "billing",
                tool: "query_cost",
                status: "failed",
                arguments: {accountToken: "must never be persisted"},
                result: {rows: ["must never be persisted"]},
                error: {message: "permission denied because " + "x".repeat(100)},
            }),
        )
        store.recordNotification(
            "codex:alpha",
            notification("item/completed", "fileChange", {
                status: "completed",
                changes: [
                    {path: "/workspace/a.js", kind: "update", diff: "secret diff"},
                    {path: "/workspace/b.js", kind: "create", diff: "secret diff"},
                ],
            }),
        )

        const activities = store.list("codex:alpha", "thread-1")
        assert.equal(activities.length, 3)
        assert.deepEqual(activities[0].item, {
            id: "commandExecution-1",
            type: "commandExecution",
            status: "completed",
            command: "billing-cli \u2026 [arguments omitted]",
            exitCode: 0,
        })
        assert.deepEqual(activities[1].item, {
            id: "mcpToolCall-1",
            type: "mcpToolCall",
            status: "failed",
            server: "billing",
            tool: "query_cost",
        })
        assert.deepEqual(activities[2].item, {
            id: "fileChange-1",
            type: "fileChange",
            status: "completed",
        })

        const persisted = readFileSync(path, "utf8")
        for (const secret of ["aggregatedOutput", "accountToken", "must never", "secret diff", "top-secret-value", "permission denied", "/workspace/a.js", '"arguments"', '"result"']) {
            assert.equal(persisted.includes(secret), false, `persisted forbidden content: ${secret}`)
        }
    })

    it("never persists command arguments or environment-assignment values", () => {
        const {path, store} = temporaryStore()
        store.recordNotification(
            "codex:alpha",
            notification(
                "item/completed",
                "commandExecution",
                {
                    command: "billing-cli --token sk-abc123 query",
                    status: "completed",
                },
                {itemId: "token-flag"},
            ),
        )
        store.recordNotification(
            "codex:alpha",
            notification(
                "item/completed",
                "commandExecution",
                {
                    command: "AWS_ACCESS_KEY_ID=AKIAEXAMPLE /opt/tools/cost-query account-42",
                    status: "completed",
                },
                {itemId: "environment-secret"},
            ),
        )

        assert.deepEqual(
            store.list("codex:alpha", "thread-1").map((entry) => entry.item.command),
            ["billing-cli \u2026 [arguments omitted]", "cost-query \u2026 [arguments omitted]"],
        )
        const persisted = readFileSync(path, "utf8")
        for (const secret of ["sk-abc123", "AKIAEXAMPLE", "account-42", "/opt/tools"]) {
            assert.equal(persisted.includes(secret), false, `persisted command argument: ${secret}`)
        }
    })

    it("keeps first-seen activity order when concurrent items complete out of order", () => {
        const {store} = temporaryStore()
        store.recordNotification(
            "codex:alpha",
            notification("item/started", "commandExecution", {command: "command-a"}, {itemId: "a"}),
        )
        store.recordNotification(
            "codex:alpha",
            notification("item/started", "commandExecution", {command: "command-b"}, {itemId: "b"}),
        )
        store.recordNotification(
            "codex:alpha",
            notification("item/completed", "commandExecution", {command: "command-b", status: "completed"}, {itemId: "b"}),
        )
        store.recordNotification(
            "codex:alpha",
            notification("item/completed", "commandExecution", {command: "command-a", status: "completed"}, {itemId: "a"}),
        )

        assert.deepEqual(
            store.list("codex:alpha", "thread-1").map((entry) => entry.item.id),
            ["a", "b"],
        )
    })

    it("ignores unrelated notifications, unsupported items, and incomplete identifiers", () => {
        const {store} = temporaryStore()
        assert.equal(
            store.recordNotification(
                "codex:alpha",
                notification("item/agentMessage/delta", "commandExecution"),
            ),
            null,
        )
        assert.equal(
            store.recordNotification("codex:alpha", notification("item/completed", "userMessage")),
            null,
        )
        assert.equal(
            store.recordNotification(
                "",
                notification("item/completed", "commandExecution"),
            ),
            null,
        )
        assert.deepEqual(store.list("codex:alpha", "thread-1"), [])
    })

    it("loads persisted records, tolerates a corrupt file, and writes by atomic replacement", () => {
        const {directory, path, store} = temporaryStore()
        store.recordNotification(
            "codex:alpha",
            notification("item/completed", "dynamicToolCall", {
                tool: "search",
                status: "completed",
                arguments: {secret: true},
                result: "hidden",
            }),
        )

        assert.deepEqual(new ThreadActivityStore(path).list("codex:alpha", "thread-1")[0].item, {
            id: "dynamicToolCall-1",
            type: "dynamicToolCall",
            status: "completed",
            tool: "search",
        })
        assert.deepEqual(readdirSync(directory), ["thread-activity.json"])

        writeFileSync(path, "{not-json", "utf8")
        const recovered = new ThreadActivityStore(path)
        assert.deepEqual(recovered.list("codex:alpha", "thread-1"), [])
        recovered.recordNotification(
            "codex:alpha",
            notification("item/completed", "contextCompaction", {status: "completed"}),
        )
        assert.equal(JSON.parse(readFileSync(path, "utf8")).records.length, 1)
    })

    it("prunes least-recently-updated threads and oldest records to configured limits", () => {
        const {store} = temporaryStore({maxThreads: 2, maxRecords: 3})
        for (let index = 1; index <= 4; index += 1) {
            store.recordNotification(
                "codex:alpha",
                notification(
                    "item/completed",
                    "commandExecution",
                    {command: `command-${index}`, status: "completed"},
                    {threadId: `thread-${index}`, itemId: `item-${index}`},
                ),
                `2026-08-11T00:00:0${index}.000Z`,
            )
        }
        store.recordNotification(
            "codex:alpha",
            notification(
                "item/completed",
                "mcpToolCall",
                {server: "server", tool: "tool"},
                {threadId: "thread-3", itemId: "item-5"},
            ),
            "2026-08-11T00:00:05.000Z",
        )

        assert.deepEqual(store.list("codex:alpha", "thread-1"), [])
        assert.deepEqual(store.list("codex:alpha", "thread-2"), [])
        assert.deepEqual(
            store.list("codex:alpha", "thread-3").map((entry) => entry.item.id),
            ["item-3", "item-5"],
        )
        assert.deepEqual(
            store.list("codex:alpha", "thread-4").map((entry) => entry.item.id),
            ["item-4"],
        )
    })

    it("merges missing activity by item id before the final agent message without mutation", () => {
        const {store} = temporaryStore()
        for (const [itemId, type, item] of [
            ["command-1", "commandExecution", {command: "pwd", status: "completed"}],
            ["tool-1", "mcpToolCall", {server: "fs", tool: "read", status: "completed"}],
            ["subagent-1", "subAgentActivity", {kind: "spawned", agentPath: "/root/reviewer"}],
        ]) {
            store.recordNotification(
                "codex:alpha",
                notification("item/completed", type, item, {itemId}),
            )
        }
        const thread = {
            id: "thread-1",
            name: "Original",
            turns: [
                {
                    id: "turn-1",
                    status: "completed",
                    items: [
                        {id: "user-1", type: "userMessage", content: []},
                        {id: "tool-1", type: "mcpToolCall", server: "native", tool: "read"},
                        {id: "agent-draft", type: "agentMessage", text: "intermediate"},
                        {id: "agent-final", type: "agentMessage", text: "done"},
                    ],
                },
            ],
        }

        const merged = store.mergeThread("codex:alpha", thread)
        assert.notEqual(merged, thread)
        assert.deepEqual(
            merged.turns[0].items.map((item) => item.id),
            ["user-1", "tool-1", "agent-draft", "command-1", "subagent-1", "agent-final"],
        )
        assert.equal(merged.turns[0].items.filter((item) => item.id === "tool-1").length, 1)
        assert.deepEqual(
            thread.turns[0].items.map((item) => item.id),
            ["user-1", "tool-1", "agent-draft", "agent-final"],
        )
    })

    it("does not restore a stale running status into a completed turn", () => {
        const {store} = temporaryStore()
        store.recordNotification(
            "codex:alpha",
            notification("item/started", "commandExecution", {
                command: "long-command",
                status: "inProgress",
            }),
        )

        const merged = store.mergeThread("codex:alpha", {
            id: "thread-1",
            turns: [{id: "turn-1", status: "completed", items: []}],
        })
        assert.equal(merged.turns[0].items[0].status, "unknown")
    })

    it("provides notification, response, and flush adapters for the main process", () => {
        const {path, store} = temporaryStore()
        const captured = store.captureNotification(
            "codex:alpha",
            notification("item/completed", "commandExecution", {
                command: "pwd",
                status: "completed",
            }),
        )
        assert.equal(captured.item.id, "commandExecution-1")

        const response = {
            requestId: "request-1",
            thread: {
                id: "thread-1",
                turns: [
                    {
                        id: "turn-1",
                        items: [{id: "agent-1", type: "agentMessage", text: "done"}],
                    },
                ],
            },
        }
        const merged = store.mergeThreadResponse("codex:alpha", response)
        assert.deepEqual(
            merged.thread.turns[0].items.map((item) => item.id),
            ["commandExecution-1", "agent-1"],
        )
        assert.deepEqual(
            response.thread.turns[0].items.map((item) => item.id),
            ["agent-1"],
        )

        assert.equal(store.flush(), path)
        assert.equal(JSON.parse(readFileSync(path, "utf8")).records.length, 1)
    })
})
