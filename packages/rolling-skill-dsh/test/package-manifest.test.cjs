const assert = require("node:assert/strict")
const {existsSync, readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const {pathToFileURL} = require("node:url")

const packageRoot = join(__dirname, "..")
const manifestPath = join(packageRoot, "package.json")

describe("Rolling Skill DSH package manifest", () => {
    it("declares one installable Host, Client, and Worker bundle", () => {
        assert.equal(existsSync(manifestPath), true, "package manifest should exist")
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

        assert.equal(manifest.name, "@rolling-skill/dsh-plugin")
        assert.match(manifest.version, /^\d+\.\d+\.\d+$/u)
        const lock = JSON.parse(readFileSync(join(packageRoot, "../../package-lock.json"), "utf8"))
        assert.equal(manifest.version, lock.packages["packages/rolling-skill-dsh"].version)
        assert.equal(manifest.type, "module")
        assert.equal(manifest.main, "./lib/index.js")
        assert.equal(manifest.exports["."], "./lib/index.js")
        assert.equal(manifest.exports["./client"], "./lib/client.js")
        assert.equal(manifest.bin["rolling-skill-worker"], "./lib/worker.cjs")
        assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml")
        assert.equal(manifest.dsh.client.platform, "web")
        assert.deepEqual(manifest.dsh.client.inject, [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-client-locale",
            "@deepseek-ai/dsh-client-ui-slots",
            "@deepseek-ai/dsh-client-ui-settings",
            "@deepseek-ai/dsh-client-ui-primitives",
        ])
        assert.deepEqual(
            [...manifest.files].sort(),
            ["README.md", "cordis.patch.yml", "lib", "package.json"].sort(),
        )
        assert.equal(manifest.dependencies?.["@deepseek-ai/dsh-tools"], undefined)
        assert.equal(manifest.dependencies?.["@deepseek-ai/dsh-llm"], undefined)
        assert.equal(manifest.peerDependencies["@deepseek-ai/dsh-tools"], "^0.1.1-rc.1")
        assert.equal(manifest.peerDependencies["@deepseek-ai/dsh-llm"], "^0.1.1-rc.1")
    })

    it("builds an executable Worker with exactly one shebang", () => {
        const workerPath = join(packageRoot, "lib", "worker.cjs")
        assert.equal(existsSync(workerPath), true, "Worker bundle should exist")
        const worker = readFileSync(workerPath, "utf8")
        assert.equal(worker.match(/^#!.*$/gmu)?.length, 1)
        assert.match(worker, /^#!\/usr\/bin\/env node\n/u)
    })

    it("keeps generated bundle lines free of trailing whitespace", () => {
        for (const filename of ["index.js", "client.js", "worker.cjs"]) {
            const bundle = readFileSync(join(packageRoot, "lib", filename), "utf8")
            assert.doesNotMatch(bundle, /[ \t]+$/mu, `${filename} contains trailing whitespace`)
        }
    })

    it("loads the bundled Host in native Node ESM", async () => {
        const hostUrl = pathToFileURL(join(packageRoot, "lib", "index.js"))
        hostUrl.searchParams.set("test", String(Date.now()))
        const host = await import(hostUrl.href)
        assert.equal(typeof host.apply, "function")
    })
})
