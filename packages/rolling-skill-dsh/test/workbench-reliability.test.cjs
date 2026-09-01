const assert = require("node:assert/strict")
const {existsSync, readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const {buildSync} = require("esbuild")

const packageRoot = join(__dirname, "..")

function loadBundledApi() {
    const result = buildSync({
        entryPoints: [join(packageRoot, "src/client/api.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        write: false,
    })
    const loaded = {exports: {}}
    const execute = new Function("require", "module", "exports", result.outputFiles[0].text)
    execute(require, loaded, loaded.exports)
    return loaded.exports
}

describe("DSH workbench reliability journeys", () => {
    it("keeps polling active work when the server revision does not change", async () => {
        const schedulerPath = join(
            packageRoot,
            "src/client/workbench/polling-scheduler.cjs",
        )
        assert.equal(existsSync(schedulerPath), true, "shared polling scheduler must exist")
        const {createPollingScheduler} = require(schedulerPath)
        const seen = []
        let status = "running"
        const scheduler = createPollingScheduler({
            intervalMs: 5,
            schedule: setTimeout,
            cancel: clearTimeout,
        })

        scheduler.start(async () => {
            const current = status
            seen.push(current)
            if (seen.length === 4) status = "needs_review"
            return current === "running"
        })
        await scheduler.idle()

        assert.deepEqual(seen, [
            "running",
            "running",
            "running",
            "running",
            "needs_review",
        ])
    })

    it("distinguishes a disconnected Host from a valid business error", async () => {
        const api = loadBundledApi()
        assert.equal(typeof api.getRollingSkillConnectionSnapshot, "function")
        assert.equal(typeof api.subscribeRollingSkillConnection, "function")
        assert.equal(typeof api.requestRollingSkill, "function")
        const originalFetch = global.fetch
        const states = []
        const unsubscribe = api.subscribeRollingSkillConnection(() => {
            states.push(api.getRollingSkillConnectionSnapshot().status)
        })

        try {
            global.fetch = async () => {
                throw new TypeError("Failed to fetch")
            }
            await assert.rejects(
                api.requestRollingSkill("dashboard.get"),
                (error) => error.code === "CONNECTION_UNAVAILABLE",
            )
            assert.equal(api.getRollingSkillConnectionSnapshot().status, "disconnected")

            global.fetch = async () => ({
                ok: false,
                status: 409,
                json: async () => ({
                    ok: false,
                    error: {code: "STALE_REVISION", message: "Refresh and retry"},
                }),
            })
            await assert.rejects(
                api.requestRollingSkill("datasets.delete"),
                (error) => error.code === "STALE_REVISION",
            )
            assert.equal(api.getRollingSkillConnectionSnapshot().status, "connected")
            assert.deepEqual(states, ["disconnected", "connected"])
        } finally {
            unsubscribe()
            global.fetch = originalFetch
        }
    })

    it("uses one continuous polling primitive across Curator and Rubric views", () => {
        const hookPath = join(
            packageRoot,
            "src/client/workbench/usePollingRevision.ts",
        )
        assert.equal(existsSync(hookPath), true, "shared React polling hook must exist")
        const hookSource = readFileSync(hookPath, "utf8")
        assert.match(hookSource, /createPollingScheduler/)

        for (const file of [
            "CurationPanel.tsx",
            "CurationSessionView.tsx",
            "RubricPanel.tsx",
            "RubricSessionView.tsx",
        ]) {
            const source = readFileSync(join(
                packageRoot,
                "src/client/workbench",
                file,
            ), "utf8")
            assert.match(source, /usePollingRevision/)
            assert.doesNotMatch(source, /window\.setTimeout\(.*setRevision/s)
        }
    })

    it("exposes one reconnect banner and human-readable operation states", () => {
        const workbenchSource = readFileSync(join(
            packageRoot,
            "src/client/workbench/Workbench.tsx",
        ), "utf8")
        assert.match(workbenchSource, /subscribeRollingSkillConnection/)
        assert.match(workbenchSource, /connectionUnavailable/)
        assert.match(workbenchSource, /reconnect/)

        const displayStatePath = join(
            packageRoot,
            "src/client/workbench/display-state.ts",
        )
        assert.equal(existsSync(displayStatePath), true, "shared display-state helpers must exist")
        const source = readFileSync(displayStatePath, "utf8")
        for (const status of [
            "queued",
            "running",
            "needs_review",
            "failed",
            "archived",
            "completed",
            "cancelled",
        ]) assert.match(source, new RegExp(status))

        for (const file of ["OperationStatus.tsx", "ConfirmDialog.tsx"]) {
            assert.equal(existsSync(join(
                packageRoot,
                "src/client/workbench",
                file,
            )), true, `${file} must exist`)
        }
    })
})
