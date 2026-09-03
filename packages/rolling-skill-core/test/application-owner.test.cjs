const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {it} = require("node:test")

it("does not construct a second cached store while another Host/Worker owns the data", async (t) => {
    const {createOwnedApplication} = require("../src/application-owner.cjs")
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-owner-"))
    let constructed = 0
    const make = () => createOwnedApplication({lockDirectory: root, createApplication: () => {
        constructed += 1
        return {dispatch: async () => ({owner: constructed}), close: async () => {}}
    }})
    const host = make()
    const worker = make()
    t.after(async () => {await host.close(); await worker.close(); rmSync(root, {recursive: true, force: true})})
    assert.deepEqual(await host.dispatch("dashboard.get", {}), {owner: 1})
    await assert.rejects(worker.dispatch("dashboard.get", {}), {code: "DATA_BUSY"})
    assert.equal(constructed, 1)
    await host.close()
    assert.deepEqual(await worker.dispatch("dashboard.get", {}), {owner: 2})
})
