const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, statSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const modulePath = "../src/config-store.cjs"

function storeFixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-plugin-config-"))
    const path = join(directory, "config.json")
    const {RollingSkillConfigStore} = require(modulePath)
    return {path, store: new RollingSkillConfigStore(path)}
}

describe("Rolling Skill plugin configuration", () => {
    it("defaults to Harness-owned scheduling and locale", () => {
        const {path, store} = storeFixture()
        assert.deepEqual(store.read(), {
            schemaVersion: "rolling-skill-plugin-config/v1",
            locale: "follow-harness",
            executionLocation: "while-harness-running",
            runtime: null,
            captureRuntime: null,
            detectionRuntime: null,
            worker: {
                enabled: false,
                installed: false,
                platform: null,
                lastRegistrationError: null,
            },
        })
        assert.equal(statSync(path).mode & 0o777, 0o600)
    })

    it("persists a complete Runtime identity before always-on execution", () => {
        const {path, store} = storeFixture()
        const runtime = {
            providerId: "deepseek-harness",
            runtimeId: "deepseek-harness:one",
            displayName: "DeepSeek Harness",
            version: "0.1.1-rc.1",
            executablePath: "/Users/wangbaoheng/.local/bin/dsh",
        }
        const updated = store.update({
            locale: "zh-CN",
            executionLocation: "always",
            runtime,
            worker: {enabled: true},
        })

        assert.equal(updated.executionLocation, "always")
        assert.deepEqual(updated.runtime, runtime)
        assert.equal(updated.worker.enabled, true)
        assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), updated)
    })

    it("rejects always-on mode without a Runtime and unsafe Runtime paths", () => {
        const {store} = storeFixture()
        assert.throws(
            () => store.update({executionLocation: "always"}),
            /requires a Runtime/u,
        )
        assert.throws(
            () => store.update({runtime: {
                providerId: "deepseek-harness",
                runtimeId: "deepseek-harness:one",
                executablePath: "bin/dsh",
            }}),
            /absolute/u,
        )
    })

    it("returns detached snapshots and rejects unknown values", () => {
        const {store} = storeFixture()
        const first = store.read()
        first.worker.enabled = true
        assert.equal(store.read().worker.enabled, false)
        assert.throws(() => store.update({locale: "fr"}), /locale/u)
        assert.throws(() => store.update({executionLocation: "daemon"}), /execution location/u)
        assert.throws(() => store.update({unknown: true}), /unknown field/u)
    })
})
