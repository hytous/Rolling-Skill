const assert = require("node:assert/strict")
const {mkdtempSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {it} = require("node:test")
const {pathToFileURL} = require("node:url")

it("registers and disposes the Rolling Skill Cordis Host route", async () => {
    const source = pathToFileURL(join(__dirname, "../src/host/index.js"))
    const plugin = await import(`${source.href}?test=${Date.now()}`)
    const effects = []
    let registeredRoute = null
    let routeDisposed = false
    const toolNames = []
    const context = {
        tools: {
            register(definition) {
                toolNames.push(definition.name)
                return () => {}
            },
        },
        webServer: {
            register(route) {
                registeredRoute = route
                return () => {
                    routeDisposed = true
                }
            },
        },
        effect(factory, label) {
            const dispose = factory()
            effects.push({dispose, label})
            return dispose
        },
    }

    assert.deepEqual(plugin.inject, ["webServer", "tools"])
    plugin.apply(context, {
        dataRoot: mkdtempSync(join(tmpdir(), "rolling-skill-host-")),
    })

    assert.equal(registeredRoute.kind, "exact")
    assert.equal(registeredRoute.path, "/rolling-skill/api")
    assert.equal(typeof registeredRoute.handler, "function")
    assert.equal(effects[0].label, "rolling-skill: host service")
    assert.deepEqual(toolNames, [
        "rolling_skill_status",
        "rolling_skill_add_raw_case",
        "rolling_skill_start_evaluation",
        "rolling_skill_run_capture",
    ])

    await effects[0].dispose()
    assert.equal(routeDisposed, true)
})
