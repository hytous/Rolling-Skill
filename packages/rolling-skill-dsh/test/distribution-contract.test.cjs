const assert = require("node:assert/strict")
const {existsSync, readFileSync} = require("node:fs")
const {join} = require("node:path")
const {it} = require("node:test")
const {pathToFileURL} = require("node:url")

it("documents DSH distribution and rejects unsafe package entries", async () => {
    const packageRoot = join(__dirname, "..")
    const readme = readFileSync(join(packageRoot, "README.md"), "utf8")
    const rootReadme = readFileSync(join(packageRoot, "..", "..", "README.md"), "utf8")
    assert.match(readme, /dsh plugin --profile web add/u)
    assert.match(readme, /腾讯.*npm|Tencent.*npm/iu)
    assert.match(readme, /卸载|uninstall/iu)
    assert.match(readme, /保留.*数据|retains?.*data/iu)
    assert.match(readme, /mkdir -p packages\/rolling-skill-dsh\/dist/u)
    assert.match(rootReadme, /mkdir -p packages\/rolling-skill-dsh\/dist/u)

    const scriptPath = join(packageRoot, "scripts", "inspect-package.mjs")
    assert.equal(existsSync(scriptPath), true)
    const {inspectEntries} = await import(`${pathToFileURL(scriptPath).href}?test=${Date.now()}`)
    const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
    const manifest = JSON.stringify({name: "@rolling-skill/dsh-plugin", version: packageManifest.version})
    const safe = new Map([
        ["package/package.json", Buffer.from(manifest)],
        ["package/README.md", Buffer.from("Rolling Skill")],
        ["package/cordis.patch.yml", Buffer.from("- insert: []")],
        ["package/lib/index.js", Buffer.from("export function apply() {}")],
        ["package/lib/client.js", Buffer.from("window.__ModuleLoader__.load({id:'@rolling-skill/dsh-plugin'})")],
        ["package/lib/worker.cjs", Buffer.from("#!/usr/bin/env node\n")],
        ["package/lib/rolling-skill-tool", Buffer.from("#!/usr/bin/env node\n")],
    ])
    const report = inspectEntries(safe)
    assert.equal(report.fileCount, 7)
    assert.equal(report.unpackedBytes, [...safe.values()].reduce((sum, body) => sum + body.byteLength, 0))
    assert.equal(report.packedBytes, null)
    assert.deepEqual(report.files, [...safe.keys()].sort())
    assert.throws(() => inspectEntries(new Map([...safe, ["package/private.env", Buffer.from("TOKEN=secret")]])), /allowlist/iu)
    assert.throws(() => inspectEntries(new Map([...safe].map(([name, body]) => [name, name.endsWith("index.js") ? Buffer.from("/workspace/projects/private") : body]))), /developer path/iu)
    assert.throws(() => inspectEntries(new Map([...safe].map(([name, body]) => [name, name.endsWith("index.js") ? Buffer.from("/Users/alice/Projects/rolling-skill") : body]))), /developer path/iu)
    const inspector = readFileSync(scriptPath, "utf8")
    assert.doesNotMatch(inspector, /MAX_(?:PACKAGE|ARCHIVE|TOTAL)_BYTES/u)
    assert.match(inspector, /packedBytes/u)
    assert.match(inspector, /unpackedBytes/u)
    assert.match(inspector, /fileCount/u)
    assert.match(inspector, /Chromium/iu)
})
