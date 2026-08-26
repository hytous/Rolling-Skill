const assert = require("node:assert/strict")
const {mkdtempSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const modulePath = "../src/application.cjs"

describe("shared Rolling Skill application", () => {
    it("owns Case data behind JSON dispatch methods", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-app-"))
        const application = createRollingSkillApplication({dataRoot})

        const before = await application.dispatch("dashboard.get", {})
        assert.equal(before.counts.datasets, 1)
        assert.equal(before.counts.cases, 0)
        assert.equal(before.counts.rawCases, 0)
        assert.equal(before.dataRoot, dataRoot)

        const dataset = await application.dispatch("datasets.create", {name: "DSH cases"})
        const rawCase = await application.dispatch("rawCases.add", {
            question: "How do I refresh this Case?",
            skill: {name: "rolling-skill"},
            source: {kind: "manual"},
        })
        assert.equal(dataset.name, "DSH cases")
        assert.equal(rawCase.question, "How do I refresh this Case?")
        assert.equal((await application.dispatch("datasets.list", {})).length, 2)
        assert.equal((await application.dispatch("rawCases.list", {})).length, 1)

        const snapshot = await application.dispatch("dashboard.get", {})
        snapshot.counts.datasets = 999
        assert.equal((await application.dispatch("dashboard.get", {})).counts.datasets, 2)
        await application.close()
    })

    it("updates existing Rolling Skill and plugin settings through one facade", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-settings-"))
        const application = createRollingSkillApplication({dataRoot})

        const settings = await application.dispatch("settings.update", {
            rollingSkill: {language: "en", autoCaptureMode: "scheduled"},
            plugin: {locale: "en"},
        })
        assert.equal(settings.rollingSkill.language, "en")
        assert.equal(settings.rollingSkill.autoCaptureProfile.mode, "scheduled")
        assert.equal(settings.plugin.locale, "en")
        await application.close()
    })

    it("rejects unknown methods and non-JSON or oversized input", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-guard-"))
        const application = createRollingSkillApplication({dataRoot})

        await assert.rejects(() => application.dispatch("unknown.method", {}), /Unknown Rolling Skill method/u)
        await assert.rejects(
            () => application.dispatch("dashboard.get", {callback() {}}),
            /plain JSON/u,
        )
        await assert.rejects(
            () => application.dispatch("dashboard.get", {text: "x".repeat(1024 * 1024)}),
            /1 MiB/u,
        )
        await application.close()
    })

    it("publishes detached snapshots to subscribers after mutations", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-events-"))
        const application = createRollingSkillApplication({dataRoot})
        const updates = []
        const dispose = application.subscribe((value) => updates.push(value))

        await application.dispatch("datasets.create", {name: "Observed"})
        assert.equal(updates.at(-1).counts.datasets, 2)
        updates.at(-1).counts.datasets = 0
        assert.equal((await application.snapshot()).counts.datasets, 2)

        dispose()
        await application.close()
    })
})
