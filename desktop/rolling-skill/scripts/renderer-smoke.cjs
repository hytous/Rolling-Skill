const {app, BrowserWindow, ipcMain} = require("electron")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")

const {
    parseControlInput,
    parseControlOutput,
} = require("../src/control-plane/contracts.cjs")
const {OperatorJobEngine} = require("../src/operator/job-engine.cjs")
const {OperatorJobStore} = require("../src/operator/job-store.cjs")
const {publicOperatorSummaryPage} = require("../src/operator/public-summary.cjs")
const {operatorApprovalRequirement} = require("../src/control-plane/policy.cjs")

const temporaryDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-renderer-smoke-"))
app.setPath("userData", join(temporaryDirectory, "profile"))
let operatorFixture = null

function operatorBudget() {
    return {
        maxDurationMs: 3_600_000,
        maxRuntimeTurns: 20,
        maxEvaluations: 5,
        maxTargetExecutions: 50,
        maxJudgeExecutions: 20,
        maxTokens: null,
        maxReportedCost: null,
    }
}

function operatorRuntime() {
    return {
        runtimeId: "codex:renderer-smoke",
        providerId: "codex",
        displayName: "Codex",
        version: "smoke",
    }
}

function publicOperatorSession(session) {
    return {
        id: session.id,
        runtime: session.runtime,
        modelId: session.modelId,
        effort: session.effort,
        protocol: session.protocol,
        transcriptSequence: session.transcriptSequence,
        transcript: session.transcript,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        closedAt: session.closedAt,
    }
}

function publicOperatorJob(job) {
    return {
        id: job.id,
        sessionId: job.sessionId,
        parentJobId: job.parentJobId,
        type: job.type,
        objective: job.objective,
        budget: job.budget,
        status: job.status,
        childJobIds: job.children,
        artifactIds: job.artifactIds,
        approvalIds: job.approvalIds,
        checkpoint: job.checkpoint,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
    }
}

function publicOperatorApproval(approval) {
    return {
        id: approval.id,
        jobId: approval.jobId,
        sessionId: approval.sessionId,
        stepId: approval.stepId,
        action: approval.action,
        scope: approval.scope,
        risk: approval.risk,
        expiresAt: approval.expiresAt,
        status: approval.status,
        decision: approval.decision,
        decisionScope: approval.decisionScope,
        decidedBy: approval.decidedBy,
        createdAt: approval.createdAt,
        resolvedAt: approval.resolvedAt,
    }
}

function createOperatorFixture() {
    const registryFile = join(temporaryDirectory, "operator-jobs.json")
    let store = new OperatorJobStore(registryFile)
    let engine = createEngine()
    let fixtureIds = null
    let pagingRecordsPopulated = false
    let approvalCalls = 0
    let stopCalls = 0
    let operatorCreateInput = null
    const summaryPageCalls = []
    const artifacts = []

    function createEngine() {
        return new OperatorJobEngine({
            store,
            handlers: {
                "skills.release": async () => ({
                    versionId: "managed-version-smoke",
                    versionLabel: "v1.0.0",
                }),
            },
        })
    }

    function createSession() {
        return store.createSession({
            runtime: operatorRuntime(),
            modelId: "gpt-5.6-sol",
            effort: "high",
            protocol: "rolling-skill-operator/v1",
            capabilityId: "renderer-smoke-capability",
        })
    }

    function appendTranscript(sessionId, jobId, contents) {
        store.appendSessionTranscript(sessionId, {
            kind: "operator_session_configuration",
            scopes: {
                skillIds: ["managed-skill-smoke"],
                datasetIds: ["dataset-smoke"],
                runtimeIds: ["codex:renderer-smoke"],
                repositoryIds: ["managed-repository-smoke"],
            },
        })
        for (const content of contents) {
            store.appendSessionTranscript(sessionId, {
                kind: "message",
                jobId,
                role: "assistant",
                content,
            })
        }
    }

    async function initialize() {
        const runningSession = createSession()
        const runningJob = store.createJob({
            sessionId: runningSession.id,
            type: "operator-session",
            objective: "Running Operator smoke Job",
            budget: operatorBudget(),
        })
        store.transitionJob(runningJob.id, "running")
        appendTranscript(
            runningSession.id,
            runningJob.id,
            Array.from({length: 14}, (_unused, index) => `Running fixture output ${index}`),
        )

        const streamingSession = createSession()
        const streamingJob = store.createJob({
            sessionId: streamingSession.id,
            type: "operator-session",
            objective: "Hidden streaming Operator smoke Job",
            budget: operatorBudget(),
        })
        store.transitionJob(streamingJob.id, "running")
        appendTranscript(
            streamingSession.id,
            streamingJob.id,
            Array.from({length: 30}, (_unused, index) => `Hidden fixture output ${index}`),
        )

        const waitingSession = createSession()
        const waitingJob = store.createJob({
            sessionId: waitingSession.id,
            type: "operator-session",
            objective: "Release candidate after evaluation",
            budget: operatorBudget(),
        })
        store.transitionJob(waitingJob.id, "running")
        const evaluationJob = store.createJob({
            sessionId: waitingSession.id,
            parentJobId: waitingJob.id,
            type: "evaluation",
            objective: "Evaluation 1/2",
            budget: operatorBudget(),
        })
        store.transitionJob(evaluationJob.id, "running")
        const evaluationStep = store.createStep(evaluationJob.id, {
            method: "evaluations.start",
            params: {
                runId: "run-smoke",
                datasetId: "dataset-smoke",
                selectionMode: "selected",
                caseIds: ["case-smoke"],
                runtimeConfigurations: [{runtimeId: "codex:renderer-smoke"}],
            },
            reservation: {evaluations: 1, targetExecutions: 1},
            idempotencyKey: "renderer-smoke-evaluation",
        })
        store.transitionStep(evaluationStep.id, "running")
        const releaseJob = store.createJob({
            sessionId: waitingSession.id,
            parentJobId: waitingJob.id,
            type: "release",
            objective: "Release approved candidate",
            budget: operatorBudget(),
        })
        const releaseGate = await engine.execute(releaseJob.id, {
            method: "skills.release",
            params: {
                skillId: "managed-skill-smoke",
                versionId: "managed-version-smoke",
                versionLabel: "v1.0.0",
            },
            policyApproval: operatorApprovalRequirement("skills.release", {
                skillId: "managed-skill-smoke",
                versionId: "managed-version-smoke",
                versionLabel: "v1.0.0",
            }),
            idempotencyKey: "renderer-smoke-release",
        })
        store.transitionJob(waitingJob.id, "waiting_approval")
        appendTranscript(
            waitingSession.id,
            waitingJob.id,
            ["Candidate evaluation finished; release is waiting for approval."],
        )

        fixtureIds = {
            runningSessionId: runningSession.id,
            runningJobId: runningJob.id,
            streamingSessionId: streamingSession.id,
            streamingJobId: streamingJob.id,
            waitingSessionId: waitingSession.id,
            waitingJobId: waitingJob.id,
            evaluationJobId: evaluationJob.id,
            evaluationStepId: evaluationStep.id,
            releaseJobId: releaseJob.id,
            approvalId: releaseGate.approvalId,
        }
        artifacts.push({
            id: "operator-artifact-report",
            jobId: waitingJob.id,
            kind: "evaluation-report",
            name: "Evaluation report",
            mediaType: "application/json",
            byteLength: 128,
            sha256: "a".repeat(64),
            metadata: {
                datasetId: "dataset-smoke",
                evaluationId: "run-smoke",
                candidateId: "managed-version-smoke",
            },
            createdAt: "2026-08-24T08:00:01.500Z",
        })
    }

    function changedPayload(jobId = null) {
        return {
            generation: store.generation,
            revision: store.revision,
            ...(jobId ? {job: publicOperatorJob(store.getJob(jobId))} : {invalidate: true}),
        }
    }

    const ready = initialize()
    return {
        ready,
        async invoke(method, input = {}) {
            await ready
            switch (method) {
            case "bootstrap":
                return publicOperatorSummaryPage(store.readSummaryPage({cursor: null, limit: 100}))
            case "read-summary":
                summaryPageCalls.push({cursor: input.cursor ?? null, limit: input.limit ?? 100})
                return publicOperatorSummaryPage(store.readSummaryPage({
                    cursor: input.cursor ?? null,
                    limit: input.limit ?? 100,
                }))
            case "get-session": {
                const session = store.getSession(input.sessionId)
                const parentJob = store.listJobs({
                    sessionId: input.sessionId,
                    parentJobId: null,
                }).find((entry) => entry.parentJobId === null)
                if (!parentJob) throw new Error("Unknown smoke Operator session")
                return {
                    session: publicOperatorSession(session),
                    parentJob: publicOperatorJob(parentJob),
                    runtimeThreadId: `runtime-thread-${input.sessionId}`,
                    transport: {kind: "codex-dynamic", ready: true},
                    state: "idle",
                }
            }
            case "pause":
                return publicOperatorJob(store.transitionJob(input.jobId, "paused"))
            case "resume":
                return publicOperatorJob(store.transitionJob(input.jobId, "running"))
            case "stop":
                stopCalls += 1
                store.beginCancellation(input.jobId)
                return publicOperatorJob(store.cancelJobTree(input.jobId).job)
            case "create-session": {
                operatorCreateInput = structuredClone(input)
                const session = createSession()
                store.appendSessionTranscript(session.id, {
                    kind: "operator_session_configuration",
                    actions: input.actions,
                    scopes: input.scopes,
                    budget: input.budget,
                })
                const job = store.createJob({
                    sessionId: session.id,
                    type: "operator-session",
                    objective: input.objective,
                    budget: input.budget,
                })
                store.transitionJob(job.id, "running")
                fixtureIds.createdSessionId = session.id
                fixtureIds.createdJobId = job.id
                return {
                    session: publicOperatorSession(store.getSession(session.id)),
                    parentJob: publicOperatorJob(store.getJob(job.id)),
                }
            }
            case "resolve-approval": {
                approvalCalls += 1
                const pending = store.getApproval(input.approvalId)
                const execution = await engine.resolveApproval(input.approvalId, {
                    decision: input.decision,
                    scope: "once",
                    decidedBy: "renderer-smoke",
                })
                if (pending.action === "optimization.release-install") {
                    const job = store.getJob(pending.jobId)
                    if (job.status === "running") {
                        store.transitionJob(job.id, input.decision === "approve" ? "succeeded" : "failed", {
                            ...(input.decision === "reject" ? {error: {
                                code: "OPTIMIZATION_FINAL_APPROVAL_REJECTED",
                                message: "Final Optimization approval was rejected",
                            }} : {}),
                        })
                    }
                }
                return {
                    approval: publicOperatorApproval(store.getApproval(input.approvalId)),
                    execution,
                    changed: changedPayload(pending.jobId),
                }
            }
            case "list-artifacts": {
                const offset = input.cursor === null ? 0 : Number(input.cursor)
                const matches = artifacts.filter((entry) => entry.jobId === input.jobId)
                const end = Math.min(offset + input.limit, matches.length)
                return {artifacts: matches.slice(offset, end), nextCursor: end < matches.length ? end : null}
            }
            case "emit-hidden": {
                const event = store.appendEvent(fixtureIds.streamingJobId, {
                    kind: "message",
                    sessionId: fixtureIds.streamingSessionId,
                    role: "assistant",
                    content: "Hidden streamed output after bootstrap",
                })
                return {generation: store.generation, revision: store.revision, event}
            }
            case "emit-gap":
                store.appendSessionTranscript(fixtureIds.streamingSessionId, {
                    kind: "message",
                    jobId: fixtureIds.streamingJobId,
                    role: "assistant",
                    content: "Gap catch-up output",
                })
                store.appendEvent(fixtureIds.streamingJobId, {kind: "progress", completed: 1})
                store.appendEvent(fixtureIds.streamingJobId, {kind: "progress", completed: 2})
                return changedPayload(fixtureIds.streamingJobId)
            case "restart":
                store.close()
                store = new OperatorJobStore(registryFile)
                engine = createEngine()
                for (const jobId of [
                    fixtureIds.runningJobId,
                    fixtureIds.streamingJobId,
                    fixtureIds.evaluationJobId,
                ]) {
                    if (store.getJob(jobId).status === "needs_recovery") {
                        store.transitionJob(jobId, "running")
                    }
                }
                return changedPayload()
            case "populate-pages":
                if (!pagingRecordsPopulated) {
                    for (let index = 0; index < 90; index += 1) {
                        const terminal = store.createJob({
                            sessionId: fixtureIds.runningSessionId,
                            parentJobId: fixtureIds.runningJobId,
                            type: "fixture-history",
                            objective: `Completed fixture history ${index}`,
                            budget: operatorBudget(),
                        })
                        store.transitionJob(terminal.id, "cancelled")
                    }
                    pagingRecordsPopulated = true
                }
                return changedPayload()
            case "create-optimization": {
                const session = store.createSession({
                    runtime: operatorRuntime(),
                    modelId: "gpt-5.6-sol",
                    effort: "high",
                    protocol: "rolling-skill-operator/v1",
                    capabilityId: "renderer-smoke-optimization-capability",
                })
                store.appendSessionTranscript(session.id, {
                    kind: "operator_session_configuration",
                    title: "Skill 自动优化 · . · optimization",
                    scopes: {
                        skillIds: ["managed-skill-smoke-two"],
                        datasetIds: ["optimization-dataset-smoke"],
                        runtimeIds: ["codex:renderer-smoke", "codebuddy:renderer-smoke"],
                    },
                })
                const job = store.createJob({
                    sessionId: session.id,
                    type: "operator-session",
                    objective: "Optimize frozen Run optimization-renderer-smoke. Wait for a Candidate.",
                    budget: operatorBudget(),
                    checkpoint: {optimizationRunId: input.runId},
                })
                store.transitionJob(job.id, "running")
                fixtureIds.optimizationJobId = job.id
                fixtureIds.optimizationSessionId = session.id
                return {
                    changed: changedPayload(job.id),
                    job: publicOperatorJob(store.getJob(job.id)),
                    session: publicOperatorSession(store.getSession(session.id)),
                }
            }
            case "create-optimization-approval": {
                const job = store.getJob(fixtureIds.optimizationJobId)
                const existing = store.listApprovals(job.id).find((approval) => (
                    approval.action === "optimization.release-install"
                ))
                if (existing) return {
                    changed: changedPayload(job.id),
                    approval: publicOperatorApproval(existing),
                }
                const action = "optimization.release-install"
                const risk = "Release the selected immutable Optimization Candidate and install it on every frozen target Runtime"
                const scope = {runId: input.runId, epoch: 2, kind: "release-install"}
                const proposedMutation = {kind: "release-install", runId: input.runId}
                const idempotencyKey = `${input.runId}:release-install:2`
                const params = {action, risk, scope, proposedMutation}
                let step = store.createStep(job.id, {
                    method: "optimization.approval",
                    params,
                    reservation: {},
                    idempotencyKey,
                })
                step = store.transitionStep(step.id, "waiting_approval")
                store.transitionJob(job.id, "waiting_approval")
                const approval = store.createApproval(job.id, {
                    stepId: step.id,
                    action,
                    scope,
                    proposedMutation: {
                        method: "optimization.approval",
                        params,
                        reservation: {},
                        idempotencyKey,
                    },
                    risk,
                    expiresAt: "2099-01-01T00:00:00.000Z",
                })
                fixtureIds.optimizationApprovalId = approval.id
                return {
                    changed: changedPayload(job.id),
                    approval: publicOperatorApproval(approval),
                }
            }
            case "metrics":
                return {summaryPageCalls, approvalCalls, stopCalls, operatorCreateInput, fixtureIds}
            default:
                throw new Error(`Unknown smoke Operator method: ${method}`)
            }
        },
        close() {
            store.close()
        },
    }
}

