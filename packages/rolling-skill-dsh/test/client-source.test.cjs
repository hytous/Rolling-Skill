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

    it("ships native Dataset, Case, and Raw Case panels with refresh and recovery actions", () => {
        const datasets = source("workbench/DatasetsPanel.tsx")
        const cases = source("workbench/CasesPanel.tsx")
        const rawCases = source("workbench/RawCasesPanel.tsx")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(datasets, /datasets\.create/u)
        assert.match(datasets, /datasets\.delete/u)
        assert.match(datasets, /datasets\.exportCsv/u)
        assert.match(cases, /cases\.refreshBatch/u)
        assert.match(cases, /cases\.delete/u)
        assert.match(rawCases, /rawCases\.update/u)
        assert.match(rawCases, /rawCases\.recycle/u)
        assert.match(`${datasets}\n${cases}`, /recoverQuestions/u)
        assert.match(workbench, /<DatasetsPanel/u)
        assert.match(workbench, /<CasesPanel/u)
        assert.match(workbench, /<RawCasesPanel/u)
    })

    it("reuses a full-identity Runtime row for Case refresh and evaluations", () => {
        const runtime = source("workbench/RuntimeSelect.tsx")
        const evaluations = source("workbench/EvaluationsPanel.tsx")
        const cases = source("workbench/CasesPanel.tsx")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(runtime, /displayName/u)
        assert.match(runtime, /version/u)
        assert.match(runtime, /executablePath/u)
        assert.match(evaluations, /runtimes\.list/u)
        assert.match(evaluations, /runtimes\.models/u)
        assert.match(evaluations, /evaluations\.start/u)
        assert.match(evaluations, /evaluations\.cancel/u)
        assert.match(evaluations, /<RuntimeSelect/u)
        assert.match(cases, /<RuntimeSelect/u)
        assert.match(workbench, /<EvaluationsPanel/u)
    })

    it("exposes managed Skill release and Runtime installation as separate native flows", () => {
        const skills = source("workbench/SkillsPanel.tsx")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(skills, /skills\.catalog/u)
        assert.match(skills, /skills\.createCandidate/u)
        assert.match(skills, /skills\.release/u)
        assert.match(skills, /installations\.start/u)
        assert.match(skills, /installations\.cancel/u)
        assert.match(skills, /installations\.inspect/u)
        assert.match(skills, /<RuntimeSelect/u)
        assert.match(workbench, /<SkillsPanel/u)
    })

    it("ships native Operator and Optimization panels without private control fields", () => {
        const operator = source("workbench/OperatorPanel.tsx")
        const optimization = source("workbench/OptimizationPanel.tsx")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(operator, /operators\.start/u)
        assert.match(operator, /operators\.pause/u)
        assert.match(operator, /operators\.resume/u)
        assert.match(operator, /operators\.approve/u)
        assert.match(operator, /<RuntimeSelect/u)
        assert.match(optimization, /optimizations\.start/u)
        assert.match(optimization, /optimizations\.pause/u)
        assert.match(optimization, /optimizations\.resume/u)
        assert.match(optimization, /optimizations\.cancel/u)
        assert.match(workbench, /<OperatorPanel/u)
        assert.match(workbench, /<OptimizationPanel/u)
        assert.doesNotMatch(`${operator}\n${optimization}`, /capabilityId|socketPath|childEnvironment|executablePath\s*:/u)
    })

    it("ships the complete automatic capture settings and status panel", () => {
        const automatic = source("workbench/AutomaticCapturePanel.tsx")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(automatic, /automatic\.status/u)
        assert.match(automatic, /automatic\.update/u)
        assert.match(automatic, /automatic\.runOnce/u)
        assert.match(automatic, /scheduler\.enable/u)
        assert.match(automatic, /scheduler\.disable/u)
        assert.match(automatic, /scheduled/u)
        assert.match(automatic, /automatic/u)
        assert.match(automatic, /while-harness-running/u)
        assert.match(automatic, /always/u)
        assert.match(automatic, /weekly/u)
        assert.match(automatic, /<RuntimeSelect/u)
        assert.match(workbench, /<AutomaticCapturePanel/u)
    })

    it("ships an explicit copy-only legacy import panel", () => {
        const panel = source("workbench/ImportPanel.tsx")
        const workbench = source("workbench/Workbench.tsx")

        assert.match(panel, /legacyImport\.status/u)
        assert.match(panel, /legacyImport\.run/u)
        assert.match(panel, /confirmImport/u)
        assert.match(workbench, /<ImportPanel/u)
    })
})
