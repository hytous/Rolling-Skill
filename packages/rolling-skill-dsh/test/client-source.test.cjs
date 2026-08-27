const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const clientRoot = join(__dirname, "../src/client")

function source(path) {
    return readFileSync(join(clientRoot, path), "utf8")
}

describe("Rolling Skill native DSH Client", () => {
    it("adds exactly one finalized Assistant action without replacing conversation nodes", () => {
        const index = source("index.tsx")
        const action = source("conversation/CaseCaptureAction.tsx")
        const dialog = source("conversation/CaseCaptureDialog.tsx")
        const combined = `${index}\n${action}\n${dialog}`

        assert.equal((index.match(/slots\.inject\("conversation\.chat\.assistant-actions"/gu) ?? []).length, 1)
        assert.match(index, /name:\s*"conversation\.chat\.assistant-actions"/u)
        assert.match(index, /id:\s*"rolling-skill-case-capture"/u)
        assert.match(action, /messageId/u)
        assert.match(action, /sessionId/u)
        assert.match(dialog, /conversationCuration\.inspect/u)
        assert.match(dialog, /conversationCuration\.create/u)
        assert.match(dialog, /startSeq/u)
        assert.match(dialog, /datasetId/u)
        assert.match(dialog, /idempotencyKey/u)
        assert.doesNotMatch(combined, /conversation\.chat\.node/u)
        assert.doesNotMatch(dialog, /dangerouslySetInnerHTML/u)
        assert.doesNotMatch(dialog, /(?:episode|events|messages|snapshotPath|digest|runtimePath|providerId|installationId)\s*:/u)
    })

    it("projects durable Draft and saved ranges onto native flow keys", () => {
        const index = source("index.tsx")
        const controller = source("conversation/ConversationCurationMarkers.tsx")
        const projection = source("conversation/curation-markers.cjs")
        const css = source("workbench/workbench.css")

        assert.match(index, /slots\.inject\("conversation\.session\.header\.utilities"/u)
        assert.match(controller, /conversationCuration\.markers/u)
        assert.match(controller, /useSession/u)
        assert.match(controller, /data-chat-flow-key/u)
        assert.match(controller, /CSS\.escape/u)
        assert.match(controller, /rolling-skill:curation-markers-changed/u)
        assert.match(projection, /anchorSeq/u)
        assert.match(css, /rolling-skill-curation-draft/u)
        assert.match(css, /rolling-skill-curation-saved/u)
        assert.match(controller, /markerDraftLegend/u)
        assert.match(controller, /markerSavedLegend/u)
        assert.doesNotMatch(`${index}\n${controller}`, /conversation\.chat\.node/u)
    })

    it("launches an independent workbench and keeps Settings administrative", () => {
        const index = source("index.tsx")
        const locale = source("locale.ts")
        const launcher = source("workbench/WorkbenchLauncher.tsx")
        const overlay = source("workbench/WorkbenchOverlay.tsx")
        const settings = source("settings/RollingSkillSettings.tsx")

        assert.match(index, /slots\.inject\("sidebar\.footer\.action"/u)
        assert.match(index, /name:\s*"sidebar\.footer\.action"/u)
        assert.match(index, /id:\s*"rolling-skill-workbench"/u)
        assert.match(index, /slots\.inject\("settings\.section"/u)
        assert.match(index, /name:\s*"settings\.section"/u)
        assert.match(index, /id:\s*"rolling-skill"/u)
        assert.match(index, /order:\s*20/u)
        assert.match(index, /label:\s*\(\)\s*=>\s*t\("nav"\)/u)
        assert.match(index, /locale\.register\(LOCALE_NAMESPACE,\s*DICTIONARIES\)/u)
        assert.match(locale, /export const zh/u)
        assert.match(locale, /export const en/u)
        assert.match(launcher, /rolling-skill:open-workbench/u)
        assert.match(overlay, /role="dialog"/u)
        assert.match(overlay, /aria-modal="true"/u)
        assert.match(overlay, /event\.key\s*===\s*"Escape"/u)
        assert.match(settings, /<ImportPanel/u)
        assert.doesNotMatch(settings, /<Workbench/u)
        assert.doesNotMatch(index, /conversation\.session["']/u)
        assert.doesNotMatch(index, /replaceChildren|createRoot/u)
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

    it("creates Datasets from stable managed Skill IDs without deployment evidence", () => {
        const datasets = source("workbench/DatasetsPanel.tsx")

        assert.match(datasets, /skills\.catalog/u)
        assert.match(datasets, /repositoryId:\s*selectedSkill\.repositoryId/u)
        assert.match(datasets, /skillId:\s*selectedSkill\.id/u)
        assert.doesNotMatch(datasets, /datasets\.create[\s\S]{0,240}(?:path|runtimeId|providerId)\s*:/u)
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

    it("requires a Released managed version and checks its target installation", () => {
        const evaluations = source("workbench/EvaluationsPanel.tsx")

        assert.match(evaluations, /skills\.versions/u)
        assert.match(evaluations, /installations\.list/u)
        assert.match(evaluations, /version\.state\s*===\s*"released"/u)
        assert.match(evaluations, /versionId,/u)
        assert.match(evaluations, /selectedInstallation/u)
        assert.doesNotMatch(evaluations, /evaluations\.start[\s\S]{0,400}(?:path|commit|contentDigest)\s*:/u)
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
