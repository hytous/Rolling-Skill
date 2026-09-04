const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const vm = require("node:vm")

const root = join(__dirname, "..")

function source(path) {
    return readFileSync(join(root, path), "utf8")
}

describe("managed Skill installation detail", () => {
    it("uses the compact managed-workbench primary style for the install action", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(renderer, /installWithRuntimes:\s*"Install on selected runtimes"/u)
        assert.match(renderer, /installWithRuntimes:\s*"安装到所选 Runtime"/u)
        assert.match(styles, /\.managed-install-start\s*\{[^}]*align-self:\s*flex-end/su)
        assert.match(styles, /\.managed-install-start\s*\{[^}]*min-height:\s*31px/su)
        assert.match(styles, /\.managed-install-start\s*\{[^}]*border-radius:\s*8px/su)
        assert.match(styles, /\.managed-install-start\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--accent\)\s*13%,\s*var\(--surface\)\)/su)
        assert.match(styles, /\.managed-install-start:hover:not\(:disabled\)\s*\{/u)
        assert.match(styles, /\.managed-install-start:disabled\s*\{/u)
    })

    it("renders compact progress and keeps the complete execution record collapsed", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(renderer, /installationSession:\s*"Installation details"/u)
        assert.match(renderer, /installationSession:\s*"安装详情"/u)
        assert.match(renderer, /completeExecutionLog:\s*"Complete execution log"/u)
        assert.match(renderer, /completeExecutionLog:\s*"完整执行记录"/u)
        for (const key of [
            "installationStepPreparing",
            "installationStepInstalling",
            "installationStepVerifying",
            "installationStepRegistering",
        ]) assert.match(renderer, new RegExp(`${key}:`))
        assert.match(renderer, /document\.createElement\("details"\)/u)
        assert.match(renderer, /managed-install-diagnostics/u)
        assert.match(renderer, /node\("summary",\s*"",\s*t\("completeExecutionLog"\)\)/u)
        assert.match(styles, /\.managed-install-diagnostics-body\s*\{[^}]*max-height:\s*min\(52vh,\s*640px\)/su)
        assert.match(styles, /\.managed-install-diagnostics-body\s*\{[^}]*overflow:\s*auto/su)
        assert.match(styles, /\.managed-install-diagnostics-body\s*\{[^}]*overflow-wrap:\s*anywhere/su)
        assert.doesNotMatch(styles, /\.managed-install-timeline\s*\{[^}]*max-height:\s*310px/su)
    })

    it("localizes known failures and keeps raw errors inside diagnostics", () => {
        const renderer = source("renderer/renderer.js")

        assert.match(renderer, /function skillInstallationErrorMessage\(/u)
        for (const code of [
            "TARGET_NOT_INSTALLED",
            "OVERWRITE_CONFIRMATION_REQUIRED",
            "INSTALLATION_REGISTRATION_MISSING",
            "INSTALLATION_RESULT_INVALID",
            "EXPERIMENT_TARGET_MISMATCH",
        ]) assert.match(renderer, new RegExp(code))
        assert.match(renderer, /目标目录已有不同内容，本次只读检查未进行覆盖。/u)
        assert.match(renderer, /managed-install-diagnostic-error/u)
        assert.doesNotMatch(
            renderer,
            /managedInstallSession\.append\(node\("p",\s*"managed-skill-error",\s*job\.error\.message\)\)/u,
        )
    })

    it("offers typed retry and recheck actions without a free-form installer composer", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const preload = source("src/preload.cjs")
        const main = source("src/main.cjs")

        assert.match(html, /id="retry-managed-skill-installation"/u)
        assert.match(renderer, /async function retryManagedSkillInstallation\(/u)
        assert.match(renderer, /needs_recovery:\s*"installationStatusNeedsRecovery"/u)
        assert.doesNotMatch(renderer, /sendSkillInstallationMessage|skillInstallationInputDrafts|managed-install-composer/u)
        assert.doesNotMatch(preload, /sendSkillInstallationMessage|skill-installations:send/u)
        assert.doesNotMatch(main, /skill-installations:send/u)
    })

    it("marks incomplete installation and verification steps as needing attention", () => {
        const renderer = source("renderer/renderer.js")
        const start = renderer.indexOf("function skillInstallationSteps")
        const end = renderer.indexOf("\nfunction skillInstallationStepStateLabel", start)
        assert.ok(start >= 0 && end > start)
        const context = {
            TERMINAL_SKILL_INSTALLATION_STATUSES: new Set([
                "succeeded",
                "failed",
                "cancelled",
                "unverified",
                "needs_recovery",
            ]),
            t: (key) => key,
        }
        vm.runInNewContext(renderer.slice(start, end), context)

        const steps = context.skillInstallationSteps({
            status: "unverified",
            registration: {state: "accepted"},
            parsedResult: {status: "unverified"},
        })
        assert.deepEqual(
            Array.from(steps, (step) => step.state),
            ["complete", "failed", "failed", "complete"],
        )
    })
})
