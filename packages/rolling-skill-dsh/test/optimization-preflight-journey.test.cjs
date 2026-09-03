const assert = require("node:assert/strict")
const {join} = require("node:path")
const {test} = require("node:test")
const {buildSync} = require("esbuild")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {parseOptimizationConfig} = require("../../../desktop/rolling-skill/src/optimization/optimization-contract.cjs")

function renderedText(value) {
    if (value === null || value === undefined || typeof value === "boolean") return ""
    if (typeof value === "string" || typeof value === "number") return String(value)
    if (Array.isArray(value)) return value.map(renderedText).join(" ")
    return renderedText(value.props?.children)
}

function loadPanel(requestRollingSkill) {
    const result = buildSync({
        entryPoints: [join(__dirname, "../src/client/workbench/OptimizationPanel.tsx")],
        bundle: true,
        platform: "node",
        format: "cjs",
        jsx: "automatic",
        external: ["react", "react/jsx-runtime", "../api", "@deepseek-ai/dsh-client-ui-primitives"],
        write: false,
    })
    const loaded = {exports: {}}
    const load = (id) => {
        if (id === "../api") return {requestRollingSkill}
        if (id === "@deepseek-ai/dsh-client-ui-primitives") return {
            Button: (props) => React.createElement("button", props),
            Modal: ({open, children, footer}) => open
                ? React.createElement("section", {}, children, footer)
                : null,
        }
        return require(id)
    }
    new Function("require", "module", "exports", result.outputFiles[0].text)(load, loaded, loaded.exports)
    return loaded.exports.OptimizationPanel
}

async function fixture(t, {deferPreflight = false, runState = "running", checkpoint = {}, reportError = null, finalApproval = null, paginatedApproval = false, runDetail = {}} = {}) {
    const previousWindow = global.window
    const timers = new Map()
    let timerId = 0
    global.window = {
        setInterval: (callback) => {timers.set(++timerId, callback); return timerId},
        clearInterval: (id) => timers.delete(id),
    }
    const requests = []
    const skill = {id: "skill-1", repositoryId: "repo-1", name: "Skill"}
    const datasets = ["dataset-1", "dataset-2"].map((id) => ({
        id, name: id, skillReference: {id: skill.id, repositoryId: skill.repositoryId},
        activeRubricVersionId: "rubric-1",
    }))
    const versions = ["version-1", "version-2"].map((id) => ({
        id, skillId: skill.id, repositoryId: skill.repositoryId, state: "released", versionLabel: id,
    }))
    let completePreflight
    const requestRollingSkill = async (method, input) => {
        requests.push({method, input})
        if (method === "runtimes.list") return [{runtimeId: "runtime-1", displayName: "Runtime"}]
        if (method === "runtimes.models") return [{id: "model-1", displayName: "Model", reasoningEfforts: ["high", "max"]}]
        if (method === "settings.get") return {plugin: {runtime: {runtimeId: "runtime-1"}}, rollingSkill: {judgeProfile: {modelId: "saved-judge-model", effort: "max"}}}
        // Every Host response is independently deserialized, even when unchanged.
        if (method === "datasets.list") return structuredClone(datasets)
        if (method === "skills.catalog") return {skills: [structuredClone(skill)]}
        if (method === "skills.get") return {skill: structuredClone(skill), versions: structuredClone(versions)}
        if (method === "optimizations.list") return [{id: "existing-run", state: runState}]
        if (method === "optimizations.get") return {run: {id: input.runId, state: runState, epochs: [], checkpoint, ...structuredClone(runDetail)}}
        if (method === "operators.summary" && paginatedApproval && input.cursor === undefined) return {
            sessions: [], jobs: [], approvals: [], totals: {sessions: 1}, nextCursor: "approval-page",
        }
        if (method === "operators.summary") return {
            sessions: finalApproval ? [{id: "operator-session-1"}] : [],
            jobs: finalApproval ? [{id: "operator-job-1", sessionId: "operator-session-1"}] : [],
            approvals: finalApproval ? [structuredClone(finalApproval)] : [],
            totals: {sessions: finalApproval ? 1 : 0},
            nextCursor: null,
        }
        if (method === "operators.approve") return {approval: {...structuredClone(finalApproval), status: input.decision === "approve" ? "approved" : "rejected"}}
        if (method === "optimizations.report") {
            if (reportError) throw new Error(reportError)
            return {report: {artifactId: "report-1", digest: "sha256:report", mediaType: "text/markdown", preview: "The optimization report"}}
        }
        if (method === "optimizations.preflight") {
            parseOptimizationConfig(input)
            if (deferPreflight) return new Promise((resolve) => {completePreflight = resolve})
            return {ready: true, snapshotDigest: "sha256:preflight"}
        }
        if (method === "optimizations.start") return {run: {id: "new-run", state: "running"}}
        throw new Error(`Unexpected method: ${method}`)
    }
    const Panel = loadPanel(requestRollingSkill)
    let renderer
    const navigations = []
    await act(async () => {renderer = create(React.createElement(Panel, {t: (key) => key, onNavigate: (route) => navigations.push(route)}))})
    const profileField = (label) => renderer.root.findAllByType("fieldset").find((field) => field.findAllByType("legend")[0]?.props.children === label)
    const profileSelect = (label, index, value) => act(async () => {profileField(label).findAllByType("select")[index].props.onChange({target: {value}})})
    assert.equal(renderer.root.findAllByType("button").find((entry) => entry.props.children === "optimizationPreflight").props.disabled, true, "incomplete model/target choices cannot launch preflight")
    await profileSelect("operatorRuntime", 1, "model-1")
    await profileSelect("operatorRuntime", 2, "high")
    await profileSelect("optimizationTargetRuntime 1", 0, "runtime-1")
    await profileSelect("optimizationTargetRuntime 1", 1, "model-1")
    t.after(() => {
        act(() => renderer.unmount())
        global.window = previousWindow
    })
    const button = (text) => renderer.root.findAllByType("button").find((entry) => entry.props.children === text)
    const click = async (text) => act(async () => {button(text).props.onClick()})
    const select = async (index, value) => act(async () => {
        renderer.root.findAllByType("select")[index].props.onChange({target: {value}})
    })
    return {
        button, click, select, profileSelect, requests, renderer, navigations,
        poll: () => act(async () => {for (const callback of [...timers.values()]) callback()}),
        completePreflight: () => act(async () => {completePreflight({ready: true, snapshotDigest: "sha256:preflight"})}),
        timerCount: () => timers.size,
    }
}