async function waitFor(window, expression, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return
        } catch (error) {
            throw new Error(`Renderer wait expression failed: ${expression}`, {cause: error})
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for: ${expression}`)
}

async function inspect(window, expression) {
    try {
        return await window.webContents.executeJavaScript(`(${expression})`)
    } catch (error) {
        throw new Error(`Renderer expression failed: ${expression}`, {cause: error})
    }
}

async function run() {
    await app.whenReady()
    operatorFixture = createOperatorFixture()
    await operatorFixture.ready
    ipcMain.handle("smoke:parse-control-input", (_event, {method, value}) =>
        parseControlInput(method, value))
    ipcMain.handle("smoke:parse-control-output", (_event, {method, value}) =>
        parseControlOutput(method, value))
    ipcMain.handle("smoke:operator", async (_event, {method, input}) => {
        try {
            return {ok: true, value: await operatorFixture.invoke(method, input)}
        } catch (error) {
            return {
                ok: false,
                error: {message: error.message, code: error.code ?? null},
            }
        }
    })
    const rendererErrors = []
    const window = new BrowserWindow({
        width: Number(process.env.ROLLING_SKILL_RENDERER_SMOKE_WIDTH) || 1_180,
        height: Number(process.env.ROLLING_SKILL_RENDERER_SMOKE_HEIGHT) || 800,
        show: false,
        webPreferences: {
            preload: join(__dirname, "renderer-smoke-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: `temp:rolling-skill-renderer-smoke-${Date.now()}`,
        },
    })
    window.webContents.on("console-message", (_event, details, legacyMessage) => {
        const level = typeof details === "object" ? details.level : details
        const message = typeof details === "object" ? details.message : String(legacyMessage ?? "")
        if (level === "error" || level === 3) rendererErrors.push(message)
    })
    await window.loadFile(join(__dirname, "..", "renderer", "index.html"))
    try {
        await waitFor(
            window,
            'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation") && document.querySelector(".message-body h2")',
        )
    } catch (error) {
        const diagnostic = await inspect(window, `(async () => {
            const bootstrapSnapshot = await window.rollingSkill.bootstrap()
            const threadSnapshot = await window.rollingSkill.listThreads(false)
            return ({
            activeThread: document.querySelector("[data-thread-id].active")?.dataset.threadId ?? null,
            loading: Boolean(document.querySelector(".loading-conversation")),
            heading: document.querySelector(".message-body h2")?.textContent ?? null,
            conversation: document.querySelector("#conversation")?.textContent ?? null,
            error: document.querySelector("#error-message")?.textContent ?? null,
            threadRows: [...document.querySelectorAll("[data-thread-id]")].map((node) => node.dataset.threadId),
            operatorJobs: [...document.querySelectorAll("[data-operator-job-id]")].map((node) => node.dataset.operatorJobId),
            operatorMetrics: await window.rollingSkill.smokeOperatorMetrics(),
            rendererBootstrap: typeof bootstrap,
            rendererState: typeof state,
            stateSnapshot: {
                loadingThreads: state.loadingThreads,
                runtimeStatus: state.runtime?.status ?? null,
                workspaceRoot: state.workspaceRoot,
                datasets: state.datasets.length,
                managedSkills: state.managedSkills.skills.length,
                operatorWorkbench: typeof operatorWorkbench,
            },
            bootstrapRuntime: bootstrapSnapshot.runtime?.status ?? null,
            availableThreads: threadSnapshot.data?.map((thread) => thread.id) ?? [],
        })})()`)
        throw new Error(`Initial renderer conversation did not load: ${JSON.stringify({diagnostic, rendererErrors})}`, {cause: error})
    }
    const controlRuntimes = await inspect(window, "window.rollingSkill.listRuntimes()")
    if (
        controlRuntimes.length !== 1 ||
        controlRuntimes[0]?.runtimeId !== "codex:renderer-smoke"
    ) {
        throw new Error(`Control Runtime catalog shape changed: ${JSON.stringify(controlRuntimes)}`)
    }

    const markdownAndActivity = await inspect(
        window,
        `(() => ({
            heading: document.querySelector(".message-body h2")?.textContent,
            tableCells: document.querySelectorAll(".message-body table td").length,
            code: document.querySelector(".message-body pre code")?.textContent,
            activity: [...document.querySelectorAll(".activity-card")].map((entry) => entry.textContent),
            scrollBehavior: getComputedStyle(document.querySelector("#conversation-scroll")).scrollBehavior,
            anchors: [...document.querySelectorAll(".message-body a")].map((entry) => ({
                external: entry.dataset.externalUrl || null,
                local: entry.dataset.localPath || null,
            })),
            images: document.querySelectorAll(".message-body img").length,
            scripts: document.querySelectorAll(".message-body script").length,
            codeLinks: document.querySelectorAll(".message-body code a").length,
            text: document.querySelector(".message.assistant .message-body")?.textContent,
            rightAligned: getComputedStyle(document.querySelector(".message-body td[data-align=right]")).textAlign,
        }))()`,
    )
    if (markdownAndActivity.heading !== "Alpha result") throw new Error("Markdown heading missing")
    if (markdownAndActivity.tableCells !== 2) throw new Error("Markdown table missing")
    if (markdownAndActivity.code !== "echo A/B") throw new Error("Markdown code block missing")
    if (markdownAndActivity.images || markdownAndActivity.scripts || markdownAndActivity.codeLinks) {
        throw new Error("Unsafe or code-contained Markdown created active DOM")
    }
    if (!markdownAndActivity.anchors.some((entry) => entry.external === "https://example.com/docs")) {
        throw new Error("Safe external Markdown link missing")
    }
    if (!markdownAndActivity.anchors.some((entry) => entry.local === "/tmp/rolling-skill-renderer-smoke/report.md")) {
        throw new Error("Safe local Markdown link missing")
    }
    if (markdownAndActivity.anchors.length !== 2) throw new Error("Rejected links became active")
    if (!markdownAndActivity.text.includes("[route](/v1/responses)")) {
        throw new Error("Rejected route link did not remain text")
    }
    if (markdownAndActivity.rightAligned !== "right") throw new Error("GFM table alignment missing")
    for (const expected of ["billing-cli cost query", "billing/query_cost", "/root/reviewer", "上下文已压缩"]) {
        if (!markdownAndActivity.activity.some((entry) => entry.includes(expected))) {
            throw new Error(`Activity card missing: ${expected}`)
        }
    }
    if (markdownAndActivity.activity.some((entry) => entry.includes("huge-noisy-shell-output"))) {
        throw new Error("Command activity exposed shell output")
    }
    if (markdownAndActivity.scrollBehavior !== "auto") {
        throw new Error(`Conversation scrolling is animated: ${markdownAndActivity.scrollBehavior}`)
    }

    const rawCaseInitial = await inspect(window, `(() => ({
        panelVisible: document.querySelector("#raw-case-panel").classList.contains("visible"),
        grouped: Boolean(document.querySelector(".raw-case-skill-group")),
        question: document.querySelector("[data-raw-case-id=raw-case-smoke] .raw-case-card-question")?.textContent,
        markedItems: document.querySelectorAll(".source-case-range.draft").length,
        markerStatus: document.querySelector(".source-case-range-status")?.textContent,
    }))()`)
    if (
        !rawCaseInitial.panelVisible ||
        !rawCaseInitial.grouped ||
        rawCaseInitial.question !== "查一下还没验证的 8 月账单问题" ||
        rawCaseInitial.markedItems !== 2 ||
        !rawCaseInitial.markerStatus?.includes("Case 草稿")
    ) {
        throw new Error(`Raw Case inbox or source marker missing: ${JSON.stringify(rawCaseInitial)}`)
    }

    await inspect(window, 'document.querySelector("[data-edit-raw-case=raw-case-smoke]").click()')
    await waitFor(
        window,
        'document.querySelector("#raw-case-question").value === "查一下还没验证的 8 月账单问题"',
    )
    await inspect(window, `(() => {
        document.querySelector("#raw-case-question").value = "查一下已编辑的 8 月账单问题"
        document.querySelector("#raw-case-note").value = "Renderer smoke edited"
        document.querySelector("#raw-case-form").requestSubmit()
    })()`)
    await waitFor(
        window,
        'document.querySelector("[data-raw-case-id=raw-case-smoke] .raw-case-card-question")?.textContent === "查一下已编辑的 8 月账单问题"',
    )
    await waitFor(
        window,
        'document.querySelector("#cancel-raw-case-edit").classList.contains("hidden") && document.querySelector("#raw-case-question").value === ""',
    )
    const rawCaseUpdate = await inspect(window, `window.rollingSkill.smokeControlInvocations()
        .filter((entry) => entry.method === "raw_cases.update").at(-1)`)
    if (
        rawCaseUpdate?.params?.id !== "raw-case-smoke" ||
        rawCaseUpdate?.params?.changes?.question !== "查一下已编辑的 8 月账单问题"
    ) {
        throw new Error(`Raw Case edit bypassed control: ${JSON.stringify(rawCaseUpdate)}`)
    }

    await inspect(window, `(() => {
        document.querySelector("#raw-case-skill").value = "billing-cost-management"
        document.querySelector("#raw-case-question").value = "尚未发送的 Raw Case 表单草稿"
        document.querySelector("#raw-case-note").value = "不要被重绘清空"
        window.rollingSkill.smokeEmitNotification({
            method: "thread/name/updated",
            params: {threadId: "thread-a", name: "Thread A"},
        })
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const rawDraft = await inspect(window, `(() => ({
        question: document.querySelector("#raw-case-question").value,
        note: document.querySelector("#raw-case-note").value,
    }))()`)
    if (rawDraft.question !== "尚未发送的 Raw Case 表单草稿" || rawDraft.note !== "不要被重绘清空") {
        throw new Error(`Raw Case form draft was cleared by render: ${JSON.stringify(rawDraft)}`)
    }
    await inspect(window, 'document.querySelector("#raw-case-form").requestSubmit()')
    await waitFor(window, 'Boolean(document.querySelector("[data-raw-case-id^=raw-case-added-]"))')
    await inspect(window, 'document.querySelector("[data-raw-case-id^=raw-case-added-] [data-delete-raw-case]").click()')
    await waitFor(window, '!document.querySelector("[data-raw-case-id^=raw-case-added-]")')

    await inspect(window, `window.rollingSkill.smokeEmitRuntimeQuestion({
        requestId: "question-thread-b",
        threadId: "thread-b",
        questions: [{id: "hidden", question: "Only Thread B should display this question."}],
    })`)
    if (await inspect(window, 'Boolean(document.querySelector("[data-runtime-question-id=question-thread-b]"))')) {
        throw new Error("A runtime question leaked into a different conversation")
    }
    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-runtime-question-id=question-thread-b]")')
    await inspect(window, 'document.querySelector("[data-runtime-question-id=question-thread-b] [data-cancel-runtime-question]").click()')
    await waitFor(window, '!document.querySelector("[data-runtime-question-id=question-thread-b]")')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')

    await inspect(window, `window.rollingSkill.smokeEmitRuntimeQuestion({
        requestId: "question-thread-a",
        threadId: "thread-a",
        questions: [
            {
                id: "region",
                header: "Region",
                question: "Choose one region.",
                options: [{label: "APAC"}, {label: "Europe"}],
            },
            {
                id: "models",
                question: "Choose models.",
                multiSelect: true,
                options: [{label: "GLM"}, {label: "DeepSeek"}],
            },
            {id: "note", question: "Add a note."},
        ],
    })`)
    await waitFor(window, 'document.querySelector("[data-runtime-question-id=question-thread-a]")')
    await inspect(window, `(() => {
        const form = document.querySelector("[data-runtime-question-id=question-thread-a]")
        form.querySelector('[data-runtime-question-option="0"][value="APAC"]').click()
        for (const input of form.querySelectorAll('[data-runtime-question-option="1"]')) input.click()
        const custom = form.querySelector('[data-runtime-question-custom="2"]')
        custom.value = "Use the latest bill."
        form.requestSubmit()
    })()`)
    await waitFor(window, '!document.querySelector("[data-runtime-question-id=question-thread-a]")')
    const runtimeQuestionResponse = await inspect(window, 'window.rollingSkill.smokeLastRuntimeQuestionResponse()')
    if (
        runtimeQuestionResponse?.requestId !== "question-thread-a" ||
        runtimeQuestionResponse.cancelled ||
        JSON.stringify(runtimeQuestionResponse.answers) !== JSON.stringify([
            {id: "region", selected: ["APAC"]},
            {id: "models", selected: ["GLM", "DeepSeek"]},
            {id: "note", selected: [], custom: "Use the latest bill."},
        ])
    ) {
        throw new Error(`Runtime question answers were not preserved: ${JSON.stringify(runtimeQuestionResponse)}`)
    }

    await inspect(window, `(() => {
        const composer = document.querySelector("#composer-input")
        composer.value = "保留在当前对话里的未发送草稿"
        composer.dispatchEvent(new Event("input", {bubbles: true}))
        document.querySelector("#conversation-scroll").scrollTop = 240
        document.querySelector("[data-surface=skills]").click()
    })()`)
    await waitFor(window, 'document.querySelector("[data-managed-skill-id=managed-skill-smoke]")')
    await waitFor(
        window,
        'document.querySelector(".managed-skill-manifest")?.textContent.includes("Smoke managed Skill")',
    )
    const managedSkillSurface = await inspect(window, `(() => ({
        visible: !document.querySelector("#skill-management-workbench").classList.contains("hidden"),
        repositories: document.querySelectorAll(".managed-repository-card").length,
        skills: document.querySelectorAll("[data-managed-skill-id]").length,
        skill: document.querySelector("[data-managed-skill-id=managed-skill-smoke]")?.textContent,
        manifest: document.querySelector(".managed-skill-manifest")?.textContent,
        versions: document.querySelectorAll(".managed-version-card").length,
        imports: document.querySelectorAll("[data-import-skill]").length,
        gridColumns: getComputedStyle(document.querySelector(".skill-management-grid")).gridTemplateColumns,
        panelRects: [...document.querySelector(".skill-management-grid").children].map((entry) => {
            const rect = entry.getBoundingClientRect()
            return {left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width)}
        }),
    }))()`)
    if (
        !managedSkillSurface.visible ||
        managedSkillSurface.repositories !== 2 ||
        managedSkillSurface.skills !== 2 ||
        !managedSkillSurface.skill?.includes("billing-cost-management") ||
        !managedSkillSurface.manifest?.includes("Smoke managed Skill") ||
        managedSkillSurface.versions !== 1 ||
        managedSkillSurface.imports !== 4
    ) {
        throw new Error(`Managed Skill workbench is incomplete: ${JSON.stringify(managedSkillSurface)}`)
    }
    const pagedManagedOverview = await inspect(window, "window.rollingSkill.listManagedSkills()")
    if (
        pagedManagedOverview.repositories.length !== 2 ||
        pagedManagedOverview.skills.length !== 2 ||
        pagedManagedOverview.versions.length !== 2
    ) {
        throw new Error(
            `Managed Skill control pages were not aggregated: ${JSON.stringify(pagedManagedOverview)}`,
        )
    }
    const managedPaginationCalls = await inspect(window, `(() => {
        const calls = window.rollingSkill.smokeControlInvocations()
        return Object.fromEntries([
            "skill_repositories.list",
            "skills.list",
            "skill_versions.list",
        ].map((method) => [method, calls.filter((entry) =>
            entry.method === method &&
            (method !== "skill_versions.list" || entry.params.skillId === null)
        ).slice(-2)]))
    })()`)
    for (const [method, pages] of Object.entries(managedPaginationCalls)) {
        if (
            pages.length !== 2 ||
            pages[0].params.cursor !== null ||
            typeof pages[0].nextCursor !== "string" ||
            pages[1].params.cursor !== pages[0].nextCursor ||
            pages[1].nextCursor !== null
        ) {
            throw new Error(
                `Managed Skill ${method} nextCursor was not followed: ${JSON.stringify(pages)}`,
            )
        }
    }
    await inspect(window, 'document.querySelector("[data-managed-skill-id=managed-skill-smoke-two]").click()')
    await waitFor(window, 'document.querySelector(".managed-skill-manifest")?.textContent.includes("Second managed Skill")')
    await inspect(window, 'document.querySelector("[data-managed-skill-id=managed-skill-smoke]").click()')
    await waitFor(window, 'document.querySelector(".managed-skill-manifest")?.textContent.includes("Smoke managed Skill")')
    await inspect(window, 'document.querySelector("[data-import-skill=git-url]").click()')
    await waitFor(window, 'document.querySelector("#managed-git-url-dialog").open')
    await inspect(window, 'document.querySelector("#cancel-managed-git-url").click()')
    await waitFor(window, '!document.querySelector("#managed-git-url-dialog").open')
    await inspect(window, 'document.querySelector("[data-create-managed-candidate=managed-skill-smoke]").click()')
    await waitFor(window, 'document.querySelector("#managed-candidate-dialog").open')
    await inspect(window, `(() => {
        document.querySelector("#managed-candidate-message").value = "Renderer smoke candidate"
        document.querySelector("#managed-candidate-form").requestSubmit()
    })()`)
    await waitFor(window, 'document.querySelector("[data-release-managed-version=managed-version-created-smoke]")')
    await inspect(window, 'document.querySelector("[data-release-managed-version=managed-version-created-smoke]").click()')
    await waitFor(window, 'document.querySelector("#managed-release-dialog").open')
    await inspect(window, `(() => {
        document.querySelector("#managed-release-label").value = "v1.0.0"
        document.querySelector("#managed-release-form").requestSubmit()
    })()`)
    await waitFor(window, 'document.querySelector("[data-deprecate-managed-version=managed-version-created-smoke]")')
    await inspect(window, 'document.querySelector("[data-managed-skill-side-view=installations]").click()')
    await waitFor(window, 'document.querySelector(\'[data-managed-install-runtime-id="codex:renderer-smoke"]\')')
    await waitFor(
        window,
        'document.querySelector("#managed-install-version").value === "managed-version-created-smoke" && !document.querySelector("#start-managed-skill-installations").disabled',
    )
    const managedSkillInstallations = await inspect(window, `(() => ({
        visible: !document.querySelector("#managed-skill-installations").classList.contains("hidden"),
        version: document.querySelector("#managed-install-version").value,
        runtimes: document.querySelectorAll(".managed-install-runtime-row").length,
        model: document.querySelector("[data-managed-install-runtime-model]")?.value,
        permissions: document.querySelector("[data-managed-install-runtime-permission]")?.options.length,
        startEnabled: !document.querySelector("#start-managed-skill-installations").disabled,
    }))()`)
    if (
        !managedSkillInstallations.visible ||
        managedSkillInstallations.version !== "managed-version-created-smoke" ||
        managedSkillInstallations.runtimes !== 2 ||
        managedSkillInstallations.permissions < 3 ||
        !managedSkillInstallations.startEnabled
    ) {
        throw new Error(`Managed Skill Runtime installs are incomplete: ${JSON.stringify(managedSkillInstallations)}`)
    }
    await waitFor(window, 'document.querySelector("#managed-install-session .managed-install-steps")')
    const managedInstallationDetail = await inspect(window, `(() => {
        const details = document.querySelector("#managed-install-session .managed-install-diagnostics")
        return {
            title: document.querySelector("#managed-install-session .managed-skill-panel-head span")?.textContent,
            summary: document.querySelector("#managed-install-session .managed-install-result")?.textContent,
            steps: document.querySelectorAll("#managed-install-session .managed-install-step").length,
            error: document.querySelector("#managed-install-session .managed-install-error-summary")?.textContent,
            diagnosticsClosed: details?.open === false,
            composerPresent: Boolean(document.querySelector("#managed-install-session textarea")),
            retryVisible: !document.querySelector("#retry-managed-skill-installation")?.classList.contains("hidden"),
            recheckVisible: !document.querySelector("#inspect-managed-skill-installation")?.classList.contains("hidden"),
        }
    })()`)
    if (
        managedInstallationDetail.title !== "安装详情" ||
        !managedInstallationDetail.summary.includes("Codex") ||
        !managedInstallationDetail.summary.includes("v1.0.0") ||
        managedInstallationDetail.steps !== 4 ||
        managedInstallationDetail.error !== "目标目录已有不同内容，本次只读检查未进行覆盖。" ||
        !managedInstallationDetail.diagnosticsClosed ||
        managedInstallationDetail.composerPresent ||
        !managedInstallationDetail.retryVisible ||
        !managedInstallationDetail.recheckVisible
    ) {
        throw new Error(`Managed installation detail is incomplete: ${JSON.stringify(managedInstallationDetail)}`)
    }
    await inspect(window, 'document.querySelector("[data-surface=chat]").click()')
    await waitFor(window, '!document.querySelector("#conversation-scroll").classList.contains("hidden")')
    const restoredChatDraft = await inspect(window, 'document.querySelector("#composer-input").value')
    if (restoredChatDraft !== "保留在当前对话里的未发送草稿") {
        throw new Error(`Managed Skill surface cleared the Chat draft: ${restoredChatDraft}`)
    }

    await inspect(window, 'document.querySelector("[data-surface=evaluation]").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-case-id=case-smoke] strong")')
    const caseCard = await inspect(window, `(() => ({
        title: document.querySelector("[data-evaluation-case-id=case-smoke] strong")?.textContent,
        text: document.querySelector("[data-evaluation-case-id=case-smoke]")?.textContent,
    }))()`)
    if (caseCard.title !== "查一下7月份账单，各业务混元3多少成本？") {
        throw new Error(`Case card did not use the first source question: ${caseCard.title}`)
    }
    if (caseCard.title.includes("用户后来对这个 Case 的评价")) {
        throw new Error("Case card used the later user review as its title")
    }
    await inspect(window, 'document.querySelector("[data-calibrate-evaluation-case=case-smoke]").click()')
    await waitFor(
        window,
        'document.querySelector("#curation-drawer").classList.contains("visible") && document.querySelector("[data-curation-id=curation-calibration-smoke].active")',
    )
    const calibrationDrawer = await inspect(window, `(() => ({
        text: document.querySelector("#curation-drawer")?.textContent,
        input: window.rollingSkill.smokeLastCalibrationInput(),
    }))()`)
    if (
        calibrationDrawer.input?.datasetId !== "dataset-smoke" ||
        calibrationDrawer.input?.caseId !== "case-smoke"
    ) {
        throw new Error("Case calibration did not inherit the selected dataset and Case")
    }
    if (
        !calibrationDrawer.text.includes("Case 校准") ||
        !calibrationDrawer.text.includes("当前已保存总结") ||
        !calibrationDrawer.text.includes("Verified case summary")
    ) {
        throw new Error(`Case calibration drawer is missing frozen context: ${calibrationDrawer.text}`)
    }
    await inspect(window, 'document.querySelector("[data-discard-curation=curation-calibration-smoke]").click()')
    await waitFor(window, 'document.querySelector("#discard-curation-dialog").open')
    await inspect(window, 'document.querySelector("#confirm-discard").click()')
    await waitFor(window, '!document.querySelector("[data-curation-id=curation-calibration-smoke]")')
    await inspect(window, 'document.querySelector("#close-curations").click()')
    await inspect(window, 'window.rollingSkill.smokeResetCalibrationCases()')

    await waitFor(window, 'document.querySelector("[data-start-calibration-batch]")')
    await inspect(window, 'document.querySelector("[data-start-calibration-batch]").click()')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().created.join(",") === "case-smoke"`)
    await waitFor(window, 'document.querySelector("#curation-drawer").classList.contains("visible") && document.querySelector("[data-stop-calibration-batch]")')
    await inspect(window, 'window.rollingSkill.smokeEmitCalibrationReady("case-smoke")')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().archived.join(",") === "case-smoke"`)
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().created.join(",") === "case-smoke,case-smoke-2"`)
    await inspect(window, 'window.rollingSkill.smokeEmitCalibrationReady("case-smoke-2")')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().archived.join(",") === "case-smoke,case-smoke-2"`)
    await waitFor(window, '!document.querySelector(".case-calibration")')
    const automaticCalibration = await inspect(window, `window.rollingSkill.smokeCalibrationMetrics()`)
    if (automaticCalibration.created.join(",") !== "case-smoke,case-smoke-2" ||
        automaticCalibration.archived.join(",") !== "case-smoke,case-smoke-2") {
        throw new Error(`Automatic calibration was not serialized and saved: ${JSON.stringify(automaticCalibration)}`)
    }

    await waitFor(window, '!document.querySelector("#start-evaluation").disabled')
    await inspect(window, 'document.querySelector("#start-evaluation").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-run-id^=run-smoke-started-] .run-status.running")')
    const selectedEvaluationStart = await inspect(window, `window.rollingSkill.smokeControlInvocations()
        .filter((entry) => entry.method === "evaluations.start").at(-1)`)
    if (
        selectedEvaluationStart?.params?.selectionMode !== "selected" ||
        selectedEvaluationStart?.params?.caseIds?.join(",") !== "case-smoke"
    ) {
        throw new Error(`Selected evaluation did not use control: ${JSON.stringify(selectedEvaluationStart)}`)
    }
    await inspect(window, 'document.querySelector("[data-cancel-evaluation-run^=run-smoke-started-]").click()')
    await waitFor(window, 'document.querySelector("#cancel-evaluation-run-dialog").open')
    await inspect(window, 'document.querySelector("#confirm-cancel-evaluation-run").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-run-id^=run-smoke-started-] .run-status.cancelled")')
    const cancelledEvaluation = await inspect(window, `window.rollingSkill.smokeControlInvocations()
        .filter((entry) => entry.method === "evaluations.cancel").at(-1)`)
    if (!cancelledEvaluation?.params?.runId?.startsWith("run-smoke-started-")) {
        throw new Error(`Running evaluation cancel bypassed control: ${JSON.stringify(cancelledEvaluation)}`)
    }

    await inspect(window, 'document.querySelector("[data-evaluation-view=cases]").click()')
    await waitFor(window, '!document.querySelector("#start-dataset-evaluation").disabled')
    await inspect(window, 'document.querySelector("#start-dataset-evaluation").click()')
    await waitFor(window, 'document.querySelectorAll("[data-evaluation-run-id^=run-smoke-started-]").length === 2')
    const datasetEvaluationStart = await inspect(window, `window.rollingSkill.smokeControlInvocations()
        .filter((entry) => entry.method === "evaluations.start").at(-1)`)
    if (
        datasetEvaluationStart?.params?.selectionMode !== "dataset" ||
        datasetEvaluationStart?.params?.caseIds?.length !== 0
    ) {
        throw new Error(`Dataset evaluation did not use control: ${JSON.stringify(datasetEvaluationStart)}`)
    }

    await inspect(window, 'window.rollingSkill.smokeResetCalibrationCases()')
    await inspect(window, 'document.querySelector("#refresh-evaluation").click()')
    await waitFor(window, 'document.querySelector("[data-start-calibration-batch]")')
    await inspect(window, 'document.querySelector("[data-start-calibration-batch]").click()')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().created.join(",") === "case-smoke"`)
    await inspect(window, 'document.querySelector("#curation-detail [data-stop-calibration-batch]").click()')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().discarded.join(",") === "case-smoke"`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const stoppedCalibration = await inspect(window, `window.rollingSkill.smokeCalibrationMetrics()`)
    if (stoppedCalibration.created.includes("case-smoke-2")) {
        throw new Error(`Stopping calibration started another Case: ${JSON.stringify(stoppedCalibration)}`)
    }
    await inspect(window, 'document.querySelector("#close-curations").click()')
    const datasetBinding = await inspect(window, `(() => ({
        operationSkill: Boolean(document.querySelector("#evaluation-skill")),
        status: document.querySelector("#evaluation-dataset-skill-status")?.textContent,
        createSkill: document.querySelector("#evaluation-new-dataset-skill")?.value,
    }))()`)
    if (datasetBinding.operationSkill || !datasetBinding.status.includes("billing-cost-management")) {
        throw new Error("Evaluation did not inherit and display the dataset Skill binding")
    }
    if (!datasetBinding.createSkill) {
        throw new Error("Dataset creation did not require an enabled Skill")
    }
    await inspect(window, 'document.querySelector("#export-evaluation-dataset").click()')
    await waitFor(window, 'document.querySelector("#export-dataset-dialog").open')
    const exportDialog = await inspect(window, `(() => ({
        caseScopes: [...document.querySelectorAll("#export-case-scope option")].map((option) => option.value),
        outputModes: [...document.querySelectorAll("#export-output-mode option")].map((option) => option.value),
        help: document.querySelector("#export-dataset-dialog .field-help")?.textContent,
    }))()`)
    if (!exportDialog.caseScopes.includes("goodcase") || !exportDialog.outputModes.includes("original")) {
        throw new Error("Dataset export choices are missing")
    }
    if (!exportDialog.help.includes("Assistant") || !exportDialog.help.includes("工具输出")) {
        throw new Error(`Original-output export explanation is unclear: ${exportDialog.help}`)
    }
    await inspect(window, 'document.querySelector("#close-export-dataset-dialog").click()')
    const rubricStatus = await inspect(
        window,
        'document.querySelector("#evaluation-dataset-rubric-status")?.textContent',
    )
    if (!rubricStatus.includes("账单结果质量标准") || !rubricStatus.includes("评分标准草稿已就绪")) {
        throw new Error(`Reviewable dataset rubric draft status missing: ${rubricStatus}`)
    }
    await inspect(window, 'document.querySelector("#manage-dataset-rubric").click()')
    await waitFor(
        window,
        'document.querySelector("#rubric-drawer").classList.contains("visible") && document.querySelector("[data-publish-rubric=rubric-session-smoke]")',
    )
    const rubricDrawer = await inspect(window, `(() => ({
        text: document.querySelector("#rubric-drawer")?.textContent,
        effort: document.querySelector("[data-rubric-effort=rubric-session-smoke]")?.value,
        modelOptions: document.querySelectorAll("[data-rubric-model=rubric-session-smoke] option").length,
    }))()`)
    for (const expected of ["v1", "账单结果质量标准", "R1", "RF1", "把跨业务线归因写得更清楚。", "发布评分标准"]) {
        if (!rubricDrawer.text.includes(expected)) {
            throw new Error(`Rubric drawer missing: ${expected}`)
        }
    }
    if (rubricDrawer.effort !== "high" || !rubricDrawer.modelOptions) {
        throw new Error("Rubric Agent model or reasoning controls are missing")
    }
    await inspect(window, `window.rollingSkill.smokeEmitRubricChanged({
        status: "running",
        rubricAgent: {currentTurnId: "rubric-turn-running"},
    })`)
    await waitFor(window, 'document.querySelector("[data-rubric-activity=rubric-session-smoke]")')
    await inspect(window, 'window.__rubricConversationBeforeActivity = document.querySelector("#rubric-detail .curator-conversation")')
    await inspect(window, `window.rollingSkill.smokeEmitRubricActivity({
        sessionId: "rubric-session-smoke",
        stage: "command",
        summary: "sed -n 1,400p billing-cost-management/SKILL.md",
        startedAt: Date.now() - 1000,
        lastActivityAt: Date.now(),
        terminal: false,
    })`)
    await waitFor(window, 'document.querySelector("[data-rubric-activity=rubric-session-smoke]")?.textContent.includes("sed -n 1,400p")')
    const rubricActivityPatched = await inspect(
        window,
        'window.__rubricConversationBeforeActivity === document.querySelector("#rubric-detail .curator-conversation")',
    )
    if (!rubricActivityPatched) {
        throw new Error("Rubric activity rebuilt the complete drawer instead of patching its status card")
    }
    await inspect(window, `window.rollingSkill.smokeEmitRubricActivity({
        sessionId: "rubric-session-smoke",
        terminal: true,
    })`)
    await inspect(window, `window.rollingSkill.smokeEmitRubricChanged({
        status: "needs_review",
        rubricAgent: {currentTurnId: null},
    })`)
    await waitFor(window, 'document.querySelector("[data-publish-rubric=rubric-session-smoke]")')
    await inspect(window, 'document.querySelector("#close-rubric-drawer").click()')
    await waitFor(window, '!document.querySelector("#rubric-drawer").classList.contains("visible")')
    await inspect(window, 'document.querySelector("[data-evaluation-view=runs]").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-run-id=run-smoke]")')
    await inspect(window, 'document.querySelector("[data-evaluation-run-id=run-smoke]").click()')
    await waitFor(window, 'document.querySelector("#evaluation-run-detail")?.textContent.includes("1:05")')
    const evaluationDuration = await inspect(
        window,
        'document.querySelector("#evaluation-run-detail")?.textContent',
    )
    if (!evaluationDuration.includes("1:05") || evaluationDuration.includes("65000 ms")) {
        throw new Error(`Evaluation duration did not use minute-second format: ${evaluationDuration}`)
    }
    const initialEvaluationRuntime = await inspect(window, `(() => ({
        tabs: [...document.querySelectorAll("[data-evaluation-runtime-view]")].map((entry) => ({
            id: entry.dataset.evaluationRuntimeView,
            active: entry.classList.contains("active"),
            selected: entry.getAttribute("aria-selected"),
        })),
        ids: [...document.querySelectorAll("[data-evaluation-runtime-group]")].map(
            (entry) => entry.dataset.evaluationRuntimeGroup,
        ),
        codexCases: document.querySelectorAll(
            '[data-evaluation-runtime-group="codex:renderer-smoke"] .evaluation-result-card',
        ).length,
        codexText: document.querySelector(
            '[data-evaluation-runtime-group="codex:renderer-smoke"]',
        )?.textContent,
    }))()`)
    if (
        initialEvaluationRuntime.tabs.map((entry) => entry.id).join(",") !==
            "codex:renderer-smoke,codebuddy:renderer-smoke" ||
        initialEvaluationRuntime.tabs[0]?.active !== true ||
        initialEvaluationRuntime.tabs[0]?.selected !== "true" ||
        initialEvaluationRuntime.ids.join(",") !== "codex:renderer-smoke" ||
        initialEvaluationRuntime.codexCases !== 2
    ) {
        throw new Error(
            `Evaluation Runtime tabs did not default to Codex: ${JSON.stringify(initialEvaluationRuntime)}`,
        )
    }
    if (
        !initialEvaluationRuntime.codexText.includes("84/100") ||
        initialEvaluationRuntime.codexText.includes("Smoke evaluation answer") ||
        initialEvaluationRuntime.codexText.includes("trace:L1") ||
        initialEvaluationRuntime.codexText.includes("A · 通用") ||
        initialEvaluationRuntime.codexText.includes("B · 灵活")
    ) {
        throw new Error(
            `Safe evaluation score summary was not rendered: ${initialEvaluationRuntime.codexText}`,
        )
    }

    await inspect(window, 'document.querySelector("[data-evaluation-runtime-view=\\"codebuddy:renderer-smoke\\"]").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-runtime-group=\\"codebuddy:renderer-smoke\\"]")')
    const codeBuddyEvaluationRuntime = await inspect(window, `(() => ({
        selected: document.querySelector(
            '[data-evaluation-runtime-view="codebuddy:renderer-smoke"]',
        )?.getAttribute("aria-selected"),
        panelRole: document.querySelector(
            '[data-evaluation-runtime-group="codebuddy:renderer-smoke"]',
        )?.getAttribute("role"),
        ids: [...document.querySelectorAll("[data-evaluation-runtime-group]")].map(
            (entry) => entry.dataset.evaluationRuntimeGroup,
        ),
        cases: document.querySelectorAll(
            '[data-evaluation-runtime-group="codebuddy:renderer-smoke"] .evaluation-result-card',
        ).length,
        text: document.querySelector(
            '[data-evaluation-runtime-group="codebuddy:renderer-smoke"]',
        )?.textContent,
    }))()`)
    if (
        codeBuddyEvaluationRuntime.ids.join(",") !== "codebuddy:renderer-smoke" ||
        codeBuddyEvaluationRuntime.selected !== "true" ||
        codeBuddyEvaluationRuntime.panelRole !== "tabpanel" ||
        codeBuddyEvaluationRuntime.cases !== 2 ||
        !codeBuddyEvaluationRuntime.text.includes("66/100") ||
        !codeBuddyEvaluationRuntime.text.includes("旧版评分记录") ||
        codeBuddyEvaluationRuntime.text.includes("Smoke CodeBuddy evaluation answer") ||
        codeBuddyEvaluationRuntime.text.includes("Legacy Skill evidence remains inspectable.") ||
        codeBuddyEvaluationRuntime.text.includes("Legacy workflow evidence remains inspectable.") ||
        codeBuddyEvaluationRuntime.text.includes("A · 通用") ||
        codeBuddyEvaluationRuntime.text.includes("B · 灵活")
    ) {
        throw new Error(
            `Legacy CodeBuddy grading was not shown neutrally: ${JSON.stringify(codeBuddyEvaluationRuntime)}`,
        )
    }
    await inspect(window, `(() => {
        const tab = document.querySelector('[data-evaluation-runtime-view="codebuddy:renderer-smoke"]')
        tab.focus()
        tab.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}))
    })()`)
    await waitFor(window, 'document.querySelector("[data-evaluation-runtime-view=\\"codex:renderer-smoke\\"]")?.getAttribute("aria-selected") === "true"')
    await inspect(window, 'document.querySelector("[data-surface=chat]").click()')

    await inspect(window, 'document.querySelector("#topbar-curations").click()')
    await waitFor(window, 'document.querySelector("#curation-drawer").classList.contains("visible")')
    const rawCaseAndCurationLayout = await inspect(window, `(() => {
        const rawCases = document.querySelector("#raw-case-panel")
        const curation = document.querySelector("#curation-drawer")
        const rawCasesVisible = rawCases.classList.contains("visible")
        return {
            viewportWidth: window.innerWidth,
            rawCasesVisible,
            overlap: rawCasesVisible
                ? Math.max(0, curation.getBoundingClientRect().right - rawCases.getBoundingClientRect().left)
                : null,
        }
    })()`)
    if (rawCaseAndCurationLayout.viewportWidth > 1120) {
        if (!rawCaseAndCurationLayout.rawCasesVisible || rawCaseAndCurationLayout.overlap > 1) {
            throw new Error(
                `Case drafts covered the persistent Raw Case rail: ${JSON.stringify(rawCaseAndCurationLayout)}`,
            )
        }
    } else if (rawCaseAndCurationLayout.rawCasesVisible) {
        throw new Error(
            `Compact layout kept two competing drawers open: ${JSON.stringify(rawCaseAndCurationLayout)}`,
        )
    }
    await inspect(window, 'document.querySelector("[data-curation-id=curation-live-smoke]").click()')
    await waitFor(window, 'document.querySelector(".curation-live-activity")')
    await inspect(window, `window.rollingSkill.smokeEmitCurationActivity({
        sessionId: "curation-live-smoke",
        stage: "command",
        summary: "sed -n 1,632p billing-cost-management/SKILL.md",
        startedAt: Date.now() - 2_000,
        lastActivityAt: Date.now(),
        noisyOutput: "huge-noisy-curator-output",
    })`)
    await waitFor(
        window,
        'document.querySelector(".curation-live-activity")?.textContent.includes("sed -n 1,632p")',
    )
    const liveCuration = await inspect(window, `(() => ({
        text: document.querySelector(".curation-live-activity")?.textContent,
        effort: document.querySelector("[data-curation-effort=curation-live-smoke] option[value='']")?.textContent,
        referenceOpen: document.querySelector(".curation-reference-card")?.open,
        referenceBeforeConversation:
            Boolean(document.querySelector(".curation-reference-card")?.compareDocumentPosition(
                document.querySelector(".curator-conversation"),
            ) & Node.DOCUMENT_POSITION_FOLLOWING),
        conversation: document.querySelector(".curator-conversation")?.textContent,
    }))()`)
    if (!liveCuration.text.includes("sed -n 1,632p billing-cost-management/SKILL.md")) {
        throw new Error("Curator live command summary missing")
    }
    if (!liveCuration.text.includes("已用时") || liveCuration.text.includes("huge-noisy-curator-output")) {
        throw new Error("Curator live activity timing or output filtering is incorrect")
    }
    if (!liveCuration.effort.includes("本轮实际：xhigh") || liveCuration.effort.includes("low")) {
        throw new Error(`Curator effective effort label is incorrect: ${liveCuration.effort}`)
    }
    if (liveCuration.referenceOpen || !liveCuration.referenceBeforeConversation) {
        throw new Error("Curator reference answer is not collapsed above the conversation")
    }
    if (liveCuration.conversation.includes("rolling-skill-curated-case/v1")) {
        throw new Error("Structured reference JSON was repeated in the Curator conversation")
    }

    const curationBurst = await inspect(window, `(async () => {
        const card = document.querySelector(".curation-live-activity")
        let mutations = 0
        const observer = new MutationObserver((records) => { mutations += records.length })
        observer.observe(card, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
        })
        for (let index = 0; index < 40; index += 1) {
            window.rollingSkill.smokeEmitCurationActivity({
                sessionId: "curation-live-smoke",
                stage: "analyzing",
                summary: \`reasoning-burst-\${index}\`,
                startedAt: Date.now() - 2_000,
                lastActivityAt: Date.now(),
            })
        }
        await new Promise((resolve) => setTimeout(resolve, 120))
        observer.disconnect()
        return {mutations, text: card.textContent}
    })()`)
    if (!curationBurst.text.includes("reasoning-burst-39")) {
        throw new Error(`Curator activity burst lost its latest state: ${JSON.stringify(curationBurst)}`)
    }
    if (curationBurst.mutations > 12) {
        throw new Error(`Curator activity burst caused excessive DOM churn: ${JSON.stringify(curationBurst)}`)
    }

    await inspect(window, `window.rollingSkill.smokeEmitCurationChanged({
        status: "needs_review",
        curator: {
            modelId: null,
            effort: null,
            effectiveModelId: "gpt-5.6-sol",
            effectiveEffort: "xhigh",
            threadId: "curator-live-thread",
            currentTurnId: null,
        },
        draft: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {
                summary: "Updated verified reference",
                requiredFacts: ["July is the billing period."],
                requiredSteps: ["Query and verify the billing source."],
                requiredOutputFormat: ["State amount and currency."],
                evidence: [{claim: "The question asks for July.", sourceItemIds: ["thread-a-user-0"]}],
            },
            grading: {
                hardRequirements: [{
                    id: "H1",
                    criterion: "Uses July billing data",
                    passCondition: "The answer explicitly identifies July.",
                    evidenceBasis: "The source question asks for July.",
                }],
                softCriteria: [{id: "S1", criterion: "Concise", weight: 1}],
                automaticFailures: ["Invents an unverified amount"],
            },
            badCaseAnalysis: null,
        },
        revisions: [{createdAt: "2026-08-12T10:00:00.000Z"}, {createdAt: "2026-08-12T10:02:00.000Z"}],
        conversation: [
            {role: "assistant", text: "Initial review note.", turnId: "curator-initial-turn"},
            {role: "user", text: "请解释一下查询计划"},
            {role: "assistant", text: "查询计划已包含语义定位和账期校验。", turnId: "curator-followup-turn"},
        ],
        error: null,
    })`)
    await waitFor(window, 'document.querySelector(".curation-reference-card.just-updated") && document.querySelector("[data-archive-curation=curation-live-smoke]")')
    const reviewedCuration = await inspect(window, `(() => ({
        reference: document.querySelector(".curation-reference-card")?.textContent,
        conversation: document.querySelector(".curator-conversation")?.textContent,
        done: document.querySelector("[data-archive-curation=curation-live-smoke]")?.textContent,
    }))()`)
    if (!reviewedCuration.reference.includes("Updated verified reference")) {
        throw new Error("Updated Curator reference answer missing")
    }
    if (!reviewedCuration.conversation.includes("查询计划已包含语义定位和账期校验。")) {
        throw new Error("Conversational Curator follow-up missing")
    }
    if (!reviewedCuration.done.includes("完成并保存")) {
        throw new Error("Valid Curator draft lost its Done and save action")
    }
    await inspect(window, `(() => {
        const input = document.querySelector("[data-curation-input=curation-live-smoke]")
        input.value = "unsent curator follow-up"
        input.dispatchEvent(new Event("input", {bubbles: true}))
        const effort = document.querySelector("[data-curation-effort=curation-live-smoke]")
        effort.value = "high"
        effort.dispatchEvent(new Event("change", {bubbles: true}))
    })()`)
    await waitFor(window, 'document.querySelector("[data-curation-effort=curation-live-smoke]")?.value === "high"')
    if ((await inspect(window, 'document.querySelector("[data-curation-input=curation-live-smoke]")?.value')) !== "unsent curator follow-up") {
        throw new Error("Changing Curator effort cleared the unsent follow-up draft")
    }
    await inspect(window, `window.rollingSkill.smokeEmitCurationChanged({
        caseType: "badcase",
        draft: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {
                summary: "Stop the identical retry and diagnose the failure.",
                requiredFacts: [],
                requiredSteps: [],
                requiredOutputFormat: ["State recovery evidence."],
                evidence: [{claim: "The retry failed.", sourceItemIds: ["thread-a-user-0"]}],
            },
            grading: {
                hardRequirements: [{
                    id: "H1",
                    criterion: "Diagnose before retrying",
                    passCondition: "A diagnosis precedes a changed recovery action.",
                    evidenceBasis: "The frozen badcase repeated unchanged.",
                }],
                softCriteria: [],
                automaticFailures: [],
            },
            badCaseAnalysis: {
                failureMode: "Repeated a failed query without diagnosis.",
                firstDivergence: "The first failed query was retried unchanged.",
                rootCauses: ["No bounded recovery decision."],
                loopSummary: "Equivalent failed calls repeated.",
                expectedRecovery: "Diagnose once and use a supported fallback.",
                deductionRules: [{
                    id: "D1",
                    errorPattern: "Undiagnosed identical retry loop",
                    matchCondition: "Two equivalent failures occur without diagnosis.",
                    deduction: 8,
                    evidenceBasis: "Frozen retry trace",
                    sourceItemIds: ["thread-a-user-0"],
                }],
            },
        },
    })`)
    await waitFor(window, 'document.querySelector(".deduction-rule")')
    const badcaseDraft = await inspect(window, `(() => ({
        heading: document.querySelector(".curation-reference-card summary")?.textContent,
        body: document.querySelector(".curation-draft")?.textContent,
    }))()`)
    if (!badcaseDraft.heading.includes("Bad Case 问题分析") ||
        !badcaseDraft.body.includes("首次偏离") ||
        !badcaseDraft.body.includes("D1 · Undiagnosed identical retry loop") ||
        !badcaseDraft.body.includes("最多扣 8 分") ||
        badcaseDraft.body.includes("参考答案")) {
        throw new Error("Badcase draft did not render as failure analysis with a recurrence deduction")
    }
    await inspect(window, 'document.querySelector("#topbar-curations").click()')

    const caseCaptureReady = await inspect(window, `(() => ({
        buttons: document.querySelectorAll("[data-save-case]").length,
        title: document.querySelector("#active-title")?.textContent,
        loading: Boolean(document.querySelector(".loading-conversation")),
        failed: Boolean(document.querySelector(".thread-load-failed")),
        error: document.querySelector("#error-banner")?.textContent,
        messages: document.querySelectorAll(".message.assistant").length,
        curationOpen: document.querySelector("#curation-drawer")?.classList.contains("visible"),
        routing: window.rollingSkill.smokeNotificationRoutingMetrics(),
    }))()`)
    if (!caseCaptureReady.buttons) {
        throw new Error(`Conversation unavailable before Case capture: ${JSON.stringify(caseCaptureReady)}`)
    }
    await inspect(window, `(() => {
        window.rollingSkill.smokeFailNextCuration()
        document.querySelector("[data-save-case]")?.click()
    })()`)
    await waitFor(window, 'document.querySelector("#save-case-dialog")?.open')
    if ((await inspect(window, 'document.querySelector("#case-issue-description")?.value')) !== "") {
        throw new Error("The optional issue description was prefilled from the source question")
    }
    await inspect(window, `(() => {
        const issue = document.querySelector("#case-issue-description")
        issue.value = "  \\n\\t"
        issue.dispatchEvent(new Event("input", {bubbles: true}))
        document.querySelector("#confirm-save-case")?.click()
    })()`)
    await waitFor(window, 'document.querySelector("#confirm-save-case")?.disabled')
    const curationCloseLocked = await inspect(window, `(() => ({
        close: document.querySelector("#close-case-dialog")?.disabled,
        cancel: document.querySelector("#cancel-save-case")?.disabled,
    }))()`)
    if (!curationCloseLocked.close || !curationCloseLocked.cancel) {
        throw new Error("Case dialog can close while curation creation is pending")
    }
    await waitFor(window, '!document.querySelector("#case-create-error")?.classList.contains("hidden")')
    const curationFailure = await inspect(window, `(() => ({
        dialogOpen: document.querySelector("#save-case-dialog")?.open,
        inlineError: document.querySelector("#case-create-error")?.textContent,
        globalErrorHidden: document.querySelector("#error-banner")?.classList.contains("hidden"),
        input: window.rollingSkill.smokeLastCurationInput(),
    }))()`)
    if (!curationFailure.dialogOpen || !curationFailure.inlineError.includes("smoke curation failure")) {
        throw new Error("Curation failure was not kept inside the open Case dialog")
    }
    if (!curationFailure.globalErrorHidden) throw new Error("Curation failure leaked to global banner")
    for (const [key, expected] of Object.entries({
        sourceThreadId: "thread-a",
        startTurnId: "thread-a-turn-0",
        startMessageOrdinal: 0,
        endTurnId: "thread-a-turn-0",
        endMessageOrdinal: 0,
    })) {
        if (curationFailure.input?.[key] !== expected) {
            throw new Error(`Curation locator mismatch for ${key}`)
        }
    }
    if ("issueDescription" in curationFailure.input || "datasetQuestion" in curationFailure.input) {
        throw new Error("A blank optional issue description was sent or confused with the evaluation question")
    }
    if ("skillPath" in curationFailure.input || "skillReference" in curationFailure.input) {
        throw new Error("Case capture sent an operation-level Skill override")
    }
    await inspect(window, 'document.querySelector("#close-case-dialog")?.click()')
    await waitFor(window, '!document.querySelector("#save-case-dialog")?.open')
    await inspect(window, 'document.querySelector("#close-curations")?.click()')
    await waitFor(window, '!document.querySelector("#curation-drawer")?.classList.contains("visible")')
    await waitFor(
        window,
        'window.rollingSkill.smokeNotificationRoutingMetrics().observationPhase === "live" && !document.querySelector(".loading-conversation")',
    )

    const alphaPosition = await inspect(
        window,
        `(() => {
            const scroll = document.querySelector("#conversation-scroll")
            scroll.scrollTop = Math.min(420, scroll.scrollHeight - scroll.clientHeight)
            scroll.dispatchEvent(new Event("scroll"))
            const input = document.querySelector("#composer-input")
            input.value = "draft-alpha"
            input.dispatchEvent(new Event("input", {bubbles: true}))
            return scroll.scrollTop
        })()`,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    await inspect(
        window,
        `(async () => {
            const item = [...document.querySelectorAll(".message.assistant")]
                .find((entry) => entry.textContent.includes("Alpha response 17"))
            window.__streamTurnBlock = item.closest(".turn-block")
            for (let index = 0; index < 20; index += 1) {
                window.rollingSkill.smokeEmitNotification({
                    method: "item/agentMessage/delta",
                    params: {
                        threadId: "thread-a",
                        turnId: "thread-a-turn-17",
                        itemId: "thread-a-agent-17",
                        delta: String(index % 10),
                    },
                })
                await new Promise((resolve) => setTimeout(resolve, 8))
            }
            return true
        })()`,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const boundedStreamingRender = await inspect(
        window,
        `(() => {
            const item = [...document.querySelectorAll(".message.assistant")]
                .find((entry) => entry.textContent.includes("Alpha response 17"))
            return {
                sameTurnBlock: item.closest(".turn-block") === window.__streamTurnBlock,
                complete: item.querySelector(".message-body").textContent
                    .endsWith("01234567890123456789"),
            }
        })()`,
    )
    if (!boundedStreamingRender.sameTurnBlock || !boundedStreamingRender.complete) {
        throw new Error(`Streaming deltas rebuilt the conversation or lost text: ${JSON.stringify(boundedStreamingRender)}`)
    }
    await inspect(
        window,
        `window.rollingSkill.smokeEmitNotification({
            method: "item/agentMessage/delta",
            params: {
                threadId: "thread-a",
                turnId: "thread-a-turn-17",
                itemId: "thread-a-agent-17",
                delta: " streaming",
            },
        })`,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const positionAfterStreamingDelta = await inspect(
        window,
        'document.querySelector("#conversation-scroll").scrollTop',
    )
    if (Math.abs(positionAfterStreamingDelta - alphaPosition) > 2) {
        throw new Error("A streaming delta pulled the reader away from their position")
    }
    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-b].active") && document.querySelector(".loading-conversation") && document.querySelector("#composer-input").disabled',
    )
    await waitFor(window, '!document.querySelector(".loading-conversation")')
    if ((await inspect(window, 'document.querySelector("#composer-input").value')) !== "") {
        throw new Error("Thread B inherited Thread A's draft")
    }
    const backgroundRoutingBefore = await inspect(
        window,
        'window.rollingSkill.smokeNotificationRoutingMetrics()',
    )
    await inspect(
        window,
        'window.rollingSkill.smokeAppendBackgroundAnswer("thread-a", "Background answer recovered from runtime history", 100)',
    )
    await new Promise((resolve) => setTimeout(resolve, 75))
    const backgroundRoutingAfter = await inspect(
        window,
        'window.rollingSkill.smokeNotificationRoutingMetrics()',
    )
    if (
        backgroundRoutingAfter.deliveredTimelineNotifications !==
            backgroundRoutingBefore.deliveredTimelineNotifications ||
        backgroundRoutingAfter.blockedTimelineNotifications -
            backgroundRoutingBefore.blockedTimelineNotifications < 102 ||
        (await inspect(window, 'document.querySelector("#conversation")?.textContent.includes("Background answer recovered")'))
    ) {
        throw new Error(
            `Background conversation events reached the visible timeline: ${JSON.stringify({backgroundRoutingBefore, backgroundRoutingAfter})}`,
        )
    }
    await inspect(
        window,
        `(() => {
            const input = document.querySelector("#composer-input")
            input.value = "draft-beta"
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })()`,
    )

    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation") && document.querySelector("#composer-input").value === "draft-alpha" && document.querySelector("#conversation")?.textContent.includes("Background answer recovered from runtime history")',
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const restoredAlphaPosition = await inspect(
        window,
        'document.querySelector("#conversation-scroll").scrollTop',
    )
    if (Math.abs(restoredAlphaPosition - alphaPosition) > 2) {
        throw new Error(
            `Thread A reading position changed: ${alphaPosition} -> ${restoredAlphaPosition}`,
        )
    }

    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-b].active") && !document.querySelector(".loading-conversation") && document.querySelector("#composer-input").value === "draft-beta"',
    )
    await inspect(window, 'document.querySelector("#new-task").click()')
    await waitFor(window, 'document.querySelector("#active-title").textContent === "新任务"')
    await inspect(
        window,
        `(() => {
            const input = document.querySelector("#composer-input")
            input.value = "draft-new-task"
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })()`,
    )
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    await inspect(window, 'document.querySelector("#new-task").click()')
    await waitFor(
        window,
        'document.querySelector("#active-title").textContent === "新任务" && document.querySelector("#composer-input").value === "draft-new-task"',
    )

    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-b].active") && !document.querySelector(".loading-conversation")')
    await inspect(window, 'window.rollingSkill.smokeFailNextRead("thread-a")')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(
        window,
        'document.querySelector(".thread-load-failed") && document.querySelector("#composer-input").disabled',
    )
    if ((await inspect(window, 'document.querySelector("#composer-input").value')) !== "draft-alpha") {
        throw new Error("A failed read lost the conversation draft")
    }
    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-b].active") && !document.querySelector(".loading-conversation")')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const positionAfterReadFailure = await inspect(
        window,
        'document.querySelector("#conversation-scroll").scrollTop',
    )
    if (Math.abs(positionAfterReadFailure - alphaPosition) > 2) {
        throw new Error(
            `A failed read changed the saved position: ${alphaPosition} -> ${positionAfterReadFailure}`,
        )
    }

    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-b].active") && document.querySelector(".loading-conversation")')
    await inspect(window, 'document.querySelector("[data-thread-view=archived]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-view=archived][aria-selected=true]") && !document.querySelector(".loading-conversation") && !document.querySelector("#composer-input").disabled',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!(await inspect(window, 'document.querySelector("[data-thread-view=archived][aria-selected=true]") && !document.querySelector(".loading-conversation")'))) {
        throw new Error("A stale thread read replaced the empty archived view")
    }

    await inspect(window, 'document.querySelector("[data-surface=chat]").click()')
    await inspect(window, 'document.querySelector("[data-thread-view=current]").click()')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    const operatorChatBaseline = await inspect(window, `(() => ({
        text: document.querySelector("#conversation").textContent,
        draft: document.querySelector("#composer-input").value,
    }))()`)

    const operatorBootstrapProjection = await inspect(window, `(async () => {
        await window.rollingSkill.smokePopulateOperatorPagingRecords()
        async function collect(limit) {
            const records = {sessions: [], jobs: [], steps: [], approvals: []}
            const pages = []
            let cursor = null
            do {
                const page = await window.rollingSkill.readOperatorSummaryPage(cursor, limit)
                const count = ["sessions", "jobs", "steps", "approvals"]
                    .reduce((sum, key) => sum + page[key].length, 0)
                pages.push({
                    generation: page.generation,
                    revision: page.revision,
                    count,
                    truncated: page.truncated,
                    nextCursor: page.nextCursor,
                })
                for (const key of Object.keys(records)) records[key].push(...page[key])
                cursor = page.nextCursor
                if (pages.length > 500) throw new Error("Operator summary paging did not converge")
            } while (cursor !== null)
            return {records, pages}
        }
        const limitOne = await collect(1)
        const limitSeven = await collect(7)
        const first = limitOne.pages[0]
        const secondWithDifferentLimit = await window.rollingSkill.readOperatorSummaryPage(
            first.nextCursor,
            3,
        )
        const session = limitOne.records.sessions[0]
        const parent = limitOne.records.jobs.find((job) => job.objective === "Release candidate after evaluation")
        const approval = limitOne.records.approvals[0]
        const expectedRecords = Object.values(limitOne.records)
            .reduce((sum, records) => sum + records.length, 0)
        const totals = Object.values((await window.rollingSkill.bootstrapOperator()).totals)
            .reduce((sum, count) => sum + count, 0)
        return {
            generationIsUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(first.generation),
            limitOneExact: limitOne.pages.every((page) => page.count === 1),
            differentLimitCursor: secondWithDifferentLimit.generation === first.generation &&
                secondWithDifferentLimit.revision === first.revision &&
                ["sessions", "jobs", "steps", "approvals"].reduce((sum, key) => (
                    sum + secondWithDifferentLimit[key].length
                ), 0) === 3,
            boundedRealPages: limitSeven.pages.length > 1 &&
                limitSeven.pages.length < limitOne.pages.length &&
                limitSeven.pages.every((page) => page.count >= 1 && page.count <= 7) &&
                limitSeven.pages.at(-1).truncated === false &&
                limitSeven.pages.at(-1).nextCursor === null,
            allRecords: expectedRecords === totals,
            sessionIsSummary: Number.isSafeInteger(session?.transcriptSequence) &&
                !Object.hasOwn(session ?? {}, "transcript"),
            jobIsPublic: Array.isArray(parent?.childJobIds) &&
                !Object.hasOwn(parent ?? {}, "children") &&
                !Object.hasOwn(parent ?? {}, "checkpoint") &&
                !Object.hasOwn(parent ?? {}, "result"),
            approvalIsPublic: approval?.status === "pending" &&
                !Object.hasOwn(approval ?? {}, "proposedMutation"),
            allRecordsArePublic: Object.values(limitOne.records).flat().every((record) => (
                !Object.hasOwn(record, "children") &&
                !Object.hasOwn(record, "checkpoint") &&
                !Object.hasOwn(record, "result") &&
                !Object.hasOwn(record, "proposedMutation")
            )),
        }
    })()`)
    if (!Object.values(operatorBootstrapProjection).every(Boolean)) {
        throw new Error(`Operator bootstrap fixture is not the main public projection: ${JSON.stringify(operatorBootstrapProjection)}`)
    }
    const staleGenerationProbe = await inspect(window, `(async () => {
        const before = await window.rollingSkill.readOperatorSummaryPage(null, 1)
        await window.rollingSkill.smokeRestartOperatorStore()
        let staleCode = null
        try {
            await window.rollingSkill.readOperatorSummaryPage(before.nextCursor, 1)
        } catch (error) {
            staleCode = error?.code ?? null
        }
        const after = await window.rollingSkill.readOperatorSummaryPage(null, 1)
        return {changed: before.generation !== after.generation, staleCode}
    })()`)
    if (!staleGenerationProbe.changed || staleGenerationProbe.staleCode !== "OPERATOR_SNAPSHOT_CHANGED") {
        throw new Error(`Operator Store generation cursor did not fail stale: ${JSON.stringify(staleGenerationProbe)}`)
    }
    const operatorFixtureIds = await inspect(
        window,
        'window.rollingSkill.smokeOperatorMetrics().then(({fixtureIds}) => fixtureIds)',
    )
    const runningJobSelector = `[data-operator-job-id="${operatorFixtureIds.runningJobId}"]`
    const streamingJobSelector = `[data-operator-job-id="${operatorFixtureIds.streamingJobId}"]`
    const waitingJobSelector = `[data-operator-job-id="${operatorFixtureIds.waitingJobId}"]`
    const approvalSelector = `[data-operator-approval-id="${operatorFixtureIds.approvalId}"]`

    await inspect(window, 'document.querySelector("[data-surface=operator]").click()')
    await waitFor(
        window,
        `document.querySelector(${JSON.stringify(`${runningJobSelector}.active`)}) && document.querySelector("#operator-transcript").textContent.includes("Running fixture output 0")`,
    )
    const activeOperatorDomBeforeHiddenDelta = await inspect(
        window,
        'document.querySelector("#operator-transcript").innerHTML',
    )
    await inspect(window, 'window.rollingSkill.smokeEmitHiddenOperatorDelta()')
    await new Promise((resolve) => setTimeout(resolve, 100))
    const hiddenOperatorIsolation = await inspect(window, `(() => ({
        activeDom: document.querySelector("#operator-transcript").innerHTML,
        hiddenUnread: Number(document.querySelector(${JSON.stringify(`${streamingJobSelector} .operator-job-unread`)})?.textContent ?? 0),
    }))()`)
    if (
        hiddenOperatorIsolation.activeDom !== activeOperatorDomBeforeHiddenDelta ||
        hiddenOperatorIsolation.hiddenUnread < 1
    ) {
        throw new Error(`Hidden Operator delta touched active DOM: ${JSON.stringify(hiddenOperatorIsolation)}`)
    }

    await inspect(window, `(() => {
        const input = document.querySelector("#operator-composer-input")
        input.value = "running job draft"
        input.dispatchEvent(new Event("input", {bubbles: true}))
        document.querySelector("#operator-transcript").scrollTop = 120
    })()`)
    await inspect(window, `document.querySelector(${JSON.stringify(streamingJobSelector)}).click()`)
    await waitFor(
        window,
        `document.querySelector(${JSON.stringify(`${streamingJobSelector}.active`)}) && document.querySelector("#operator-transcript").textContent.includes("Hidden streamed output after bootstrap")`,
    )
    const hiddenCatchUp = await inspect(window, `(() => ({
        complete: ["Hidden fixture output 0", "Hidden fixture output 11", "Hidden streamed output after bootstrap"]
            .every((text) => document.querySelector("#operator-transcript").textContent.includes(text)),
        initialScrollTop: document.querySelector("#operator-transcript").scrollTop,
    }))()`)
    if (!hiddenCatchUp.complete) {
        throw new Error(`Hidden Operator output did not catch up directly: ${JSON.stringify(hiddenCatchUp)}`)
    }
    await inspect(window, `(() => {
        const input = document.querySelector("#operator-composer-input")
        input.value = "hidden job draft"
        input.dispatchEvent(new Event("input", {bubbles: true}))
        document.querySelector("#operator-transcript").scrollTop = 96
    })()`)
    await inspect(window, `document.querySelector(${JSON.stringify(runningJobSelector)}).click()`)
    await waitFor(
        window,
        'document.querySelector("#operator-composer-input").value === "running job draft" && Math.abs(document.querySelector("#operator-transcript").scrollTop - 120) <= 2',
    )
    await inspect(window, `document.querySelector(${JSON.stringify(streamingJobSelector)}).click()`)
    await waitFor(
        window,
        'document.querySelector("#operator-composer-input").value === "hidden job draft" && Math.abs(document.querySelector("#operator-transcript").scrollTop - 96) <= 2',
    )

    const gapCallsBefore = await inspect(
        window,
        'window.rollingSkill.smokeOperatorMetrics().then(({summaryPageCalls}) => summaryPageCalls.length)',
    )
    await inspect(window, 'window.rollingSkill.smokeEmitOperatorGap()')
    await waitFor(
        window,
        'document.querySelector("#operator-transcript").textContent.includes("Gap catch-up output")',
    )
    const operatorGapMetrics = await inspect(window, `(async () => {
        const metrics = await window.rollingSkill.smokeOperatorMetrics()
        const calls = metrics.summaryPageCalls.slice(${gapCallsBefore})
        return {
            calls: calls.length,
            bounded: calls.length > 1 && calls.length <= 6 && calls.every((entry) => entry.limit === 100),
            subscriptions: metrics.subscriptions,
        }
    })()`)
    if (
        !operatorGapMetrics.bounded ||
        JSON.stringify(operatorGapMetrics.subscriptions) !== JSON.stringify({
            changed: 1,
            event: 1,
            approval: 1,
            artifact: 1,
        })
    ) {
        throw new Error(`Operator gap catch-up was not bounded: ${JSON.stringify(operatorGapMetrics)}`)
    }

    for (let index = 0; index < 4; index += 1) {
        await inspect(window, `document.querySelector(${JSON.stringify(waitingJobSelector)}).click()`)
        await waitFor(window, `document.querySelector(${JSON.stringify(`${waitingJobSelector}.active`)})`)
        await inspect(window, `document.querySelector(${JSON.stringify(runningJobSelector)}).click()`)
        await waitFor(window, `document.querySelector(${JSON.stringify(`${runningJobSelector}.active`)})`)
    }
    await inspect(window, `document.querySelector(${JSON.stringify(waitingJobSelector)}).click()`)
    await waitFor(
        window,
        `document.querySelector(${JSON.stringify(`${approvalSelector} [data-operator-approval-decision="approve"]`)}) && document.querySelector("#operator-child-jobs").textContent.includes("Evaluation 1/2") && document.querySelector("[data-operator-artifact-id=operator-artifact-report]")`,
    )
    await inspect(window, `document.querySelector(${JSON.stringify(`${approvalSelector} [data-operator-approval-decision="approve"]`)}).click()`)
    try {
        await waitFor(
            window,
            `!document.querySelector(${JSON.stringify(`${approvalSelector} [data-operator-approval-decision]`)})`,
        )
    } catch (error) {
        const approvalDiagnostic = await inspect(window, `(async () => ({
                domStatus: document.querySelector(${JSON.stringify(`${approvalSelector} .operator-approval-status`)})?.textContent ?? null,
                actionVisible: Boolean(document.querySelector(${JSON.stringify(`${approvalSelector} [data-operator-approval-decision]`)})),
                approvalCalls: (await window.rollingSkill.smokeOperatorMetrics()).approvalCalls,
        }))()`)
        throw new Error(`Operator approval did not patch active DOM: ${JSON.stringify(approvalDiagnostic)}`, {cause: error})
    }
    if ((await inspect(window, 'window.rollingSkill.smokeOperatorMetrics().then(({approvalCalls}) => approvalCalls)')) !== 1) {
        throw new Error("Dynamic Operator approval buttons accumulated listeners")
    }

    await inspect(window, `document.querySelector(${JSON.stringify(runningJobSelector)}).click()`)
    const stopSelector = `${runningJobSelector}[data-operator-job-action="stop"]`
    await waitFor(window, `document.querySelector(${JSON.stringify(stopSelector)})`)
    await inspect(window, `document.querySelector(${JSON.stringify(stopSelector)}).click()`)
    await waitFor(window, `!document.querySelector(${JSON.stringify(stopSelector)})`)
    if ((await inspect(window, 'window.rollingSkill.smokeOperatorMetrics().then(({stopCalls}) => stopCalls)')) !== 1) {
        throw new Error("Dynamic Operator control buttons accumulated listeners")
    }

    await inspect(window, 'document.querySelector("#operator-new-job").click()')
    await waitFor(window, '!document.querySelector("#operator-setup-form").classList.contains("hidden")')
    await inspect(window, `(() => {
        document.querySelector("#operator-automation-boundary").open = true
    })()`)
    window.setSize(760, 480)
    await new Promise((resolve) => setTimeout(resolve, 75))
    const narrowAutomationBoundary = await inspect(window, `(() => {
        const grid = document.querySelector(".operator-boundary-grid")
        const deletion = grid?.querySelector('[data-operator-risk="datasets.delete"]')?.closest("label")
        if (!grid || !deletion) return null
        const gridRect = grid.getBoundingClientRect()
        const deletionRect = deletion.getBoundingClientRect()
        return {
            grid: {left: gridRect.left, right: gridRect.right},
            permanentDeletion: grid.querySelector('[data-operator-risk="datasets.delete"]').checked,
            deletion: {
                left: deletionRect.left,
                right: deletionRect.right,
            },
        }
    })()`)
    if (
        !narrowAutomationBoundary ||
        narrowAutomationBoundary.permanentDeletion !== false ||
        narrowAutomationBoundary.deletion.left < narrowAutomationBoundary.grid.left - 1 ||
        narrowAutomationBoundary.deletion.right > narrowAutomationBoundary.grid.right + 1
    ) {
        throw new Error(`Automation boundary does not stack inside a narrow window: ${JSON.stringify(narrowAutomationBoundary)}`)
    }
    window.setSize(1_180, 800)
    await new Promise((resolve) => setTimeout(resolve, 75))
    await inspect(window, `(() => {
        document.querySelector('#operator-setup-form [name="objective"]').value = "Automated boundary smoke Job"
        document.querySelector('[data-operator-risk="datasets.delete"]').checked = true
        document.querySelector("#operator-generic-start").click()
    })()`)
    await waitFor(window, 'document.querySelector("#operator-setup-form").classList.contains("hidden")')
    const operatorCreateInput = await inspect(
        window,
        'window.rollingSkill.smokeOperatorMetrics().then(({operatorCreateInput}) => operatorCreateInput)',
    )
    if (
        JSON.stringify(operatorCreateInput?.budget) !== JSON.stringify({}) ||
        !operatorCreateInput.actions.includes("runtime.execute") ||
        !operatorCreateInput.actions.includes("skills.release") ||
        !operatorCreateInput.actions.includes("datasets.delete")
    ) {
        throw new Error(`Operator automation boundary submitted the wrong request: ${JSON.stringify(operatorCreateInput)}`)
    }
    await inspect(window, 'document.querySelector("#operator-new-job").click()')
    await waitFor(window, '!document.querySelector("#operator-setup-form").classList.contains("hidden")')
    await inspect(window, `(() => {
        const change = (selector, value) => {
            const element = document.querySelector(selector)
            element.value = value
            element.dispatchEvent(new Event("change", {bubbles: true}))
        }
        change("#operator-job-kind", "optimization")
    })()`)
    await waitFor(window, 'document.querySelector("#operator-optimization-baseline option[value=managed-version-released-smoke]")')
    await waitFor(window, 'document.querySelector("[data-operator-target=\\"codebuddy:renderer-smoke\\"]") && document.querySelector("[data-optimization-target-model=\\"codebuddy:renderer-smoke\\"] option")')
    const epochOnlySetup = await inspect(window, `(() => {
        const limits = [...document.querySelectorAll("[data-optimization-limit]")]
        const epoch = limits[0]
        const helper = document.querySelector(".operator-epoch-boundary .operator-help")
        const ordinaryBoundary = document.querySelector("#operator-automation-boundary")
        return {
            limitCount: limits.length,
            limitName: epoch?.dataset.optimizationLimit ?? null,
            limitValue: epoch?.value ?? null,
            helper: helper?.textContent ?? "",
            helperVisible: Boolean(helper && helper.getClientRects().length),
            ordinaryBoundaryHidden: ordinaryBoundary?.classList.contains("hidden") ?? false,
            maxIterationsCount: document.querySelectorAll("[data-operator-max-iterations]").length,
            targetCount: document.querySelectorAll("[data-optimization-target]").length,
            hasMode: Boolean(document.querySelector("#operator-optimization-mode")),
            directionLabel: document.querySelector("#operator-objective-label")?.textContent ?? "",
            directionPlaceholder: document.querySelector('[name="objective"]')?.placeholder ?? "",
            directionHelp: document.querySelector("#operator-objective-help")?.textContent ?? "",
            directionHelpVisible: Boolean(document.querySelector("#operator-objective-help")?.getClientRects().length),
            directionRequired: document.querySelector('[name="objective"]')?.required,
            directionMaxLength: document.querySelector('[name="objective"]')?.maxLength,
            skillLabel: document.querySelector("#operator-managed-skill-label")?.textContent ?? "",
            datasetLabel: document.querySelector("#operator-managed-dataset-label")?.textContent ?? "",
            skillValue: document.querySelector("#operator-managed-skill")?.value ?? "",
            datasetValue: document.querySelector("#operator-managed-dataset")?.value ?? "",
            baselineValue: document.querySelector("#operator-optimization-baseline")?.value ?? "",
            operatorModelValue: document.querySelector("#operator-model")?.value ?? "",
            emptySkillOptions: document.querySelectorAll('#operator-managed-skill option[value=""]').length,
            emptyDatasetOptions: document.querySelectorAll('#operator-managed-dataset option[value=""]').length,
            emptyModelOptions: document.querySelectorAll('#operator-model option[value=""]').length,
        }
    })()`)
    if (
        epochOnlySetup.limitCount !== 1 ||
        epochOnlySetup.limitName !== "maxEpochs" ||
        epochOnlySetup.limitValue !== "5" ||
        !epochOnlySetup.helper.includes("改进 Skill、安装候选版本、完整评测和结果复盘") ||
        !epochOnlySetup.helperVisible ||
        !epochOnlySetup.ordinaryBoundaryHidden ||
        epochOnlySetup.maxIterationsCount !== 0 ||
        epochOnlySetup.targetCount !== 0 ||
        epochOnlySetup.hasMode ||
        epochOnlySetup.directionLabel !== "优化方向（可选）" ||
        !epochOnlySetup.directionPlaceholder.includes("留空时由系统全面优化") ||
        !epochOnlySetup.directionHelp.includes("基线评测和用户使用体验") ||
        !epochOnlySetup.directionHelpVisible ||
        epochOnlySetup.directionRequired ||
        epochOnlySetup.directionMaxLength !== 8000 ||
        epochOnlySetup.skillLabel !== "受管 Skill" ||
        epochOnlySetup.datasetLabel !== "数据集" ||
        epochOnlySetup.skillValue !== "managed-skill-smoke-two" ||
        epochOnlySetup.datasetValue !== "optimization-dataset-smoke" ||
        epochOnlySetup.baselineValue !== "managed-version-released-smoke" ||
        epochOnlySetup.operatorModelValue !== "gpt-5.6-sol" ||
        epochOnlySetup.emptySkillOptions !== 0 ||
        epochOnlySetup.emptyDatasetOptions !== 0 ||
        epochOnlySetup.emptyModelOptions !== 0
    ) {
        throw new Error(`Optimization setup is not Epoch-only: ${JSON.stringify(epochOnlySetup)}`)
    }
    const objectiveModeSwitch = await inspect(window, `(() => {
        const kind = document.querySelector("#operator-job-kind")
        const objective = document.querySelector('[name="objective"]')
        const label = document.querySelector("#operator-objective-label")
        kind.value = "operator"
        kind.dispatchEvent(new Event("change", {bubbles: true}))
        const generic = {label: label.textContent, required: objective.required, maxLength: objective.maxLength}
        kind.value = "optimization"
        kind.dispatchEvent(new Event("change", {bubbles: true}))
        return {generic, optimization: {label: label.textContent, required: objective.required, maxLength: objective.maxLength}}
    })()`)
    if (
        objectiveModeSwitch.generic.label !== "目标" ||
        !objectiveModeSwitch.generic.required ||
        objectiveModeSwitch.generic.maxLength !== 32768 ||
        objectiveModeSwitch.optimization.label !== "优化方向（可选）" ||
        objectiveModeSwitch.optimization.required ||
        objectiveModeSwitch.optimization.maxLength !== 8000
    ) throw new Error(`Objective mode semantics drifted: ${JSON.stringify(objectiveModeSwitch)}`)
    await inspect(window, `(() => {
        const change = (selector, value) => {
            const element = document.querySelector(selector)
            element.value = value
            element.dispatchEvent(new Event("change", {bubbles: true}))
        }
        change("#operator-runtime", "codex:renderer-smoke")
        change("#operator-effort", "high")
        change("#operator-optimization-judge-runtime", "codex:renderer-smoke")
        change("#operator-optimization-judge-model", "gpt-5.6-sol")
        change("#operator-optimization-judge-effort", "high")
        for (const input of document.querySelectorAll("[data-operator-target]")) input.checked = false
        const target = document.querySelector('[data-operator-target="codebuddy:renderer-smoke"]')
        target.checked = true
        target.dispatchEvent(new Event("change", {bubbles: true}))
        change('[data-optimization-target-model="codebuddy:renderer-smoke"]', "model-renderer-smoke")
        change('[data-optimization-target-effort="codebuddy:renderer-smoke"]', "high")
    })()`)
    const separatePreflightControl = await inspect(window, `Boolean(
        document.querySelector("#operator-optimization-preflight") ||
        document.querySelector("#operator-optimization-preflight-summary")
    )`)
    if (separatePreflightControl) {
        throw new Error("Optimization still exposes a separate preflight action")
    }
    await inspect(window, 'window.rollingSkill.smokeFailNextOptimizationStart()')
    await inspect(window, 'document.querySelector(\'[name="objective"]\').value = "   "')
    await inspect(window, 'document.querySelector("#operator-optimization-start").click()')
    await waitFor(window, `
        document.querySelector("#operator-setup-error").textContent.includes("评分标准") &&
        !document.querySelector("#operator-optimization-start").disabled
    `)
    const optimizationFailure = await inspect(window, `(() => ({
        error: document.querySelector("#operator-setup-error").textContent,
        errorVisible: !document.querySelector("#operator-setup-error").classList.contains("hidden"),
        startDisabled: document.querySelector("#operator-optimization-start").disabled,
        startText: document.querySelector("#operator-optimization-start").textContent,
    }))()`)
    if (
        !optimizationFailure.errorVisible ||
        !optimizationFailure.error.includes("尚未发布评分标准") ||
        optimizationFailure.startDisabled ||
        optimizationFailure.startText !== "开始优化"
    ) {
        throw new Error(`Optimization failure was not actionable and retryable: ${JSON.stringify(optimizationFailure)}`)
    }
    await inspect(window, 'document.querySelector(\'[name="objective"]\').value = "  重点改善异常下钻  "')
    const optimizationStarting = await inspect(window, `(() => {
        const start = document.querySelector("#operator-optimization-start")
        start.click()
        return {disabled: start.disabled, text: start.textContent}
    })()`)
    if (!optimizationStarting.disabled || optimizationStarting.text !== "正在检查并启动…") {
        throw new Error(`Optimization Start did not expose its pending state: ${JSON.stringify(optimizationStarting)}`)
    }
    try {
        await waitFor(window, '[...document.querySelectorAll("[data-operator-job-id]")].some((node) => node.textContent.includes("Skill 自动优化 · billing-cost-analysis · optimization"))')
    } catch (error) {
        const diagnostic = await inspect(window, `(() => ({
            setupError: document.querySelector("#operator-setup-error").textContent,
            formValid: document.querySelector("#operator-setup-form").checkValidity(),
            invalid: [...document.querySelector("#operator-setup-form").elements]
                .filter((element) => typeof element.checkValidity === "function" && !element.checkValidity())
                .map((element) => ({id: element.id, name: element.name, value: element.value, validationMessage: element.validationMessage})),
            jobs: [...document.querySelectorAll("[data-operator-job-id]")].map((node) => node.textContent),
        }))()`)
        throw new Error(`Optimization Start did not create a Job: ${JSON.stringify({diagnostic, rendererErrors})}`, {cause: error})
    }
    const optimizationStartMetrics = await inspect(
        window,
        'window.rollingSkill.smokeOperatorMetrics().then(({optimizationStartCalls, optimizationStartInputs}) => ({optimizationStartCalls, optimizationStartInputs}))',
    )
    if (
        optimizationStartMetrics.optimizationStartCalls !== 2 ||
        optimizationStartMetrics.optimizationStartInputs[0]?.optimizationDirection !== null ||
        optimizationStartMetrics.optimizationStartInputs[1]?.optimizationDirection !== "重点改善异常下钻"
    ) {
        throw new Error(`Optimization direction payload changed: ${JSON.stringify(optimizationStartMetrics)}`)
    }
    const clearedOptimizationDirection = await inspect(
        window,
        'document.querySelector(\'[name="objective"]\').value',
    )
    if (clearedOptimizationDirection !== "") {
        throw new Error(`Successful Optimization did not clear its direction: ${JSON.stringify(clearedOptimizationDirection)}`)
    }
    const optimizationJobId = await inspect(window, `[...document.querySelectorAll("[data-operator-job-id]")]
        .find((node) => node.textContent.includes("Skill 自动优化 · billing-cost-analysis · optimization"))?.dataset.operatorJobId`)
    const optimizationJobSelector = `[data-operator-job-id="${optimizationJobId}"]`
    try {
        await waitFor(window, `document.querySelector(${JSON.stringify(`${optimizationJobSelector}.active`)}) && !document.querySelector("#operator-optimization-panel").classList.contains("hidden")`)
    } catch (error) {
        const diagnostic = await inspect(window, `(async () => {
            const page = await window.rollingSkill.readOperatorSummaryPage(null, 100)
            return ({
            activeJobs: [...document.querySelectorAll("[data-operator-job-id].active")].map((node) => ({id: node.dataset.operatorJobId, text: node.textContent})),
            optimizationJob: document.querySelector(${JSON.stringify(optimizationJobSelector)})?.outerHTML,
            summaryJob: page.jobs.find((job) => job.id === ${JSON.stringify(optimizationJobId)}),
            summarySession: page.sessions.find((session) => session.id === page.jobs.find((job) => job.id === ${JSON.stringify(optimizationJobId)})?.sessionId),
            panelHidden: document.querySelector("#operator-optimization-panel").classList.contains("hidden"),
            setupHidden: document.querySelector("#operator-setup-form").classList.contains("hidden"),
            sessionTitle: document.querySelector("#operator-session-title").textContent,
            })
        })()`)
        throw new Error(`Optimization Job was not activated: ${JSON.stringify({diagnostic, rendererErrors})}`, {cause: error})
    }
    const optimizationChrome = await inspect(window, `(() => ({
        listTitle: document.querySelector(${JSON.stringify(optimizationJobSelector)})
            ?.querySelector(".operator-job-title")?.textContent,
        sessionTitle: document.querySelector("#operator-session-title").textContent,
        frozen: document.querySelector("#operator-optimization-frozen").textContent,
        actions: [
            document.querySelector("#operator-composer-send"),
            document.querySelector("[data-optimization-action=pause]"),
            document.querySelector("[data-optimization-action=stop]"),
            document.querySelector("[data-optimization-action=report]"),
        ].map((button) => button?.className ?? null),
    }))()`)
    if (
        optimizationChrome.listTitle !== "Skill 自动优化 · billing-cost-analysis · optimization" ||
        optimizationChrome.sessionTitle !== "Skill 自动优化 · billing-cost-analysis · optimization" ||
        !optimizationChrome.frozen.includes("优化方向 重点改善异常下钻") ||
        !optimizationChrome.frozen.includes("Rolling Skill Optimization Playbook v1") ||
        optimizationChrome.actions.some((className) => !className?.includes("operator-action-button")) ||
        !optimizationChrome.actions[0].includes("primary") ||
        !optimizationChrome.actions[2].includes("operator-action-danger")
    ) {
        throw new Error(`Optimization title or action styles are inconsistent: ${JSON.stringify(optimizationChrome)}`)
    }
    await inspect(window, `document.querySelector(${JSON.stringify(streamingJobSelector)}).click()`)
    await waitFor(window, `document.querySelector(${JSON.stringify(`${streamingJobSelector}.active`)})`)
    const hiddenOptimizationDom = await inspect(window, 'document.querySelector("#operator-status-panel").innerHTML')
    await inspect(window, 'window.rollingSkill.smokeAdvanceOptimization()')
    const finalApprovalId = await inspect(
        window,
        'window.rollingSkill.smokeOperatorMetrics().then(({fixtureIds}) => fixtureIds.optimizationApprovalId)',
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    if ((await inspect(window, 'document.querySelector("#operator-status-panel").innerHTML')) !== hiddenOptimizationDom) {
        throw new Error("Hidden Optimization progress triggered active-panel rendering")
    }
    await inspect(window, `document.querySelector(${JSON.stringify(optimizationJobSelector)}).click()`)
    await waitFor(window, 'document.querySelector("#operator-optimization-timeline").textContent.includes("82") && document.querySelector("#operator-optimization-budget").textContent.includes("2")')
    await waitFor(window, 'document.querySelector("[data-operator-approval-decision=approve]")')
    await inspect(window, 'document.querySelector("[data-operator-approval-decision=approve]").click()')
    await waitFor(window, 'document.querySelector("#operator-optimization-budget").textContent.includes("released-install-smoke")')
    const optimizationEvidenceBeforeSwitch = await inspect(window, `(() => ({
        timeline: document.querySelector("#operator-optimization-timeline").textContent,
        release: document.querySelector("#operator-optimization-budget").textContent,
        composerSticky: getComputedStyle(document.querySelector(".operator-composer-wrap")).position === "sticky",
    }))()`)
    if (!optimizationEvidenceBeforeSwitch.composerSticky ||
        !finalApprovalId ||
        !optimizationEvidenceBeforeSwitch.release.includes(finalApprovalId) ||
        !optimizationEvidenceBeforeSwitch.release.includes("managed-version-improved-smoke") ||
        !optimizationEvidenceBeforeSwitch.release.includes("released-install-smoke")) {
        throw new Error(`Optimization final approval/install or pinned composer missing: ${JSON.stringify(optimizationEvidenceBeforeSwitch)}`)
    }
    await inspect(window, `document.querySelector(${JSON.stringify(streamingJobSelector)}).click()`)
    await inspect(window, `document.querySelector(${JSON.stringify(optimizationJobSelector)}).click()`)
    await waitFor(window, 'document.querySelector("#operator-optimization-budget").textContent.includes("released-install-smoke")')
    const optimizationEvidenceAfterSwitch = await inspect(window, `(() => ({
        timeline: document.querySelector("#operator-optimization-timeline").textContent,
        release: document.querySelector("#operator-optimization-budget").textContent,
    }))()`)
    if (optimizationEvidenceAfterSwitch.timeline !== optimizationEvidenceBeforeSwitch.timeline ||
        optimizationEvidenceAfterSwitch.release !== optimizationEvidenceBeforeSwitch.release) {
        throw new Error("Optimization install result or score trend did not survive task switching")
    }

    await inspect(window, 'document.querySelector("[data-surface=chat]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    const operatorChatAfterStop = await inspect(window, `(() => ({
        text: document.querySelector("#conversation").textContent,
        draft: document.querySelector("#composer-input").value,
    }))()`)
    if (JSON.stringify(operatorChatAfterStop) !== JSON.stringify(operatorChatBaseline)) {
        throw new Error("Stopping an Operator Job changed the active Chat")
    }

    await inspect(window, 'window.rollingSkill.smokeEmitRuntimeState("codex:slow", 160)')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await inspect(window, 'window.rollingSkill.smokeEmitRuntimeState("codex:fast", 0)')
    await waitFor(
        window,
        'document.querySelector("#composer-model option[value=model-fast]") && !document.querySelector(".loading-conversation")',
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    if (await inspect(window, 'Boolean(document.querySelector("#composer-model option[value=model-slow]"))')) {
        throw new Error("A stale Runtime model response replaced the active Runtime catalog")
    }

    window.setSize(760, 480)
    await inspect(window, 'document.querySelector("#settings-button").click()')
    await waitFor(window, 'document.querySelector("#settings-dialog").open')
    const settingsLayoutBeforeScroll = await inspect(window, `(() => {
        const dialog = document.querySelector("#settings-dialog")
        const body = dialog.querySelector(".settings-dialog-body")
        const actions = dialog.querySelector(".settings-actions")
        const save = dialog.querySelector("#save-settings")
        if (!body || !actions || !save) return null
        const dialogRect = dialog.getBoundingClientRect()
        const actionsRect = actions.getBoundingClientRect()
        const saveRect = save.getBoundingClientRect()
        return {
            bodyScrollable: body.scrollHeight > body.clientHeight,
            bodyScrollTop: body.scrollTop,
            actionsTop: actionsRect.top,
            actionsBottom: actionsRect.bottom,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
            saveRight: saveRect.right,
            actionsRight: actionsRect.right,
        }
    })()`)
    if (
        !settingsLayoutBeforeScroll?.bodyScrollable ||
        settingsLayoutBeforeScroll.actionsTop < settingsLayoutBeforeScroll.dialogTop ||
        settingsLayoutBeforeScroll.actionsBottom > settingsLayoutBeforeScroll.dialogBottom + 1 ||
        Math.abs(settingsLayoutBeforeScroll.actionsRight - settingsLayoutBeforeScroll.saveRight) > 21
    ) {
        throw new Error(`Settings actions are not persistently visible at the lower right: ${JSON.stringify(settingsLayoutBeforeScroll)}`)
    }
    await inspect(window, `(() => {
        const body = document.querySelector("#settings-dialog .settings-dialog-body")
        body.scrollTop = body.scrollHeight
    })()`)
    const settingsLayoutAfterScroll = await inspect(window, `(() => {
        const dialog = document.querySelector("#settings-dialog")
        const body = dialog.querySelector(".settings-dialog-body")
        const actions = dialog.querySelector(".settings-actions")
        const dialogRect = dialog.getBoundingClientRect()
        const actionsRect = actions.getBoundingClientRect()
        return {
            bodyScrollTop: body.scrollTop,
            actionsTop: actionsRect.top,
            actionsBottom: actionsRect.bottom,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
        }
    })()`)
    if (
        settingsLayoutAfterScroll.bodyScrollTop <= 0 ||
        settingsLayoutAfterScroll.actionsTop !== settingsLayoutBeforeScroll.actionsTop ||
        settingsLayoutAfterScroll.actionsBottom !== settingsLayoutBeforeScroll.actionsBottom
    ) {
        throw new Error(`Settings actions moved with the scrolling content: ${JSON.stringify(settingsLayoutAfterScroll)}`)
    }
    await inspect(window, 'document.querySelector("#cancel-settings").click()')

    await inspect(window, 'document.querySelector("[data-surface=chat]").click()')
    await inspect(window, 'document.querySelector("[data-thread-view=current]").click()')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    await waitFor(window, '!document.querySelector("[data-dispatch-raw-case=raw-case-smoke][data-dispatch-mode=current]").disabled')
    await inspect(window, 'document.querySelector("[data-dispatch-raw-case=raw-case-smoke][data-dispatch-mode=current]").click()')
    await waitFor(window, '!document.querySelector("[data-raw-case-id=raw-case-smoke]")')
    const rawCaseTurnText = await inspect(window, 'window.rollingSkill.smokeLastRawCaseTurnText()')
    if (rawCaseTurnText !== "查一下已编辑的 8 月账单问题") {
        throw new Error(`Raw Case was not dispatched verbatim: ${JSON.stringify(rawCaseTurnText)}`)
    }

    if (rendererErrors.length) throw new Error(`Renderer console errors: ${rendererErrors.join(" | ")}`)
    const screenshotPath = process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT
    if (screenshotPath) {
        if (process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT_SURFACE === "operator") {
            await inspect(window, 'document.querySelector("[data-surface=operator]").click()')
            await inspect(window, 'document.querySelector("#operator-new-job").click()')
            await waitFor(window, '!document.querySelector("#operator-setup-form").classList.contains("hidden")')
            await inspect(window, `(() => {
                const details = document.querySelector("#operator-automation-boundary")
                details.open = true
                details.scrollIntoView({block: "center"})
            })()`)
        } else if (process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT_SURFACE === "rubric") {
            await inspect(window, 'document.querySelector("[data-surface=evaluation]").click()')
            await inspect(window, 'document.querySelector("[data-evaluation-view=cases]").click()')
            await waitFor(window, 'document.querySelector("[data-evaluation-case-id=case-smoke]")')
            await inspect(window, 'document.querySelector("#manage-dataset-rubric").click()')
            await waitFor(window, 'document.querySelector("#rubric-drawer").classList.contains("visible")')
            await inspect(window, 'document.querySelector("#rubric-drawer .curation-reference-card")?.setAttribute("open", "")')
        } else if (process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT_SURFACE === "export") {
            await inspect(window, 'document.querySelector("[data-surface=evaluation]").click()')
            await inspect(window, 'document.querySelector("[data-evaluation-view=cases]").click()')
            await waitFor(window, 'document.querySelector("[data-evaluation-case-id=case-smoke]")')
            await inspect(window, 'document.querySelector("#export-evaluation-dataset").click()')
            await waitFor(window, 'document.querySelector("#export-dataset-dialog").open')
            await inspect(window, 'document.querySelector("#export-case-scope").value = "goodcase"')
            await inspect(window, 'document.querySelector("#export-output-mode").value = "original"')
        } else if (process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT_SURFACE === "skills") {
            await inspect(window, 'document.querySelector("[data-surface=skills]").click()')
            await waitFor(window, 'document.querySelector("[data-managed-skill-id=managed-skill-smoke]")')
            await inspect(window, 'document.querySelector("[data-managed-skill-id=managed-skill-smoke]").click()')
            await waitFor(window, 'document.querySelector(".managed-skill-manifest")')
        } else {
            await inspect(window, 'document.querySelector("[data-thread-view=current]").click()')
            await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
            await inspect(window, 'document.querySelector("#conversation-scroll").scrollTop = 0')
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
        writeFileSync(screenshotPath, (await window.capturePage()).toPNG())
    }
    process.stdout.write(
        `${JSON.stringify({
            markdown: true,
            activityCards: markdownAndActivity.activity.length,
            perThreadDrafts: true,
            newTaskDraft: true,
            restoredScrollTop: restoredAlphaPosition,
            streamingPositionHeld: true,
            boundedStreamingRender: true,
            backgroundNotificationRouting: true,
            backgroundThreadCatchUp: true,
            operatorHiddenDeltaIsolated: true,
            operatorHiddenCatchUp: hiddenCatchUp.complete,
            operatorPerJobViewState: true,
            operatorGapCatchUpPages: operatorGapMetrics.calls,
            operatorApprovalResolved: true,
            operatorStopChatIsolated: true,
            operatorDelegatedActions: true,
            operatorAutomationBoundary: operatorCreateInput.budget,
            operatorAutomationBoundaryNarrow: true,
            operatorEpochOnlySetup: epochOnlySetup,
            optimizationOneActionStart: true,
            optimizationActionableRetry: true,
            optimizationTaskTitle: optimizationChrome.sessionTitle,
            operatorActionButtons: optimizationChrome.actions,
            optimizationHiddenProgressIsolated: true,
            optimizationTwoEpochTrend: optimizationEvidenceAfterSwitch.timeline,
            optimizationFinalApproval: finalApprovalId,
            optimizationFormalInstall: "released-install-smoke",
            optimizationComposerPinned: optimizationEvidenceBeforeSwitch.composerSticky,
            readFailureRecovered: true,
            emptyArchiveLoadCancelled: true,
            staleRuntimeModelsIgnored: true,
            inlineCurationFailure: true,
            caseCardUsesInitialQuestion: true,
            caseCalibrationDrawer: true,
            automaticCalibrationDone: true,
            automaticCalibrationStop: true,
            datasetExportChoices: true,
            datasetRubric: true,
            rubricActivityPatched: true,
            evaluationDurationMinuteSecond: true,
            curatorLiveActivity: true,
            curatorActivityBackpressure: curationBurst.mutations <= 12,
            curatorReferenceCard: true,
            curatorDraftRemainsSaveable: true,
            curatorDraftPreservedOnEffortChange: true,
            badcaseFailureLed: true,
            settingsActionsPinned: true,
            rawCaseInbox: true,
            rawCaseEdit: true,
            rawCaseVerbatimDispatch: true,
            sourceCaseRangeMarker: true,
            managedSkillRepositories: true,
            managedSkillInstallations: true,
            rendererControlEvaluationStartCancel: true,
            rendererControlRuntimeList: true,
            managedSkillGridColumns: managedSkillSurface.gridColumns,
            managedSkillPanelRects: managedSkillSurface.panelRects,
            rendererErrors: 0,
        })}\n`,
    )
    window.destroy()
}

run()
    .then(() => {
        operatorFixture?.close()
        rmSync(temporaryDirectory, {recursive: true, force: true})
        app.quit()
    })
    .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`)
        operatorFixture?.close()
        rmSync(temporaryDirectory, {recursive: true, force: true})
        app.exit(1)
    })
