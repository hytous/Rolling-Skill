const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const clientRoot = join(__dirname, "../src/client")

function source(path) {
    return readFileSync(join(clientRoot, path), "utf8")
}

describe("Rolling Skill native DSH Client", () => {
    it("registers one localized additive Settings section", () => {
        const index = source("index.tsx")
        const locale = source("locale.ts")

        assert.match(index, /slots\.inject\("settings\.section"/u)
        assert.match(index, /name:\s*"settings\.section"/u)
        assert.match(index, /id:\s*"rolling-skill"/u)
        assert.match(index, /order:\s*20/u)
        assert.match(index, /label:\s*\(\)\s*=>\s*t\("nav"\)/u)
        assert.match(index, /locale\.register\(LOCALE_NAMESPACE,\s*DICTIONARIES\)/u)
        assert.match(locale, /export const zh/u)
        assert.match(locale, /export const en/u)
        assert.doesNotMatch(index, /sidebar|replaceChildren|createRoot/u)
    })

    it("uses the bounded same-origin API and aborts stale requests", () => {
        const api = source("api.ts")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(api, /"\/rolling-skill\/api"/u)
        assert.match(api, /signal/u)
        assert.match(workbench, /new AbortController\(\)/u)
        assert.match(workbench, /controller\.abort\(\)/u)
        assert.doesNotMatch(`${api}\n${workbench}`, /electron|iframe|window\.open|target=["']_blank/iu)
    })

    it("uses Harness primitives and theme tokens without fixed page colors", () => {
        const workbench = source("workbench/Workbench.tsx")
        const css = source("workbench/workbench.css")

        assert.match(workbench, /@deepseek-ai\/dsh-client-ui-primitives/u)
        assert.match(workbench, /<Button/u)
        assert.match(css, /var\(--dsw-alias-bg-layer-2\)/u)
        assert.match(css, /var\(--dsw-alias-label-primary\)/u)
        assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu)
    })
})