test("pending inspection is labelled honestly and opens its actual installation Job", async (t) => {
    const view = await fixture(t, {runState: "editing", checkpoint: {
        installationOperation: "experiment_inspect", installationPending: true, installationJobIds: ["inspection-job-1"],
    }})
    await view.click("details")
    assert.match(JSON.stringify(view.renderer.toJSON()), /optimizationInspectingInstallation/u)
    const link = view.renderer.root.findAllByType("button").find((button) => JSON.stringify(button.props.children).includes("optimizationOpenInstallation"))
    assert.ok(link)
    await act(async () => link.props.onClick())
    assert.deepEqual(view.navigations, [{page: "skill-install", jobId: "inspection-job-1"}])
})

for (const [label, decision] of [
    ["optimizationInstallImproved", "approve"],
    ["optimizationRestoreOriginal", "reject"],
]) test(`final optimization decision ${decision} is resolved inside the open detail`, async (t) => {
    const approval = {
        id: "final-approval-1",
        jobId: "operator-job-1",
        status: "pending",
        action: "optimization.release-install",
        risk: "Release and install the improved version",
    }
    const view = await fixture(t, {
        runState: "waiting_approval",
        checkpoint: {operatorSessionId: "operator-session-1"},
        finalApproval: approval,
    })

    await view.click("details")
    assert.ok(view.button(label), "the final decision must be visible in Optimization detail")
    await view.click(label)

    const resolved = view.requests.filter((request) => request.method === "operators.approve")
    assert.equal(resolved.length, 1)
    assert.deepEqual(resolved[0].input, {
        sessionId: "operator-session-1",
        approvalId: "final-approval-1",
        decision,
        scope: "once",
    })
})

