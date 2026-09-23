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

async function fixture(t, {runState = "running", checkpoint = {}, reportError = null, finalApproval = null, paginatedApproval = false, runDetail = {}} = {}) {
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
        if (method === "optimizations.start") {
            const {idempotencyKey: _, ...configuration} = input
            parseOptimizationConfig(configuration)
            return {run: {id: "new-run", state: "running"}}
        }
        throw new Error(`Unexpected method: ${method}`)
    }
    const Panel = loadPanel(requestRollingSkill)
    let renderer
    const navigations = []
    await act(async () => {renderer = create(React.createElement(Panel, {t: (key) => key, onNavigate: (route) => navigations.push(route)}))})
    const profileField = (label) => renderer.root.findAllByType("fieldset").find((field) => field.findAllByType("legend")[0]?.props.children === label)
    const profileSelect = (label, index, value) => act(async () => {profileField(label).findAllByType("select")[index].props.onChange({target: {value}})})
    assert.equal(renderer.root.findAllByType("button").find((entry) => entry.props.children === "startOptimization").props.disabled, true, "incomplete model/target choices cannot start optimization")
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

test("optimization starts directly without a separate preflight step", async (t) => {
    const view = await fixture(t)
    assert.equal(Boolean(view.button("optimizationPreflight")), false)
    assert.equal(view.button("startOptimization").props.disabled, false)
    await view.poll()
    assert.equal(view.button("startOptimization").props.disabled, false, "unchanged background data must not block direct start")
    await view.click("startOptimization")
    const started = view.requests.find((request) => request.method === "optimizations.start")
    assert.equal(started.input.baselineVersionId, "version-1")
    assert.equal(started.input.datasetId, "dataset-1")
    assert.deepEqual(started.input.operator, {runtimeId: "runtime-1", modelId: "model-1", effort: "high"})
    assert.deepEqual(started.input.judge, {runtimeId: "runtime-1", modelId: "saved-judge-model", effort: "max"})
    assert.equal(started.input.activationMode, "automatic")
    assert.equal(started.input.optimizationDirection, null)
    assert.deepEqual(started.input.limits, {maxEpochs: 3})
    for (const removed of ["mode", "telemetry", "target"]) assert.equal(Object.hasOwn(started.input, removed), false)
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
    await view.poll()
    assert.deepEqual(view.renderer.root.findAllByType("select").slice(0, 3).map((entry) => entry.props.value), ["skill-1", "version-2", "dataset-2"])
    assert.equal(view.button("startOptimization").props.disabled, false)
    await view.click("startOptimization")
    const started = view.requests.find((request) => request.method === "optimizations.start")
    assert.equal(started.input.baselineVersionId, "version-2")
    assert.equal(started.input.datasetId, "dataset-2")
})

test("a succeeded optimization is terminal and offers no mutation controls or polling", async (t) => {
    const view = await fixture(t, {runState: "succeeded"})
    assert.equal(Boolean(view.button("pause")), false)
    assert.equal(Boolean(view.button("cancelRun")), false)
    assert.equal(view.timerCount(), 0)
})

test("a newly opened run detail reaches failure even if the list has already become terminal", async (t) => {
    const view = await fixture(t, {runState: "failed"})
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

test("direction, model, effort and maximum Epoch are submitted as visible v3 configuration", async (t) => {
    const view = await fixture(t)
    await view.profileSelect("operatorRuntime", 2, "max")
    const fieldFor = (label, type) => view.renderer.root.findAllByType("label").find((entry) => entry.findAllByType("span")[0]?.props.children === label).findByType(type)
    await act(async () => fieldFor("optimizationDirection", "textarea").props.onChange({target: {value: "  重点改善异常下钻  "}}))
    await act(async () => fieldFor("optimizationMaxEpochs", "input").props.onChange({target: {value: "5"}}))
    await view.click("startOptimization")
    const input = view.requests.findLast((entry) => entry.method === "optimizations.start").input
    assert.equal(input.operator.effort, "max")
    assert.equal(input.optimizationDirection, "重点改善异常下钻")
    assert.deepEqual(input.limits, {maxEpochs: 5})
    assert.equal(Object.hasOwn(input, "search"), false, "candidate search must remain absent unless explicitly enabled")
    await act(async () => fieldFor("optimizationMaxEpochs", "input").props.onChange({target: {value: ""}}))
    assert.equal(view.button("startOptimization").props.disabled, true)
})

test("optimization detail shows its frozen direction and Playbook identity", async (t) => {
    const view = await fixture(t, {runDetail: {
        optimizationDirection: null,
        playbook: {id: "rolling-skill-optimization", version: 1, digest: "sha256:1234567890abcdef"},
    }})
    await view.click("details")
    const content = renderedText(view.renderer.root.findAllByProps({className: "rolling-skill-detail-stack"})[0])
    assert.match(content, /optimizationSystemDirection/u)
    assert.match(content, /Rolling Skill Optimization Playbook v1/u)
    assert.match(content, /sha256:1234567890a/u)
})

test("sampled search is opt-in and submits validated candidate and worker limits", async (t) => {
    const view = await fixture(t)
    const field = (label) => view.renderer.root.findAllByType("label").find((entry) =>
        entry.findAllByType("span")[0]?.props.children === label).findByType("input")
    assert.equal(field("optimizationSampledSearch").props.checked, false)
    await act(async () => field("optimizationSampledSearch").props.onChange({target: {checked: true}}))
    await act(async () => field("optimizationCaseWorkers").props.onChange({target: {value: "3"}}))
    await view.click("startOptimization")
    const input = view.requests.findLast((entry) => entry.method === "optimizations.start").input
    assert.deepEqual(input.search, {candidatesPerRound: 3, failureSamples: 6, caseWorkers: 3})
    assert.deepEqual(input.limits, {maxEpochs: 3})
    await act(async () => field("optimizationCaseWorkers").props.onChange({target: {value: "9"}}))
    assert.equal(view.button("startOptimization").props.disabled, true)
})

test("final approval displays the selected historical candidate rather than the latest epoch", async (t) => {
    const view = await fixture(t, {runState: "waiting_approval",
        checkpoint: {operatorSessionId: "operator-session-1", selectedCandidateArtifactId: "first-candidate"},
        runDetail: {currentEpoch: 2, epochs: [
            {number: 1, status: "completed", candidateArtifactId: "first-candidate", candidate: {versionId: "historical-winner"}, analysis: {score: 95, passRate: 1}},
            {number: 2, status: "deciding", candidateArtifactId: "last-candidate", candidate: {versionId: "latest-loser"}, analysis: {score: 80, passRate: 0.8}},
        ]},
        finalApproval: {id: "final-approval-1", jobId: "operator-job-1", status: "pending", action: "optimization.release-install", risk: "release"},
    })
    await view.click("details")
    const panel = view.renderer.root.findAllByProps({className: "rolling-skill-subpanel"}).find((node) =>
        node.findAllByType("button").some((button) => button.props.children === "optimizationInstallImproved"))
    assert.ok(panel)
    assert.match(renderedText(panel), /historical-winner/)
    assert.doesNotMatch(renderedText(panel), /latest-loser/)
})