test("final optimization approval remains visible when it is beyond the first Operator summary page", async (t) => {
    const view = await fixture(t, {
        runState: "waiting_approval",
        checkpoint: {operatorSessionId: "operator-session-1"},
        finalApproval: {
            id: "final-approval-1",
            jobId: "operator-job-1",
            status: "pending",
            action: "optimization.release-install",
            risk: "Release and install the improved version",
        },
        paginatedApproval: true,
    })

    await view.click("details")
    assert.ok(view.button("optimizationInstallImproved"))
    assert.ok(view.requests.some((request) => request.method === "operators.summary" && request.input.cursor === "approval-page"))
})

test("final approval presents the Candidate evidence and frozen Runtime impact beside its buttons", async (t) => {
    const view = await fixture(t, {
        runState: "waiting_approval",
        checkpoint: {operatorSessionId: "operator-session-1"},
        finalApproval: {
            id: "final-approval-1",
            jobId: "operator-job-1",
            status: "pending",
            action: "optimization.release-install",
            risk: "Release and install the improved version",
        },
        runDetail: {
            currentEpoch: 2,
            targets: [{runtimeId: "codex:target"}, {runtimeId: "dsh:target"}],
            epochs: [{
                number: 2,
                status: "deciding",
                candidate: {versionId: "candidate-v2"},
                analysis: {score: 93, passRate: 1, regressionCount: 0},
            }],
        },
    })

    await view.click("details")
    const approvalPanel = view.renderer.root.findAllByType("section").find((section) => (
        section.children.some((child) => (
            typeof child === "object" && child.type === "h4" &&
            child.props.children === "optimizationFinalApproval"
        ))
    ))
    const content = renderedText(approvalPanel)
    assert.match(content, /candidate-v2/u)
    assert.match(content, /93/u)
    assert.match(content, /100%/u)
    assert.match(content, /codex:target/u)
    assert.match(content, /dsh:target/u)
    assert.match(content, /Release and install the improved version/u)
})

test("waiting for the final decision exposes only the two decisions and report controls", async (t) => {
    const view = await fixture(t, {
        runState: "waiting_approval",
        checkpoint: {operatorSessionId: "operator-session-1"},
        finalApproval: {
            id: "final-approval-1",
            jobId: "operator-job-1",
            status: "pending",
            action: "optimization.release-install",
            risk: "Release and install the improved version",
        },
    })

    await view.click("details")
    assert.ok(view.button("optimizationInstallImproved"))
    assert.ok(view.button("optimizationRestoreOriginal"))
    assert.ok(view.button("generateOptimizationReport"))
    assert.equal(Boolean(view.button("pause")), false)
    assert.equal(Boolean(view.button("cancelRun")), false)
})

test("optimization preflight survives its own refresh and background polling before Start", async (t) => {
    const view = await fixture(t)
    assert.equal(view.button("optimizationPreflight").props.disabled, false)
    await view.click("optimizationPreflight")
    assert.equal(view.button("startOptimization").props.disabled, false, "successful preflight must survive the resulting list refresh")
    await view.poll()
    assert.equal(view.button("startOptimization").props.disabled, false, "unchanged background data must not invalidate preflight")
    await view.click("startOptimization")
    const started = view.requests.find((request) => request.method === "optimizations.start")
    assert.equal(started.input.baselineVersionId, "version-1")
    assert.equal(started.input.datasetId, "dataset-1")
    assert.deepEqual(started.input.operator, {runtimeId: "runtime-1", modelId: "model-1", effort: "high"})
    assert.deepEqual(started.input.judge, {runtimeId: "runtime-1", modelId: "saved-judge-model", effort: "max"})
    assert.equal(started.input.activationMode, "automatic")
})

test("a recovery checkpoint never claims its interrupted installation is still running", async (t) => {
    const view = await fixture(t, {runState: "needs_recovery", checkpoint: {
        installationOperation: "experiment_inspect", installationPending: true, installationJobIds: ["inspection-job-1"],
    }})
    await view.click("details")
    const status = view.renderer.root.findAllByProps({role: "status"}).find((node) => node.findAllByType("strong").some((strong) => strong.props.children === "statusNeedsRecovery"))
    assert.ok(status)
})

test("optimization keeps the user's baseline and Dataset selections through refresh", async (t) => {
    const view = await fixture(t)
    await view.select(1, "version-2")
    await view.select(2, "dataset-2")
    await view.click("optimizationPreflight")
    await view.poll()
    assert.deepEqual(view.renderer.root.findAllByType("select").slice(0, 3).map((entry) => entry.props.value), ["skill-1", "version-2", "dataset-2"])
    assert.equal(view.button("startOptimization").props.disabled, false)
    await view.click("startOptimization")
    const started = view.requests.find((request) => request.method === "optimizations.start")
    assert.equal(started.input.baselineVersionId, "version-2")
    assert.equal(started.input.datasetId, "dataset-2")
})

test("changing optimization configuration invalidates a completed or in-flight preflight", async (t) => {
    const view = await fixture(t, {deferPreflight: true})
    await view.click("optimizationPreflight")
    await view.completePreflight()
    assert.equal(view.button("startOptimization").props.disabled, false)
    await view.select(1, "version-2")
    assert.equal(view.button("startOptimization").props.disabled, true)
    await view.click("optimizationPreflight")
    await view.select(2, "dataset-2")
    await view.completePreflight()
    assert.equal(view.button("startOptimization").props.disabled, true, "a response for the old configuration cannot authorize the new one")
})

test("a succeeded optimization is terminal and offers no mutation controls or polling", async (t) => {
    const view = await fixture(t, {runState: "succeeded"})
    assert.equal(Boolean(view.button("pause")), false)
    assert.equal(Boolean(view.button("cancelRun")), false)
    assert.equal(view.timerCount(), 0)
})

test("a newly opened run detail reaches failure even if the list has already become terminal", async (t) => {
    const view = await fixture(t, {runState: "failed"})
    await view.click("optimizationPreflight")
    await view.click("startOptimization")
    assert.ok(view.timerCount() > 0, "the open running detail must keep polling independently of the terminal list")
    await view.poll()
    assert.ok(view.requests.some((request) => request.method === "optimizations.get" && request.input.runId === "new-run"))
    assert.equal(view.timerCount(), 0, "polling stops only after the detail also receives a terminal state")
})

test("the generated optimization report remains readable through detail polling", async (t) => {
    const view = await fixture(t)
    await view.click("details")
    await view.click("generateOptimizationReport")
    assert.match(JSON.stringify(view.renderer.toJSON()), /The optimization report/u)
    await view.poll()
    assert.match(JSON.stringify(view.renderer.toJSON()), /The optimization report/u)
})

test("report failures are visible inside the open run detail", async (t) => {
    const view = await fixture(t, {runState: "cancelled", reportError: "Report could not be generated"})
    await view.click("details")
    await view.click("generateOptimizationReport")
    const detail = view.renderer.root.findAllByProps({className: "rolling-skill-detail-stack"})[0]
    assert.ok(detail.findAllByProps({role: "alert"}).some((node) => node.props.children === "Report could not be generated"))
})

test("model, effort and numeric stopping changes are submitted as visible and invalidate prior preflight", async (t) => {
    const view = await fixture(t)
    await view.click("optimizationPreflight")
    await view.profileSelect("operatorRuntime", 2, "max")
    assert.equal(view.button("startOptimization").props.disabled, true)
    const inputFor = (label) => view.renderer.root.findAllByType("label").find((entry) => entry.findAllByType("span")[0]?.props.children === label).findByType("input")
    await act(async () => inputFor("operatorDurationMinutes").props.onChange({target: {value: "15"}}))
    await act(async () => inputFor("optimizationMinimumPassRate").props.onChange({target: {value: "95"}}))
    await view.click("optimizationPreflight")
    const input = view.requests.findLast((entry) => entry.method === "optimizations.preflight").input
    assert.equal(input.operator.effort, "max")
    assert.equal(input.limits.maxDurationMs, 900000)
    assert.equal(input.target.minimumPassRate, 0.95)
    await act(async () => inputFor("optimizationMaxEpochs").props.onChange({target: {value: ""}}))
    assert.equal(view.button("optimizationPreflight").props.disabled, true)
    assert.equal(view.button("startOptimization").props.disabled, true)
})
