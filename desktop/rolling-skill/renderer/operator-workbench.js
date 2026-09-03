(function operatorWorkbenchModule(globalObject) {
    "use strict"

    const OPERATOR_DELTA_INTERVAL_MS = 64
    const SUMMARY_PAGE_LIMIT = 100
    const MAX_SUMMARY_PAGES = 50
    const MAX_STALE_CURSOR_RETRIES = 2

    function modelId(model) {
        return String(model?.id ?? model?.modelId ?? model?.model ?? model ?? "").trim()
    }

    function runtimeBaseLabel(runtime = {}) {
        const name = String(
            runtime.displayName ?? runtime.providerId ?? runtime.runtimeId ?? "Runtime",
        ).trim() || "Runtime"
        const version = String(runtime.version ?? "").trim()
        return version && !name.includes(version) ? `${name} ${version}` : name
    }

    function runtimeDisplayParts(runtime = {}) {
        const base = runtimeBaseLabel(runtime)
        const detail = [runtime.executablePath, runtime.source, runtime.runtimeId]
            .map((value) => String(value ?? "").trim())
            .find((value) => value && value !== base)
        return {base, detail: detail ?? ""}
    }

    function runtimeDisplayLabel(runtime = {}, catalog = []) {
        const {base, detail} = runtimeDisplayParts(runtime)
        return detail ? `${base} · ${detail}` : base
    }

    function catalogForRuntime(catalogs, runtimeId) {
        const source = catalogs?.modelsByRuntime
        if (source instanceof Map) return source.get(runtimeId) ?? []
        return source?.[runtimeId] ?? []
    }

    function optimizationCatalogRuntime(catalogs, runtimeId) {
        const runtimes = Array.isArray(catalogs?.runtimes) ? catalogs.runtimes : []
        return runtimes.find((entry) => entry?.runtimeId === runtimeId) ?? null
    }

    function optimizationSelection(value, catalogs, label) {
        const runtimeId = String(value?.runtimeId ?? "").trim()
        const model = String(value?.modelId ?? "").trim()
        const effort = String(value?.effort ?? "").trim()
        const runtime = optimizationCatalogRuntime(catalogs, runtimeId)
        if (!runtime) throw new Error(`${label} Runtime is not in the capability catalog`)
        const catalogModels = catalogForRuntime(catalogs, runtimeId)
        const models = catalogModels.length
            ? catalogModels
            : Array.isArray(runtime.models) ? runtime.models : []
        const selectedModel = models.find((entry) => modelId(entry) === model) ?? null
        if (!model || !selectedModel) throw new Error(`${label} model is not in the Runtime catalog`)
        const efforts = selectedModel.reasoningEfforts ??
            selectedModel.supportedReasoningEfforts ??
            selectedModel.supportedEfforts ??
            runtime.efforts ?? []
        const normalizedEfforts = efforts.map((entry) => String(
            entry?.reasoningEffort ?? entry?.effort ?? entry?.value ?? entry,
        ))
        if (effort && !normalizedEfforts.includes(effort)) {
            throw new Error(`${label} effort is not in the Runtime catalog`)
        }
        return {
            runtimeId,
            modelId: model,
            ...(effort ? {effort} : {}),
        }
    }

    function requiredOptimizationNumber(value, label, {integer = false, minimum = 0, maximum} = {}) {
        const numeric = Number(value)
        if (
            !Number.isFinite(numeric) ||
            (integer && !Number.isSafeInteger(numeric)) ||
            numeric < minimum ||
            (maximum !== undefined && numeric > maximum)
        ) throw new TypeError(`${label} is invalid`)
        return numeric
    }

    function optionalOptimizationInteger(value, label, maximum) {
        if (value === "" || value === null || value === undefined) return null
        return requiredOptimizationNumber(value, label, {integer: true, minimum: 0, maximum})
    }

    function runtimeTelemetry(runtime, capability) {
        const capabilities = Array.isArray(runtime?.capabilities) ? runtime.capabilities : []
        return capabilities.includes(capability)
    }

    function buildOptimizationConfig(values = {}, catalogs = {}) {
        const skills = Array.isArray(catalogs.skills) ? catalogs.skills : []
        const versions = Array.isArray(catalogs.versions) ? catalogs.versions : []
        const datasets = Array.isArray(catalogs.datasets) ? catalogs.datasets : []
        const skill = skills.find((entry) => entry?.id === values.skillId) ?? null
        if (!skill) throw new Error("Optimization Skill is not in the managed Skill catalog")
        const baseline = versions.find((entry) => entry?.id === values.baselineVersionId) ?? null
        if (
            !baseline ||
            baseline.state !== "released" ||
            baseline.skillId !== skill.id ||
            baseline.repositoryId !== skill.repositoryId
        ) throw new Error("Optimization baseline must be a matching Released version")
        const dataset = datasets.find((entry) => entry?.id === values.datasetId) ?? null
        if (!dataset) throw new Error("Optimization Dataset is not in the catalog")
        if (
            dataset.skillReference?.id !== skill.id ||
            dataset.skillReference?.repositoryId !== skill.repositoryId
        ) throw new Error("Optimization Dataset and Skill binding do not match")
        if (typeof dataset.activeRubricVersionId !== "string" || !dataset.activeRubricVersionId) {
            throw new Error("Optimization Dataset requires a published Rubric")
        }

        const operator = optimizationSelection(values.operator, catalogs, "Operator")
        const rawTargets = Array.isArray(values.targets) ? values.targets : []
        if (!rawTargets.length) throw new Error("Optimization requires at least one target Runtime")
        const targets = rawTargets.map((entry, index) => (
            optimizationSelection(entry, catalogs, `Target ${index + 1}`)
        ))
        if (new Set(targets.map((entry) => entry.runtimeId)).size !== targets.length) {
            throw new Error("Optimization target Runtime ids must be unique")
        }
        const judge = optimizationSelection(values.judge, catalogs, "Judge")
        const mode = String(values.mode ?? "").trim()
        if (!["fixed", "adaptive"].includes(mode)) {
            throw new Error("Optimization mode must be fixed or adaptive")
        }
        const activationMode = String(values.activationMode ?? "").trim()
        if (!["automatic", "explicit"].includes(activationMode)) {
            throw new Error("Optimization activation mode must be automatic or explicit")
        }

        const maxEpochs = requiredOptimizationNumber(values.limits?.maxEpochs, "Optimization max Epochs", {
            integer: true,
            minimum: 1,
            maximum: 100,
        })
        const limits = {
            maxEpochs,
            maxDurationMs: requiredOptimizationNumber(
                values.limits?.maxDurationMs,
                "Optimization max duration",
                {integer: true, minimum: 1, maximum: 30 * 24 * 60 * 60 * 1_000},
            ),
            patience: requiredOptimizationNumber(values.limits?.patience, "Optimization patience", {
                integer: true,
                minimum: 1,
                maximum: maxEpochs,
            }),
            minimumImprovement: requiredOptimizationNumber(
                values.limits?.minimumImprovement,
                "Optimization minimum improvement",
                {minimum: 0, maximum: 100},
            ),
            maxTurns: optionalOptimizationInteger(values.limits?.maxTurns, "Optimization max turns", 1_000_000),
            maxTokens: optionalOptimizationInteger(
                values.limits?.maxTokens,
                "Optimization max tokens",
                1_000_000_000_000,
            ),
            maxCostMicros: optionalOptimizationInteger(
                values.limits?.maxCostMicros,
                "Optimization max cost",
                Number.MAX_SAFE_INTEGER,
            ),
        }
        const target = {
            minimumScore: requiredOptimizationNumber(
                values.target?.minimumScore,
                "Optimization minimum score",
                {minimum: 0, maximum: 100},
            ),
            minimumPassRate: requiredOptimizationNumber(
                values.target?.minimumPassRate,
                "Optimization minimum pass rate",
                {minimum: 0, maximum: 1},
            ),
            requireCriticalCases: values.target?.requireCriticalCases === true,
        }
        if (typeof values.target?.requireCriticalCases !== "boolean") {
            throw new TypeError("Optimization critical Case target must be boolean")
        }

        const selectedRuntimes = [operator, ...targets, judge].map((selection) => (
            optimizationCatalogRuntime(catalogs, selection.runtimeId)
        ))
        const telemetry = {
            tokens: selectedRuntimes.every((runtime) => runtimeTelemetry(runtime, "token-usage")),
            cost: selectedRuntimes.every((runtime) => runtimeTelemetry(runtime, "cost-usage")),
        }
        if (limits.maxTokens > 0 && !telemetry.tokens) {
            throw new Error("A hard token budget requires token telemetry from every Runtime")
        }
        if (limits.maxCostMicros > 0 && !telemetry.cost) {
            throw new Error("A hard cost budget requires cost telemetry from every Runtime")
        }
        return {
            skillId: skill.id,
            baselineVersionId: baseline.id,
            datasetId: dataset.id,
            operator,
            targets,
            judge,
            activationMode,
            mode,
            limits,
            target,
            telemetry,
        }
    }

    function cloneOptimizationSummary(value, seen = new Set()) {
        if (value === null || typeof value !== "object") return value
        if (seen.has(value)) throw new TypeError("Optimization summary must not be cyclic")
        seen.add(value)
        const copy = Array.isArray(value)
            ? value.map((entry) => cloneOptimizationSummary(entry, seen))
            : Object.fromEntries(Object.entries(value).map(([key, entry]) => (
                [key, cloneOptimizationSummary(entry, seen)]
            )))
        seen.delete(value)
        return copy
    }

    function reduceOptimizationTimeline(previous, run) {
        if (!run || typeof run !== "object" || typeof run.id !== "string" || !run.id) {
            throw new TypeError("Optimization Run summary is invalid")
        }
        const revision = Number.isSafeInteger(run.revision) ? run.revision : 0
        if (previous?.id === run.id && Number.isSafeInteger(previous.revision) && revision <= previous.revision) {
            return previous
        }
        const summary = cloneOptimizationSummary(run)
        summary.revision = revision
        summary.epochs = (Array.isArray(summary.epochs) ? summary.epochs : [])
            .filter((epoch) => Number.isSafeInteger(epoch?.number) && epoch.number > 0)
            .sort((left, right) => left.number - right.number)
        summary.scoreTrend = summary.epochs
            .filter((epoch) => (
                Number.isFinite(epoch.analysis?.score) && Number.isFinite(epoch.analysis?.passRate)
            ))
            .map((epoch) => ({
                epoch: epoch.number,
                score: epoch.analysis.score,
                passRate: epoch.analysis.passRate,
            }))
        summary.stopReason = summary.checkpoint?.stopReason ?? summary.stopReason ?? null
        summary.recoveryTargets = Array.isArray(summary.checkpoint?.recoveryTargets)
            ? cloneOptimizationSummary(summary.checkpoint.recoveryTargets)
            : []
        return summary
    }

    function optimizationRunActions(run = {}) {
        if (run.state === "restoring") return ["report"]
        if (run.state === "waiting_approval") return ["report"]
        if (run.state === "needs_recovery") {
            return run.checkpoint?.paused === true ? ["resume", "stop", "report"] : ["report"]
        }
        if (run.state === "paused") {
            return ["resume", "stop", "report"]
        }
        if (["succeeded", "failed", "cancelled"].includes(run.state)) return ["report"]
        return ["pause", "stop", "report"]
    }

    function optimizationPreflightSummary(preflight = {}, config = {}) {
        return {
            ready: preflight.ready === true,
            frozen: {
                snapshotDigest: preflight.snapshotDigest ?? null,
                baselineVersionId: preflight.baseline?.versionId ?? null,
                baselineDigest: preflight.baseline?.contentDigest ?? null,
                datasetId: preflight.dataset?.id ?? null,
                datasetRevision: preflight.dataset?.revision ?? null,
                rubricId: preflight.rubric?.id ?? null,
                rubricVersion: preflight.rubric?.version ?? null,
            },
            runtimeMatrix: cloneOptimizationSummary(preflight.targets ?? config.targets ?? []),
            telemetry: cloneOptimizationSummary(config.telemetry ?? {tokens: false, cost: false}),
            approvals: ["release-install"],
        }
    }

    function remainingOptimizationBudget(limit, used) {
        if (!Number.isFinite(limit) || !Number.isFinite(used)) return null
        return Math.max(0, limit - used)
    }

    function optimizationPanelView(run = {}) {
        const epochs = Array.isArray(run.epochs) ? run.epochs : []
        const epoch = epochs.findLast?.((entry) => entry.number === run.currentEpoch) ?? epochs.at(-1) ?? null
        const usage = run.checkpoint?.telemetry ?? {}
        return {
            id: run.id ?? null,
            state: run.state ?? null,
            currentEpoch: run.currentEpoch ?? 0,
            baseline: cloneOptimizationSummary(run.baseline ?? {}),
            dataset: cloneOptimizationSummary(run.dataset ?? {}),
            rubric: cloneOptimizationSummary(run.rubric ?? {}),
            candidate: cloneOptimizationSummary(epoch?.candidate ?? null),
            installations: cloneOptimizationSummary(epoch?.installations ?? []),
            scoreTrend: cloneOptimizationSummary(run.scoreTrend ?? []),
            regressionCount: Number.isSafeInteger(epoch?.analysis?.regressionCount)
                ? epoch.analysis.regressionCount
                : 0,
            remaining: {
                durationMs: remainingOptimizationBudget(run.limits?.maxDurationMs, usage.elapsedMs),
                turns: remainingOptimizationBudget(run.limits?.maxTurns, usage.turnsUsed),
                tokens: remainingOptimizationBudget(run.limits?.maxTokens, usage.tokens),
                costMicros: remainingOptimizationBudget(run.limits?.maxCostMicros, usage.costMicros),
            },
            stopReason: run.stopReason ?? run.checkpoint?.stopReason ?? null,
            recoveryTargets: cloneOptimizationSummary(run.recoveryTargets ?? run.checkpoint?.recoveryTargets ?? []),
            reportArtifactId: run.checkpoint?.reportArtifactId ?? null,
            release: {
                approvalId: run.checkpoint?.finalApprovalId ?? run.checkpoint?.releaseApprovalId ?? null,
                releasedVersionId: run.checkpoint?.releasedVersionId ?? null,
                installArtifactId: run.checkpoint?.releasedInstallArtifactId ?? null,
            },
            actions: optimizationRunActions(run),
        }
    }

    function optimizationFinalApproval(snapshot = {}) {
        if (!snapshot?.job?.id) return null
        const jobIds = operatorJobTreeIds(snapshot)
        return (Array.isArray(snapshot.approvals) ? snapshot.approvals : []).find((approval) => (
            approval.status === "pending" &&
            approval.action === "optimization.release-install" &&
            jobIds.has(approval.jobId ?? snapshot.job.id)
        )) ?? null
    }

    function optimizationFinalApprovalView(run = {}, approval = null) {
        const epochs = Array.isArray(run.epochs) ? run.epochs : []
        const epoch = epochs.findLast?.((entry) => entry.number === run.currentEpoch) ?? epochs.at(-1) ?? {}
        const analysis = epoch.analysis ?? {}
        return {
            approvalId: approval?.id ?? run.checkpoint?.finalApprovalId ?? null,
            candidateVersionId: epoch.candidate?.versionId ?? null,
            score: Number.isFinite(analysis.score) ? analysis.score : null,
            passRate: Number.isFinite(analysis.passRate) ? analysis.passRate : null,
            regressionCount: Number.isSafeInteger(analysis.regressionCount)
                ? analysis.regressionCount
                : null,
            runtimeIds: [...new Set((Array.isArray(run.targets) ? run.targets : [])
                .map((target) => String(target?.runtimeId ?? "").trim())
                .filter(Boolean))],
            risk: typeof approval?.risk === "string" ? approval.risk : null,
        }
    }

    function buildOperatorSessionRequest(values = {}, catalogs = {}) {
        const runtimes = Array.isArray(catalogs.runtimes) ? catalogs.runtimes : []
        const runtime = runtimes.find((entry) => entry.runtimeId === values.runtimeId)
        if (!runtime) throw new Error("Operator Runtime is not in the capability catalog")
        const models = catalogForRuntime(catalogs, runtime.runtimeId)
        const selectedModelId = String(values.modelId ?? "").trim()
        if (selectedModelId && !models.some((entry) => modelId(entry) === selectedModelId)) {
            throw new Error("Operator model is not in the Runtime catalog")
        }
        const selectedEffort = String(values.effort ?? "").trim()
        const selectedModel = models.find((entry) => modelId(entry) === selectedModelId) ?? null
        const modelEfforts = selectedModel?.reasoningEfforts ??
            selectedModel?.supportedReasoningEfforts ??
            selectedModel?.supportedEfforts ?? []
        const availableEfforts = (modelEfforts.length ? modelEfforts : runtime.efforts ?? [])
            .map((entry) => String(entry?.reasoningEffort ?? entry?.effort ?? entry?.value ?? entry))
        if (selectedEffort && !availableEfforts.includes(selectedEffort)) {
            throw new Error("Operator effort is not in the Runtime catalog")
        }

        const objective = String(values.objective ?? "")
        if (!objective.trim()) throw new TypeError("Operator objective is required")
        const runtimeIds = [...new Set(values.targetRuntimeIds ?? [])]
        if (runtimeIds.some((id) => !runtimes.some((entry) => entry.runtimeId === id))) {
            throw new Error("A target Runtime is not in the capability catalog")
        }
        const skills = Array.isArray(catalogs.skills) ? catalogs.skills : []
        const skill = values.skillId
            ? skills.find((entry) => entry.id === values.skillId) ?? null
            : null
        if (values.skillId && !skill) throw new Error("Managed Skill is not in the catalog")
        const datasets = Array.isArray(catalogs.datasets) ? catalogs.datasets : []
        if (values.datasetId && !datasets.some((entry) => entry.id === values.datasetId)) {
            throw new Error("Dataset is not in the catalog")
        }
        const maxIterations = Number(values.maxIterations)
        if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
            throw new TypeError("Operator maxIterations must be a positive safe integer")
        }
        return {
            runtimeId: runtime.runtimeId,
            ...(selectedModelId ? {modelId: selectedModelId} : {}),
            ...(selectedEffort ? {effort: selectedEffort} : {}),
            objective,
            actions: operatorSessionActions(values.allowPermanentDelete === true),
            scopes: {
                skillIds: skill ? [skill.id] : [],
                datasetIds: values.datasetId ? [values.datasetId] : [],
                runtimeIds,
                repositoryIds: skill?.repositoryId ? [skill.repositoryId] : [],
            },
            budget: {maxIterations},
            ...(skill ? {managedSkillBinding: {
                repositoryId: skill.repositoryId,
                skillId: skill.id,
            }} : {}),
        }
    }

    function translatedText(translate, key, fallback = key) {
        const value = typeof translate === "function" ? translate(key) : key
        return typeof value === "string" && value && value !== key ? value : fallback
    }

    function formattedText(formatMessage, translate, key, values = {}, fallback = key) {
        const value = typeof formatMessage === "function" ? formatMessage(key, values) : key
        const template = typeof value === "string" && value && value !== key
            ? value
            : translatedText(translate, key, fallback)
        return template.replace(/\{(\w+)\}/gu, (match, name) =>
            values[name] === undefined ? match : String(values[name]),
        )
    }

    function artifactDeepLinks(artifact = {}, translate = null, formatMessage = null) {
        const metadata = artifact?.metadata && typeof artifact.metadata === "object"
            ? artifact.metadata
            : {}
        const installationIds = [
            metadata.installationId,
            ...(Array.isArray(metadata.installationIds) ? metadata.installationIds.slice(0, 100) : []),
        ]
        const candidates = [
            ["dataset", metadata.datasetId, "operatorArtifactDataset", "Dataset"],
            ["case", metadata.caseId, "operatorArtifactCase", "Case"],
            ["evaluation", metadata.evaluationId ?? metadata.runId, "operatorArtifactEvaluation", "Evaluation"],
            ["candidate", metadata.candidateId ?? metadata.versionId, "operatorArtifactCandidate", "Candidate"],
            ...installationIds.map((id) => ["installation", id, "operatorArtifactInstallation", "Installation"]),
        ]
        const seen = new Set()
        return candidates
            .filter(([kind, id]) => {
                if (typeof id !== "string" || !id) return false
                const key = `${kind}:${id}`
                if (seen.has(key)) return false
                seen.add(key)
                return true
            })
            .map(([kind, id, key, fallback]) => ({
                kind,
                id,
                label: formattedText(formatMessage, translate, key, {id}, `${fallback} {id}`),
            }))
    }

    function recordId(value, prefix) {
        if (typeof value?.id === "string" && value.id) return `${prefix}:${value.id}`
        if (Number.isSafeInteger(value?.sequence)) {
            return `${prefix}:${value.sessionId ?? ""}:${value.jobId ?? ""}:${value.sequence}`
        }
        return `${prefix}:${JSON.stringify(value ?? null)}`
    }

    function transcriptEntryKey(entry) {
        return recordId(entry, "entry")
    }

    function copyMapValues(map) {
        return [...map.values()].map((value) => ({...value}))
    }

    function emptyUnread() {
        return {events: 0, approvals: 0, artifacts: 0}
    }

    function emptySnapshot(job, preserved = null) {
        return {
            job,
            session: null,
            jobs: new Map(),
            steps: new Map(),
            approvals: new Map(),
            artifacts: preserved?.artifacts ?? new Map(),
            events: preserved?.events ?? new Map(),
            transcript: preserved?.transcript ?? new Map(),
            unread: preserved?.unread ?? emptyUnread(),
            view: preserved?.view ?? {draft: "", scrollTop: 0},
            needsDetailCatchUp: preserved?.needsDetailCatchUp ?? true,
        }
    }

    function createOperatorWorkbenchState(options = {}) {
        const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
        const cancel = options.cancel ?? ((handle) => clearTimeout(handle))
        const readSummaryPage = options.readSummaryPage ?? null
        const readOperatorSession = options.readOperatorSession ?? null
        const readArtifactPage = options.readArtifactPage ?? null
        const onActivePatch = options.onActivePatch ?? (() => {})
        const onActiveReset = options.onActiveReset ?? (() => {})
        const onListPatch = options.onListPatch ?? (() => {})

        let generation = null
        let revision = 0
        let visible = false
        let activeSessionId = null
        let activeJobId = null
        let snapshots = new Map()
        let sessions = new Map()
        let jobs = new Map()
        let entityRevisions = new Map()
        let catchUpPromise = null
        let patchTimer = null
        let destroyed = false
        let operationEpoch = 0
        let selectionEpoch = 0
        const dirtyEntries = new Map()
        const detailCatchUps = new Map()
        const staleGenerations = new Set()

        function rootJob(jobId) {
            let current = jobs.get(jobId) ?? null
            const visited = new Set()
            while (current?.parentJobId && !visited.has(current.id)) {
                visited.add(current.id)
                current = jobs.get(current.parentJobId) ?? current
                if (current.id === current.parentJobId) break
            }
            return current?.parentJobId ? null : current
        }

        function rootForSession(sessionId) {
            for (const job of jobs.values()) {
                if (job.sessionId === sessionId && !job.parentJobId) return job
            }
            return null
        }

        function snapshotForRecord(value) {
            const root = value?.jobId ? rootJob(value.jobId) : rootForSession(value?.sessionId)
            return root ? snapshots.get(root.id) ?? null : null
        }

        function rebuild(nextSessions, nextJobs, pages, {preserve = true, summaryRevision = revision} = {}) {
            const previous = snapshots
            sessions = nextSessions
            jobs = nextJobs
            snapshots = new Map()
            entityRevisions = new Map()
            for (const job of jobs.values()) {
                entityRevisions.set(`job:${job.id}`, summaryRevision)
                if (job.parentJobId) continue
                snapshots.set(job.id, emptySnapshot(job, preserve ? previous.get(job.id) : null))
            }
            for (const job of jobs.values()) {
                const root = rootJob(job.id)
                const snapshot = root ? snapshots.get(root.id) : null
                if (!snapshot) continue
                snapshot.jobs.set(job.id, job)
                if (job.id === root.id) snapshot.job = job
            }
            for (const session of sessions.values()) {
                entityRevisions.set(`session:${session.id}`, summaryRevision)
                const root = rootForSession(session.id)
                if (root) snapshots.get(root.id).session = session
            }
            for (const page of pages) {
                for (const step of page.steps ?? []) {
                    const snapshot = snapshotForRecord(step)
                    if (step?.id) entityRevisions.set(`step:${step.id}`, summaryRevision)
                    if (snapshot?.steps && step?.id) snapshot.steps.set(step.id, step)
                }
                for (const approval of page.approvals ?? []) {
                    const snapshot = snapshotForRecord(approval)
                    if (snapshot?.approvals && approval?.id) {
                        entityRevisions.set(`approval:${approval.id}`, summaryRevision)
                        snapshot.approvals.set(recordId(approval, "approval"), approval)
                    }
                }
            }
            const activeRoot = activeSessionId ? rootForSession(activeSessionId) : null
            activeJobId = activeRoot?.id ?? null
        }

        function replacePages(pages, {preserve = true} = {}) {
            const nextSessions = new Map()
            const nextJobs = new Map()
            for (const page of pages) {
                for (const session of page.sessions ?? []) {
                    if (session?.id) nextSessions.set(session.id, session)
                }
                for (const job of page.jobs ?? []) {
                    if (job?.id) nextJobs.set(job.id, job)
                }
            }
            const summaryRevision = Number.isSafeInteger(pages[0]?.revision)
                ? pages[0].revision
                : revision
            rebuild(nextSessions, nextJobs, pages, {preserve, summaryRevision})
        }

        function initialize(page) {
            if (destroyed) return
            generation = typeof page?.generation === "string" ? page.generation : null
            revision = Number.isSafeInteger(page?.revision) ? page.revision : 0
            replacePages([page ?? {}], {preserve: false})
        }

        function updateSession(session) {
            if (!session?.id) return null
            sessions.set(session.id, {...(sessions.get(session.id) ?? {}), ...session})
            const root = rootForSession(session.id)
            if (!root) return null
            const snapshot = snapshots.get(root.id)
            snapshot.session = sessions.get(session.id)
            return snapshot
        }

        function updateJob(job) {
            if (!job?.id) return null
            jobs.set(job.id, {...(jobs.get(job.id) ?? {}), ...job})
            const root = rootJob(job.id)
            if (!root) return null
            if (!snapshots.has(root.id)) snapshots.set(root.id, emptySnapshot(root))
            const snapshot = snapshots.get(root.id)
            snapshot.jobs.set(job.id, jobs.get(job.id))
            if (job.id === root.id) snapshot.job = jobs.get(job.id)
            const session = sessions.get(root.sessionId)
            if (session) snapshot.session = session
            return snapshot
        }

        function updateRecord(kind, value) {
            if (!value || typeof value !== "object") return {snapshot: null, inserted: false}
            if (kind === "changed") {
                const snapshot = value.job
                    ? updateJob(value.job)
                    : value.session
                    ? updateSession(value.session)
                    : value.step
                    ? snapshotForRecord(value.step)
                    : null
                if (snapshot && value.step?.id) snapshot.steps.set(value.step.id, value.step)
                return {snapshot, inserted: Boolean(snapshot)}
            }
            const item = value[kind]
            const snapshot = snapshotForRecord(item)
            if (!snapshot || !item) return {snapshot: null, inserted: false}
            const collection = kind === "event"
                ? snapshot.events
                : kind === "approval"
                ? snapshot.approvals
                : snapshot.artifacts
            const key = recordId(item, kind)
            const inserted = !collection.has(key)
            collection.set(key, {...(collection.get(key) ?? {}), ...item})
            if (inserted && value.hydrate !== true && (!visible || snapshot.job.id !== activeJobId)) {
                const unreadKey = kind === "event" ? "events" : `${kind}s`
                snapshot.unread[unreadKey] += 1
            }
            return {snapshot, inserted}
        }

        function entityRevisionKey(kind, envelope) {
            if (kind === "approval" && envelope.approval?.id) {
                return `approval:${envelope.approval.id}`
            }
            if (kind !== "changed") return null
            if (envelope.job?.id) return `job:${envelope.job.id}`
            if (envelope.session?.id) return `session:${envelope.session.id}`
            if (envelope.step?.id) return `step:${envelope.step.id}`
            return null
        }

        function cancelActivePatch() {
            if (patchTimer !== null) cancel(patchTimer)
            patchTimer = null
            dirtyEntries.clear()
        }

        function scheduleActivePatch(entry, snapshot) {
            if (destroyed || !entry || !visible || snapshot?.job?.id !== activeJobId) return
            dirtyEntries.set(transcriptEntryKey(entry), {...entry})
            if (patchTimer !== null) return
            const scheduledJobId = activeJobId
            patchTimer = schedule(() => {
                patchTimer = null
                if (destroyed || !visible || activeJobId !== scheduledJobId) {
                    dirtyEntries.clear()
                    return
                }
                const entries = [...dirtyEntries.values()].sort(compareTranscriptEntries)
                dirtyEntries.clear()
                onActivePatch({
                    jobId: scheduledJobId,
                    entryKeys: entries.map(transcriptEntryKey),
                    entries,
                })
            }, OPERATOR_DELTA_INTERVAL_MS)
        }

        function staleCursor(error) {
            let current = error
            for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
                const code = typeof current === "object" ? current.code : null
                const message = typeof current === "string" ? current : current?.message
                if (code === "OPERATOR_SNAPSHOT_CHANGED" || code === "STALE_CURSOR") return true
                if (/OPERATOR_SNAPSHOT_CHANGED|stale[^\n]*cursor|cursor[^\n]*stale/iu.test(message ?? "")) {
                    return true
                }
                current = typeof current === "object" ? current.cause : null
            }
            return false
        }

        async function readAllSummaryPages(epoch) {
            if (typeof readSummaryPage !== "function") {
                throw new Error("Operator summary reader is unavailable")
            }
            for (let attempt = 0; attempt <= MAX_STALE_CURSOR_RETRIES; attempt += 1) {
                const pages = []
                const seenCursors = new Set()
                let cursor = null
                let expectedGeneration = null
                let expectedRevision = null
                try {
                    for (let pageIndex = 0; pageIndex < MAX_SUMMARY_PAGES; pageIndex += 1) {
                        if (destroyed || epoch !== operationEpoch) return null
                        const page = await readSummaryPage(cursor, SUMMARY_PAGE_LIMIT)
                        if (destroyed || epoch !== operationEpoch) return null
                        if (pageIndex === 0) {
                            expectedGeneration = page?.generation ?? null
                            expectedRevision = page?.revision ?? 0
                        } else if (
                            page?.generation !== expectedGeneration ||
                            page?.revision !== expectedRevision
                        ) {
                            const error = new Error("Operator summary cursor became stale")
                            error.code = "STALE_CURSOR"
                            throw error
                        }
                        pages.push(page ?? {})
                        const nextCursor = page?.nextCursor ?? null
                        if (nextCursor === null) return pages
                        const cursorKey = JSON.stringify(nextCursor)
                        if (seenCursors.has(cursorKey)) {
                            throw new Error("Operator summary pagination repeated a cursor")
                        }
                        seenCursors.add(cursorKey)
                        cursor = nextCursor
                    }
                    throw new Error(`Operator summary exceeded ${MAX_SUMMARY_PAGES} pages`)
                } catch (error) {
                    if (!staleCursor(error) || attempt === MAX_STALE_CURSOR_RETRIES) throw error
                }
            }
            throw new Error("Operator summary catch-up failed")
        }

        async function readAllArtifactPages(snapshot, epoch) {
            if (typeof readArtifactPage !== "function") return snapshot.artifacts
            const artifacts = new Map()
            for (const job of [...snapshot.jobs.values()].slice(0, SUMMARY_PAGE_LIMIT)) {
                const seenCursors = new Set()
                let cursor = null
                for (let pageIndex = 0; pageIndex < MAX_SUMMARY_PAGES; pageIndex += 1) {
                    if (destroyed || epoch !== operationEpoch) return null
                    const page = await readArtifactPage(job.id, cursor, SUMMARY_PAGE_LIMIT)
                    if (destroyed || epoch !== operationEpoch) return null
                    for (const artifact of page?.artifacts ?? []) {
                        if (artifact?.id) artifacts.set(recordId(artifact, "artifact"), artifact)
                    }
                    const nextCursor = page?.nextCursor ?? null
                    if (nextCursor === null) break
                    const cursorKey = JSON.stringify(nextCursor)
                    if (seenCursors.has(cursorKey)) {
                        throw new Error("Operator artifact pagination repeated a cursor")
                    }
                    seenCursors.add(cursorKey)
                    cursor = nextCursor
                    if (pageIndex === MAX_SUMMARY_PAGES - 1) {
                        throw new Error(`Operator artifacts exceeded ${MAX_SUMMARY_PAGES} pages`)
                    }
                }
            }
            return artifacts
        }

        async function recoverDetail(jobId, {reason = "activation", notifyReset = true} = {}) {
            if (destroyed) return null
            const initial = snapshots.get(jobId)
            if (!initial || !initial.needsDetailCatchUp) return getSnapshot(jobId)
            if (detailCatchUps.has(jobId)) {
                await detailCatchUps.get(jobId)
                const latest = snapshots.get(jobId)
                if (latest?.needsDetailCatchUp && latest !== initial) {
                    return recoverDetail(jobId, {reason, notifyReset})
                }
                return getSnapshot(jobId)
            }
            if (typeof readOperatorSession !== "function") return getSnapshot(jobId)
            const recoveryGeneration = generation
            const recoveryRevision = revision
            const sessionId = initial.session?.id ?? initial.job?.sessionId
            const sessionRevisionKey = sessionId ? `session:${sessionId}` : null
            const jobRevisionKey = initial.job?.id ? `job:${initial.job.id}` : null
            const sessionRevision = sessionRevisionKey ? entityRevisions.get(sessionRevisionKey) : undefined
            const jobRevision = jobRevisionKey ? entityRevisions.get(jobRevisionKey) : undefined
            const transcriptBaseline = new Map(initial.transcript)
            const eventBaseline = new Map(initial.events)
            const artifactBaseline = new Map(initial.artifacts)
            const recoveryEpoch = operationEpoch
            const request = (async () => {
                if (!sessionId) return getSnapshot(jobId)
                const detail = await readOperatorSession(sessionId)
                const current = snapshots.get(jobId)
                if (
                    destroyed ||
                    recoveryEpoch !== operationEpoch ||
                    !current ||
                    current !== initial ||
                    generation !== recoveryGeneration
                ) {
                    return getSnapshot(jobId)
                }

                if (
                    detail?.session &&
                    entityRevisions.get(sessionRevisionKey) === sessionRevision
                ) updateSession(detail.session)
                if (
                    detail?.parentJob &&
                    entityRevisions.get(jobRevisionKey) === jobRevision
                ) updateJob(detail.parentJob)
                if (Array.isArray(detail?.session?.transcript)) {
                    const transcript = new Map()
                    for (const entry of detail.session.transcript) {
                        transcript.set(transcriptEntryKey(entry), entry)
                    }
                    if (revision > recoveryRevision) {
                        for (const [key, entry] of current.transcript) {
                            if (!transcriptBaseline.has(key) || transcriptBaseline.get(key) !== entry) {
                                transcript.set(key, entry)
                            }
                        }
                    }
                    current.transcript = transcript
                    for (const [key, entry] of current.events) {
                        const changedDuringRecovery = !eventBaseline.has(key) || eventBaseline.get(key) !== entry
                        if (!changedDuringRecovery && transcript.has(transcriptEntryKey(entry))) {
                            current.events.delete(key)
                        }
                    }
                }
                const artifacts = await readAllArtifactPages(current, recoveryEpoch)
                if (
                    destroyed ||
                    artifacts === null ||
                    recoveryEpoch !== operationEpoch ||
                    snapshots.get(jobId) !== current ||
                    generation !== recoveryGeneration
                ) {
                    return getSnapshot(jobId)
                }
                for (const [key, artifact] of current.artifacts) {
                    if (!artifactBaseline.has(key) || artifactBaseline.get(key) !== artifact) {
                        artifacts.set(key, artifact)
                    }
                }
                current.artifacts = artifacts
                current.needsDetailCatchUp = false
                if (notifyReset && visible && activeJobId === jobId) {
                    onActiveReset({jobId, reason})
                }
                return getSnapshot(jobId)
            })()
            detailCatchUps.set(jobId, request)
            try {
                return await request
            } finally {
                if (detailCatchUps.get(jobId) === request) detailCatchUps.delete(jobId)
            }
        }

        async function catchUp() {
            if (destroyed) return
            if (catchUpPromise) return catchUpPromise
            const epoch = operationEpoch
            catchUpPromise = (async () => {
                const pages = await readAllSummaryPages(epoch)
                if (destroyed || epoch !== operationEpoch || pages === null) return
                const first = pages[0] ?? {}
                replacePages(pages)
                generation = typeof first.generation === "string" ? first.generation : null
                revision = Number.isSafeInteger(first.revision) ? first.revision : 0
                for (const snapshot of snapshots.values()) {
                    snapshot.needsDetailCatchUp = true
                    if (!visible || snapshot.job.id !== activeJobId) snapshot.unread.events += 1
                }
                if (visible && activeJobId) {
                    await recoverDetail(activeJobId, {reason: "catch-up"})
                }
                if (visible) onListPatch({generation, revision, caughtUp: true})
            })()
            try {
                await catchUpPromise
            } finally {
                catchUpPromise = null
            }
        }

        async function ingest(kind, envelope = {}) {
            if (destroyed) return
            const incomingGeneration = typeof envelope.generation === "string"
                ? envelope.generation
                : generation
            const incomingRevision = Number.isSafeInteger(envelope.revision)
                ? envelope.revision
                : revision
            if (incomingGeneration !== generation && staleGenerations.has(incomingGeneration)) return
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const needsCatchUp = Boolean(
                    generation && incomingGeneration && incomingGeneration !== generation,
                ) || incomingRevision > revision + 1
                if (!needsCatchUp) break
                await catchUp()
                if (destroyed) return
            }

            if (incomingGeneration !== generation) {
                staleGenerations.add(incomingGeneration)
                if (staleGenerations.size > 16) staleGenerations.delete(staleGenerations.values().next().value)
                return
            }
            staleGenerations.delete(incomingGeneration)
            const revisionKey = entityRevisionKey(kind, envelope)
            if (revisionKey && incomingRevision < (entityRevisions.get(revisionKey) ?? -1)) return

            const {snapshot, inserted} = updateRecord(kind, envelope)
            if (revisionKey) entityRevisions.set(revisionKey, incomingRevision)
            if (incomingGeneration === generation && incomingRevision > revision) {
                revision = incomingRevision
            }
            if (snapshot && envelope.hydrate !== true && visible && snapshot.job.id === activeJobId) {
                if (kind !== "event") onListPatch({jobId: snapshot.job.id, kind, inserted})
                if (kind === "event") scheduleActivePatch(envelope.event, snapshot)
            }
        }

        function setVisible(nextVisible) {
            if (destroyed) return false
            const next = nextVisible === true
            if (visible === next) return false
            visible = next
            if (!visible) cancelActivePatch()
            return true
        }

        async function activateSession(sessionId) {
            if (destroyed) return null
            const selectedEpoch = ++selectionEpoch
            cancelActivePatch()
            activeSessionId = sessionId ?? null
            const root = activeSessionId ? rootForSession(activeSessionId) : null
            activeJobId = root?.id ?? null
            if (activeJobId && visible) {
                const jobId = activeJobId
                await recoverDetail(jobId, {reason: "activation", notifyReset: false})
                if (destroyed || selectedEpoch !== selectionEpoch) return null
                const snapshot = snapshots.get(jobId)
                if (
                    visible &&
                    activeJobId === jobId &&
                    snapshot &&
                    (
                        !snapshot.needsDetailCatchUp ||
                        typeof readOperatorSession !== "function"
                    )
                ) snapshot.unread = emptyUnread()
            }
            if (destroyed || selectedEpoch !== selectionEpoch) return null
            return activeJobId ? getSnapshot(activeJobId) : null
        }

        async function ensureActiveCaughtUp() {
            if (destroyed || !visible || !activeJobId) return activeJobId ? getSnapshot(activeJobId) : null
            const jobId = activeJobId
            await recoverDetail(jobId, {reason: "activation", notifyReset: false})
            if (destroyed || activeJobId !== jobId) return null
            const snapshot = snapshots.get(jobId)
            if (
                visible &&
                activeJobId === jobId &&
                snapshot &&
                (
                    !snapshot.needsDetailCatchUp ||
                    typeof readOperatorSession !== "function"
                )
            ) snapshot.unread = emptyUnread()
            return getSnapshot(jobId)
        }

        function getSnapshot(jobId) {
            const snapshot = snapshots.get(jobId)
            if (!snapshot) return null
            return {
                job: {...snapshot.job},
                session: snapshot.session ? {...snapshot.session} : null,
                jobs: copyMapValues(snapshot.jobs),
                steps: copyMapValues(snapshot.steps),
                approvals: copyMapValues(snapshot.approvals),
                artifacts: copyMapValues(snapshot.artifacts),
                events: copyMapValues(snapshot.events),
                transcript: copyMapValues(snapshot.transcript),
                unread: {...snapshot.unread},
                draft: snapshot.view.draft,
                scrollTop: snapshot.view.scrollTop,
                needsDetailCatchUp: snapshot.needsDetailCatchUp,
            }
        }

        function listSnapshots() {
            return [...snapshots.keys()].map(getSnapshot)
        }

        function setViewState(jobId, next = {}) {
            if (destroyed) return
            const snapshot = snapshots.get(jobId)
            if (!snapshot) return
            if (Object.hasOwn(next, "draft")) snapshot.view.draft = String(next.draft ?? "")
            if (Object.hasOwn(next, "scrollTop")) {
                const scrollTop = Number(next.scrollTop)
                snapshot.view.scrollTop = Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0
            }
        }

        function getViewState(jobId) {
            const snapshot = snapshots.get(jobId)
            return snapshot ? {...snapshot.view} : {draft: "", scrollTop: 0}
        }

        function destroy() {
            if (destroyed) return
            destroyed = true
            operationEpoch += 1
            selectionEpoch += 1
            cancelActivePatch()
        }

        return {
            initialize,
            ingest,
            catchUp,
            activateSession,
            ensureActiveCaughtUp,
            setVisible,
            getSnapshot,
            listSnapshots,
            setViewState,
            getViewState,
            destroy,
            get activeJobId() { return activeJobId },
            get activeSessionId() { return activeSessionId },
            get generation() { return generation },
            get revision() { return revision },
        }
    }

    function createOperatorInitializationGate(options = {}) {
        const bufferLimit = Number.isSafeInteger(options.bufferLimit) && options.bufferLimit > 0
            ? options.bufferLimit
            : 256
        const kinds = ["changed", "event", "approval", "artifact"]
        const subscribe = options.subscribe ?? (() => () => {})
        const bootstrap = options.bootstrap ?? (async () => ({}))
        const applyBootstrap = options.applyBootstrap ?? (() => {})
        const hydrate = options.hydrate ?? (async () => {})
        const ingest = options.ingest ?? (async () => {})
        const catchUp = options.catchUp ?? (async () => {})
        const afterCatchUp = options.afterCatchUp ?? (async () => {})
        const onReady = options.onReady ?? (() => {})
        const onError = options.onError ?? (() => {})
        const unsubscribers = []
        const buffered = []
        let destroyed = false
        let ready = false
        let epoch = 0
        let initializePromise = null
        let liveTail = Promise.resolve()

        function unsubscribeAll() {
            for (const unsubscribe of unsubscribers.splice(0)) {
                try {
                    unsubscribe()
                } catch (error) {
                    if (!destroyed) onError(error)
                }
            }
        }

        function resetAttempt(expectedEpoch) {
            if (!current(expectedEpoch)) return
            ready = false
            buffered.length = 0
            epoch += 1
            initializePromise = null
            liveTail = Promise.resolve()
            unsubscribeAll()
        }

        function current(expectedEpoch) {
            return !destroyed && expectedEpoch === epoch
        }

        function queueLive(kind, payload, expectedEpoch) {
            liveTail = liveTail.then(async () => {
                if (current(expectedEpoch)) await ingest(kind, payload)
            }).catch((error) => {
                if (current(expectedEpoch)) onError(error)
            })
        }

        function initialize(initial) {
            if (destroyed) return Promise.resolve()
            if (initializePromise) return initializePromise
            const expectedEpoch = epoch
            try {
                for (const kind of kinds) {
                    const unsubscribe = subscribe(kind, (payload) => {
                        if (!current(expectedEpoch)) return
                        if (!ready) {
                            if (buffered.length >= bufferLimit) buffered.shift()
                            buffered.push({kind, payload})
                        } else queueLive(kind, payload, expectedEpoch)
                    })
                    if (typeof unsubscribe === "function") unsubscribers.push(unsubscribe)
                }
            } catch (error) {
                resetAttempt(expectedEpoch)
                return Promise.reject(error)
            }
            const request = Promise.resolve().then(async () => {
                try {
                    const page = initial ?? await bootstrap()
                    if (!current(expectedEpoch)) return
                    await applyBootstrap(page)
                    if (!current(expectedEpoch)) return
                    await hydrate(page)
                    if (!current(expectedEpoch)) return

                    const initializationWindow = buffered.splice(0)
                    for (const notification of initializationWindow) {
                        await ingest(notification.kind, notification.payload)
                        if (!current(expectedEpoch)) return
                    }
                    if (initializationWindow.length) {
                        await catchUp()
                        if (!current(expectedEpoch)) return
                        await afterCatchUp()
                        if (!current(expectedEpoch)) return
                    }

                    ready = true
                    for (const notification of buffered.splice(0)) {
                        queueLive(notification.kind, notification.payload, expectedEpoch)
                    }
                    await liveTail
                    if (current(expectedEpoch)) await onReady()
                } catch (error) {
                    resetAttempt(expectedEpoch)
                    throw error
                }
            })
            initializePromise = request
            return request
        }

        function destroy() {
            if (destroyed) return
            destroyed = true
            ready = false
            epoch += 1
            buffered.length = 0
            initializePromise = null
            unsubscribeAll()
        }

        return {initialize, destroy}
    }

    function createOperatorMessageSender(options = {}) {
        const state = options.state
        const sendRequest = options.send
        const onPendingChange = options.onPendingChange ?? (() => {})
        if (!state || typeof sendRequest !== "function") {
            throw new TypeError("Operator message sender options are required")
        }
        let sequence = 0
        let destroyed = false
        const pendingByJob = new Map()

        async function send(input = {}) {
            const jobId = String(input.jobId ?? "")
            const sessionId = String(input.sessionId ?? "")
            const text = String(input.text ?? "")
            if (destroyed || !jobId || !sessionId || !text.trim()) return null
            const sendId = `operator-send-${++sequence}`
            pendingByJob.set(jobId, sendId)
            state.setViewState(jobId, {draft: text})
            onPendingChange(jobId, true, sendId)
            try {
                const result = await sendRequest(sessionId, text, sendId)
                if (!destroyed && pendingByJob.get(jobId) === sendId) {
                    state.setViewState(jobId, {draft: ""})
                }
                return result
            } catch (error) {
                if (!destroyed && pendingByJob.get(jobId) === sendId) {
                    state.setViewState(jobId, {draft: text})
                }
                throw error
            } finally {
                if (!destroyed && pendingByJob.get(jobId) === sendId) {
                    pendingByJob.delete(jobId)
                    onPendingChange(jobId, false, sendId)
                }
            }
        }

        return {
            send,
            isPending: (jobId) => pendingByJob.has(jobId),
            destroy() {
                destroyed = true
                pendingByJob.clear()
            },
        }
    }

    function structuralFingerprint(value, seen = new Set()) {
        if (value === null || typeof value !== "object") return JSON.stringify(value)
        if (seen.has(value)) throw new TypeError("Operator catalogs must not be circular")
        seen.add(value)
        const result = Array.isArray(value)
            ? `[${value.map((entry) => structuralFingerprint(entry, seen)).join(",")}]`
            : `{${Object.keys(value).sort().map((key) => (
                `${JSON.stringify(key)}:${structuralFingerprint(value[key], seen)}`
            )).join(",")}}`
        seen.delete(value)
        return result
    }

    function createOperatorSurfaceGate(options = {}) {
        const setStateVisible = options.setStateVisible ?? (() => {})
        const setRootHidden = options.setRootHidden ?? (() => {})
        const recover = options.recover ?? (async () => {})
        const applyCatalogs = options.applyCatalogs ?? (() => {})
        const render = options.render ?? (() => {})
        let visible = options.initialVisible === true
        let shown = visible
        let destroyed = false
        let epoch = 0
        let catalogs = null
        let catalogKey = null
        let catalogsDirty = false
        let recovery = null

        function setCatalogs(next) {
            if (destroyed) return false
            const nextKey = structuralFingerprint(next)
            if (nextKey === catalogKey) return false
            catalogKey = nextKey
            catalogs = next
            catalogsDirty = true
            if (shown) {
                applyCatalogs(catalogs)
                catalogsDirty = false
            }
            return true
        }

        function setVisible(nextVisible) {
            if (destroyed) return Promise.resolve(false)
            const next = nextVisible === true
            if (!next) {
                if (!visible && !shown) return Promise.resolve(false)
                visible = false
                shown = false
                epoch += 1
                setStateVisible(false)
                setRootHidden(true)
                return Promise.resolve(true)
            }
            if (visible && shown) return Promise.resolve(false)
            if (visible && recovery?.epoch === epoch) return recovery.promise
            if (!visible) {
                visible = true
                setStateVisible(true)
            }
            shown = false
            const expectedEpoch = ++epoch
            const attempt = {epoch: expectedEpoch, promise: null}
            recovery = attempt
            attempt.promise = (async () => {
                try {
                    await recover()
                    if (destroyed || expectedEpoch !== epoch || !visible) return false
                    if (catalogsDirty) {
                        applyCatalogs(catalogs)
                        catalogsDirty = false
                    }
                    shown = true
                    setRootHidden(false)
                    render()
                    return true
                } finally {
                    if (recovery === attempt) recovery = null
                }
            })()
            return attempt.promise
        }

        return {
            setCatalogs,
            setVisible,
            get visible() { return visible },
            destroy() {
                destroyed = true
                shown = false
                epoch += 1
            },
        }
    }

    function createOperatorDomListenerScope() {
        const registrations = []
        let destroyed = false

        function listen(target, type, listener, options) {
            if (destroyed) return () => {}
            const guarded = (event) => {
                if (!destroyed) listener(event)
            }
            target.addEventListener(type, guarded, options)
            const registration = {target, type, guarded, options}
            registrations.push(registration)
            return () => {
                const index = registrations.indexOf(registration)
                if (index >= 0) registrations.splice(index, 1)
                target.removeEventListener(type, guarded, options)
            }
        }

        function destroy() {
            if (destroyed) return
            destroyed = true
            for (const {target, type, guarded, options} of registrations.splice(0)) {
                target.removeEventListener(type, guarded, options)
            }
        }

        return {
            listen,
            destroy,
            get registrationCount() { return registrations.length },
        }
    }

    function operatorJobActions(status) {
        const actions = []
        if (status === "running") actions.push("pause")
        if (status === "paused") actions.push("resume")
        if (!["succeeded", "failed", "cancelled"].includes(status)) actions.push("stop")
        return actions
    }

    function operatorJobTreeIds(snapshot) {
        const rootId = snapshot?.job?.id
        if (!rootId) return new Set()
        const jobs = new Map((snapshot.jobs ?? []).filter((job) => job?.id).map((job) => [job.id, job]))
        if (!jobs.has(rootId)) jobs.set(rootId, snapshot.job)
        const childrenByParent = new Map()
        for (const job of jobs.values()) {
            if (!job.parentJobId) continue
            if (!childrenByParent.has(job.parentJobId)) childrenByParent.set(job.parentJobId, [])
            childrenByParent.get(job.parentJobId).push(job.id)
        }
        const ids = new Set([rootId])
        const pending = [rootId]
        for (let index = 0; index < pending.length; index += 1) {
            const parentId = pending[index]
            const parent = jobs.get(parentId)
            const children = new Set([
                ...(parent?.childJobIds ?? parent?.children ?? []),
                ...(childrenByParent.get(parentId) ?? []),
            ])
            for (const childId of children) {
                if (!jobs.has(childId) || ids.has(childId)) continue
                ids.add(childId)
                pending.push(childId)
            }
        }
        return ids
    }

    function registerOperatorActionDelegates(options = {}) {
        const listen = options.listen
        const containers = options.containers ?? {}
        const getActiveSnapshot = options.getActiveSnapshot ?? (() => null)
        const onSelectEntity = options.onSelectEntity ?? (() => {})
        const onResolveApproval = options.onResolveApproval ?? (() => {})
        const onApproveCurrentJob = options.onApproveCurrentJob ?? (() => {})
        const onControlJob = options.onControlJob ?? (() => {})
        if (typeof listen !== "function") throw new TypeError("Operator action listener is required")

        listen(containers.artifacts, "click", (event) => {
            const button = event?.target?.closest?.(
                "[data-operator-entity-kind][data-operator-entity-id][data-operator-artifact-id]",
            )
            const snapshot = getActiveSnapshot()
            if (!button || !snapshot) return
            const artifact = snapshot.artifacts.find((entry) => (
                entry.id === button.dataset.operatorArtifactId
            ))
            if (!artifact) return
            const kind = button.dataset.operatorEntityKind
            const id = button.dataset.operatorEntityId
            if (!artifactDeepLinks(artifact).some((link) => link.kind === kind && link.id === id)) return
            onSelectEntity(kind, id, artifact.metadata ?? {})
        })

        listen(containers.approvals, "click", (event) => {
            const snapshot = getActiveSnapshot()
            if (!snapshot) return
            const currentJobIds = operatorJobTreeIds(snapshot)
            const decisionButton = event?.target?.closest?.(
                "[data-operator-approval-decision][data-operator-approval-id][data-operator-job-id]",
            )
            if (decisionButton) {
                const jobId = decisionButton.dataset.operatorJobId
                const decision = decisionButton.dataset.operatorApprovalDecision
                if (jobId !== snapshot.job.id || !["approve", "reject"].includes(decision)) return
                const approval = snapshot.approvals.find((entry) => (
                    entry.id === decisionButton.dataset.operatorApprovalId &&
                    entry.status === "pending" &&
                    currentJobIds.has(entry.jobId ?? jobId)
                ))
                if (approval) void onResolveApproval(approval.id, decision)
                return
            }
            const approveJobButton = event?.target?.closest?.("[data-operator-approve-job]")
            const jobId = approveJobButton?.dataset.operatorApproveJob
            if (jobId !== snapshot.job.id) return
            const pending = snapshot.approvals.filter((entry) => (
                entry.status === "pending" && currentJobIds.has(entry.jobId ?? jobId)
            ))
            if (pending.length > 1) void onApproveCurrentJob(jobId)
        })

        listen(containers.sessionActions, "click", (event) => {
            const button = event?.target?.closest?.("[data-operator-job-action][data-operator-job-id]")
            const snapshot = getActiveSnapshot()
            if (!button || !snapshot || button.dataset.operatorJobId !== snapshot.job.id) return
            const action = button.dataset.operatorJobAction
            if (!operatorJobActions(snapshot.job.status).includes(action)) return
            void onControlJob(snapshot.job.id, action)
        })
    }

    const OPERATOR_ACTIONS = Object.freeze([
        "context.read",
        "raw_cases.read",
        "raw_cases.write",
        "runtime.execute",
        "runtimes.read",
        "datasets.read",
        "datasets.write",
        "datasets.delete",
        "evaluations.read",
        "evaluations.execute",
        "skills.read",
        "skills.write",
        "skills.release",
        "jobs.read",
        "approvals.read",
        "curation.write",
        "rubrics.publish",
        "installations.execute",
        "installations.read",
        "optimizations.read",
        "optimizations.execute",
    ])
    const OPTIONAL_OPERATOR_ACTIONS = Object.freeze(["datasets.delete"])
    const AUTOMATIC_OPERATOR_ACTIONS = Object.freeze(
        OPERATOR_ACTIONS.filter((action) => !OPTIONAL_OPERATOR_ACTIONS.includes(action)),
    )

    function operatorSessionActions(allowPermanentDelete = false) {
        return allowPermanentDelete
            ? [...AUTOMATIC_OPERATOR_ACTIONS, ...OPTIONAL_OPERATOR_ACTIONS]
            : [...AUTOMATIC_OPERATOR_ACTIONS]
    }

    const OPERATOR_STATUS_KEYS = Object.freeze({
        unknown: "operatorStatusUnknown",
        queued: "operatorStatusQueued",
        running: "operatorStatusRunning",
        waiting_approval: "operatorStatusWaitingApproval",
        paused: "operatorStatusPaused",
        succeeded: "operatorStatusSucceeded",
        failed: "operatorStatusFailed",
        cancelled: "operatorStatusCancelled",
        needs_recovery: "operatorStatusNeedsRecovery",
        restoring: "operatorStatusRestoring",
        pending: "operatorStatusPending",
        approved: "operatorStatusApproved",
        rejected: "operatorStatusRejected",
        expired: "operatorStatusExpired",
        completed: "operatorStatusCompleted",
        preparing: "operatorStatusPreparing",
        installing: "operatorStatusInstalling",
        evaluating: "operatorStatusEvaluating",
        editing: "operatorStatusEditing",
    })

    const OPERATOR_ACTION_KEYS = Object.freeze({
        "context.read": "operatorActionContextRead",
        "raw_cases.read": "operatorActionRawCasesRead",
        "raw_cases.write": "operatorActionRawCasesWrite",
        "runtime.execute": "operatorActionRuntimeExecute",
        "runtimes.read": "operatorActionRuntimesRead",
        "datasets.read": "operatorActionDatasetsRead",
        "datasets.write": "operatorActionDatasetsWrite",
        "datasets.delete": "operatorActionDatasetsDelete",
        "evaluations.read": "operatorActionEvaluationsRead",
        "evaluations.execute": "operatorActionEvaluationsExecute",
        "skills.read": "operatorActionSkillsRead",
        "skills.write": "operatorActionSkillsWrite",
        "skills.release": "operatorActionSkillsRelease",
        "jobs.read": "operatorActionJobsRead",
        "approvals.read": "operatorActionApprovalsRead",
        "curation.write": "operatorActionCurationWrite",
        "rubrics.publish": "operatorActionRubricsPublish",
        "installations.execute": "operatorActionInstallationsExecute",
        "installations.read": "operatorActionInstallationsRead",
        "optimizations.read": "operatorActionOptimizationsRead",
        "optimizations.execute": "operatorActionOptimizationsExecute",
    })

    const OPERATOR_SCOPE_KEYS = Object.freeze({
        skillIds: "operatorScopeSkillIds",
        datasetIds: "operatorScopeDatasetIds",
        runtimeIds: "operatorScopeRuntimeIds",
        repositoryIds: "operatorScopeRepositoryIds",
    })

    const OPERATOR_BUDGET_KEYS = Object.freeze({
        maxIterations: "operatorMaxIterations",
        maxDurationMs: "operatorDurationMs",
        maxRuntimeTurns: "operatorRuntimeTurns",
        maxEvaluations: "operatorEvaluations",
        maxTargetExecutions: "operatorTargetExecutions",
        maxJudgeExecutions: "operatorJudgeExecutions",
        maxTokens: "operatorTokensOptional",
        maxReportedCost: "operatorReportedCostOptional",
    })

    const OPTIMIZATION_REASON_KEYS = Object.freeze({
        cancel_requested: "operatorStatusCancelled",
        recovery_failed: "operatorStatusNeedsRecovery",
        duration_budget_exhausted: "operatorDurationMs",
        turn_budget_exhausted: "operatorTurns",
        token_budget_exhausted: "operatorTokensOptional",
        cost_budget_exhausted: "operatorReportedCostOptional",
        critical_regression: "criticalFailure",
        broad_regression: "operatorRegressionsValue",
        target_achieved: "operatorPassed",
        max_epochs_reached: "operatorMaxEpochs",
        patience_exhausted: "operatorPatience",
        agent_finish: "operatorStatusSucceeded",
        agent_pause: "operatorStatusPaused",
        app_shutdown: "operatorStatusPaused",
        process_interrupted: "operatorStatusNeedsRecovery",
        continue: "operatorStatusRunning",
    })

    function operatorStatusText(status, translate = null) {
        const normalized = String(status ?? "unknown").trim().toLowerCase() || "unknown"
        const key = OPERATOR_STATUS_KEYS[normalized]
        return key
            ? translatedText(translate, key, normalized.replaceAll("_", " "))
            : normalized.replaceAll("_", " ")
    }

    function operatorActionText(action, translate = null) {
        const key = OPERATOR_ACTION_KEYS[action]
        return key ? translatedText(translate, key, action) : String(action ?? "")
    }

    function optimizationReasonText(reason, translate = null) {
        if (!reason) return "—"
        const key = OPTIMIZATION_REASON_KEYS[reason]
        return key ? translatedText(translate, key, String(reason)) : String(reason).replaceAll("_", " ")
    }

    function createElement(document_, tag, className = "", text = "") {
        const element = document_.createElement(tag)
        if (className) element.className = className
        if (text) element.textContent = text
        return element
    }

    function entryText(entry = {}) {
        const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : entry
        if (typeof payload.content === "string") return payload.content
        if (typeof payload.text === "string") return payload.text
        if (typeof payload.message === "string") return payload.message
        if (typeof payload.action === "string") return payload.action
        if (typeof payload.status === "string") return payload.status
        return String(entry.kind ?? "Operator activity").replaceAll("_", " ")
    }

    function entryRole(entry = {}) {
        const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : entry
        return payload.role === "user" ? "user" : entry.kind === "message" ? "assistant" : "activity"
    }

    function entrySequence(entry = {}) {
        return Number.isSafeInteger(entry.sequence) ? entry.sequence : Number.MAX_SAFE_INTEGER
    }

    function compareTranscriptEntries(left, right) {
        return entrySequence(left) - entrySequence(right) ||
            String(left.recordedAt ?? left.occurredAt ?? "").localeCompare(
                String(right.recordedAt ?? right.occurredAt ?? ""),
            ) ||
            transcriptEntryKey(left).localeCompare(transcriptEntryKey(right))
    }

    function createKeyedTranscriptPatcher(options = {}) {
        const {container, createNode, updateNode} = options
        if (!container || typeof createNode !== "function" || typeof updateNode !== "function") {
            throw new TypeError("Keyed transcript patcher options are required")
        }
        let orderedKeys = []
        const nodes = new Map()
        const entriesByKey = new Map()

        function latestEntries(entries) {
            const latest = new Map()
            for (const entry of entries ?? []) latest.set(transcriptEntryKey(entry), entry)
            return [...latest.values()].sort(compareTranscriptEntries)
        }

        function reset(entries) {
            const nextEntries = latestEntries(entries)
            const nextNodes = []
            const retained = new Set()
            entriesByKey.clear()
            for (const entry of nextEntries) {
                const key = transcriptEntryKey(entry)
                let node = nodes.get(key)
                if (!node) {
                    node = createNode(key)
                    nodes.set(key, node)
                }
                updateNode(node, entry)
                nextNodes.push(node)
                retained.add(key)
                entriesByKey.set(key, entry)
            }
            for (const key of nodes.keys()) {
                if (!retained.has(key)) nodes.delete(key)
            }
            orderedKeys = nextEntries.map(transcriptEntryKey)
            container.replaceChildren(...nextNodes)
        }

        function patch(entries) {
            for (const entry of latestEntries(entries)) {
                const key = transcriptEntryKey(entry)
                if (nodes.has(key)) {
                    entriesByKey.set(key, entry)
                    updateNode(nodes.get(key), entry)
                    continue
                }
                let low = 0
                let high = orderedKeys.length
                while (low < high) {
                    const middle = Math.floor((low + high) / 2)
                    if (compareTranscriptEntries(entry, entriesByKey.get(orderedKeys[middle])) < 0) high = middle
                    else low = middle + 1
                }
                const targetIndex = low
                const node = createNode(key)
                updateNode(node, entry)
                const before = targetIndex < orderedKeys.length
                    ? nodes.get(orderedKeys[targetIndex])
                    : null
                container.insertBefore(node, before)
                nodes.set(key, node)
                entriesByKey.set(key, entry)
                orderedKeys.splice(targetIndex, 0, key)
            }
        }

        return {reset, patch}
    }

    function scopeText(scope = {}, translate = null) {
        const parts = []
        for (const [key, values] of Object.entries(scope ?? {})) {
            const label = OPERATOR_SCOPE_KEYS[key]
                ? translatedText(translate, OPERATOR_SCOPE_KEYS[key], key)
                : key
            if (Array.isArray(values) && values.length) parts.push(`${label}: ${values.join(", ")}`)
            else if (values !== null && values !== undefined && values !== "") parts.push(`${label}: ${String(values)}`)
        }
        return parts.join(" · ") || translatedText(translate, "operatorNoAdditionalScope", "No additional scope")
    }

    function createOperatorWorkbench(options = {}) {
        const api = options.api
        const root = options.root
        const document_ = root?.ownerDocument ?? globalObject?.document
        if (!api || !root || !document_) throw new TypeError("Operator workbench DOM options are required")
        const translate = options.translate ?? ((key) => key)
        const formatMessage_ = options.formatMessage ?? ((key, values) => (
            formattedText(null, translate, key, values)
        ))
        const text = (key, fallback = key) => translatedText(translate, key, fallback)
        const message = (key, values = {}, fallback = key) => (
            formattedText(formatMessage_, translate, key, values, fallback)
        )
        const rawOnError = options.onError ?? (() => {})
        function localizedErrorText(error) {
            const detail = error?.message ?? String(error)
            if (/telemetry/iu.test(detail)) return text("operatorErrorTelemetryRequired", detail)
            if (/catalog|matching Released|binding do not match/iu.test(detail)) {
                return text("operatorErrorCatalogMismatch", detail)
            }
            if (/invalid|required|must|at least|unique|preflight/iu.test(detail)) {
                return text("operatorErrorInvalidConfiguration", detail)
            }
            return message("operatorErrorWithDetail", {message: detail}, `Operation failed: ${detail}`)
        }
        const onError = (error) => {
            const localized = new Error(localizedErrorText(error))
            localized.code = error?.code
            rawOnError(localized)
        }
        const onSelectEntity = options.onSelectEntity ?? (() => {})
        const language = options.language ?? (() => "en")
        const selectors = {
            jobList: root.querySelector("#operator-job-list"),
            newJob: root.querySelector("#operator-new-job"),
            setup: root.querySelector("#operator-setup-form"),
            setupScroll: root.querySelector("#operator-setup-scroll"),
            setupError: root.querySelector("#operator-setup-error"),
            jobKind: root.querySelector("#operator-job-kind"),
            runtime: root.querySelector("#operator-runtime"),
            runtimeName: root.querySelector("#operator-runtime-name"),
            runtimeDetail: root.querySelector("#operator-runtime-detail"),
            model: root.querySelector("#operator-model"),
            effort: root.querySelector("#operator-effort"),
            skill: root.querySelector("#operator-managed-skill"),
            dataset: root.querySelector("#operator-managed-dataset"),
            targets: root.querySelector("#operator-target-runtimes"),
            optimizationFields: root.querySelector("#operator-optimization-fields"),
            optimizationBaseline: root.querySelector("#operator-optimization-baseline"),
            optimizationJudgeRuntime: root.querySelector("#operator-optimization-judge-runtime"),
            optimizationJudgeModel: root.querySelector("#operator-optimization-judge-model"),
            optimizationJudgeEffort: root.querySelector("#operator-optimization-judge-effort"),
            optimizationActivation: root.querySelector("#operator-optimization-activation"),
            optimizationMode: root.querySelector("#operator-optimization-mode"),
            optimizationPreflightSummary: root.querySelector("#operator-optimization-preflight-summary"),
            optimizationPreflight: root.querySelector("#operator-optimization-preflight"),
            genericStart: root.querySelector("#operator-generic-start"),
            optimizationStart: root.querySelector("#operator-optimization-start"),
            transcript: root.querySelector("#operator-transcript"),
            sessionHeader: root.querySelector("#operator-session-header"),
            sessionTitle: root.querySelector("#operator-session-title"),
            sessionState: root.querySelector("#operator-session-state"),
            sessionActions: root.querySelector("#operator-session-actions"),
            composer: root.querySelector("#operator-composer"),
            composerInput: root.querySelector("#operator-composer-input"),
            composerSend: root.querySelector("#operator-composer-send"),
            status: root.querySelector("#operator-status-panel"),
            scope: root.querySelector("#operator-scope"),
            budget: root.querySelector("#operator-budget"),
            children: root.querySelector("#operator-child-jobs"),
            artifacts: root.querySelector("#operator-artifacts"),
            approvals: root.querySelector("#operator-approval-queue"),
            optimizationPanel: root.querySelector("#operator-optimization-panel"),
            optimizationFrozen: root.querySelector("#operator-optimization-frozen"),
            optimizationTimeline: root.querySelector("#operator-optimization-timeline"),
            optimizationInstallations: root.querySelector("#operator-optimization-installations"),
            optimizationBudget: root.querySelector("#operator-optimization-budget"),
            optimizationRecovery: root.querySelector("#operator-optimization-recovery"),
            optimizationStopWarning: root.querySelector("#operator-optimization-stop-warning"),
            optimizationActions: root.querySelector("#operator-optimization-actions"),
        }
        if (Object.values(selectors).some((element) => !element)) {
            throw new Error("Operator workbench markup is incomplete")
        }

        let catalogs = {runtimes: [], skills: [], versions: [], datasets: [], activeRuntimeId: null}
        const modelsByRuntime = new Map()
        const modelLoads = new Map()
        const jobNodes = new Map()
        let initialized = false
        let destroyed = false
        let creating = false
        let activeRenderedJobId = null
        let optimizationPreflight = null
        let optimizationPreflightSignature = null
        let activeOptimizationRunId = null
        let optimizationPollTimer = null
        const optimizationRuns = new Map()
        const domEvents = createOperatorDomListenerScope()

        const state = createOperatorWorkbenchState({
            readSummaryPage: (cursor, limit) => api.readOperatorSummaryPage(cursor, limit),
            readOperatorSession: (sessionId) => api.getOperatorSession(sessionId),
            readArtifactPage: (jobId, cursor, limit) => api.listOperatorArtifacts(jobId, cursor, limit),
            onListPatch: () => {
                if (destroyed || !initialized || root.classList.contains("hidden")) return
                patchJobList()
                patchActiveChrome()
            },
            onActivePatch: ({jobId, entries}) => {
                if (destroyed || root.classList.contains("hidden")) return
                if (jobId !== state.activeJobId || activeRenderedJobId !== jobId) return
                transcriptPatcher.patch(entries)
            },
            onActiveReset: ({jobId}) => {
                if (destroyed || root.classList.contains("hidden") || jobId !== state.activeJobId) return
                const snapshot = state.getSnapshot(jobId)
                if (!snapshot) return
                resetTranscript(snapshot)
                patchActiveChrome()
            },
        })

        const transcriptPatcher = createKeyedTranscriptPatcher({
            container: selectors.transcript,
            createNode(key) {
                const card = createElement(document_, "article", "operator-entry")
                card.dataset.operatorEntryKey = key
                card.append(
                    createElement(document_, "span", "operator-entry-label"),
                    createElement(document_, "div", "operator-entry-copy"),
                )
                return card
            },
            updateNode(card, entry) {
                const role = entryRole(entry)
                card.className = `operator-entry ${role}`
                card.querySelector(".operator-entry-label").textContent = {
                    user: text("operatorRoleUser", "You"),
                    assistant: text("operatorRoleAssistant", "Operator"),
                    activity: text("operatorRoleActivity", "Activity"),
                }[role] ?? role
                card.querySelector(".operator-entry-copy").textContent =
                    entry.kind === "operator_iteration_limit_reached"
                        ? message("operatorIterationLimitReached", {
                            used: entry.used,
                            limit: entry.limit,
                        }, `Iteration limit reached (${entry.used}/${entry.limit})`)
                        : entryText(entry)
            },
        })

        const messageSender = createOperatorMessageSender({
            state,
            send: (sessionId, text, sendId) => api.sendOperatorMessage(sessionId, text, sendId),
            onPendingChange(jobId) {
                if (destroyed || root.classList.contains("hidden") || state.activeJobId !== jobId) return
                const pending = messageSender.isPending(jobId)
                selectors.composerInput.disabled = pending
                selectors.composerSend.disabled = pending
            },
        })

        const surfaceGate = createOperatorSurfaceGate({
            initialVisible: !root.classList.contains("hidden"),
            setStateVisible: (visible) => state.setVisible(visible),
            setRootHidden: (hidden) => root.classList.toggle("hidden", hidden),
            recover: () => state.ensureActiveCaughtUp(),
            applyCatalogs(nextCatalogs) {
                if (destroyed) return
                catalogs = nextCatalogs
                renderSetupCatalogs()
            },
            render: renderVisibleSurface,
        })

        const notificationMethods = {
            changed: "onOperatorChanged",
            event: "onOperatorEvent",
            approval: "onOperatorApproval",
            artifact: "onOperatorArtifact",
        }
        const initializationGate = createOperatorInitializationGate({
            subscribe(kind, listener) {
                const method = notificationMethods[kind]
                return typeof api[method] === "function" ? api[method](listener) : () => {}
            },
            bootstrap: () => api.bootstrapOperator(),
            applyBootstrap(bootstrap) {
                if (destroyed) return
                state.setVisible(surfaceGate.visible)
                state.initialize(bootstrap)
            },
            async hydrate() {
                await state.catchUp()
                if (destroyed) return
                const first = state.listSnapshots()[0]
                if (first) await activateSession(first.session?.id ?? first.job.sessionId)
                else creating = true
            },
            ingest: (kind, envelope) => state.ingest(kind, envelope),
            catchUp: () => state.catchUp(),
            afterCatchUp: () => state.ensureActiveCaughtUp(),
            onReady() {
                if (destroyed) return
                initialized = true
                if (!root.classList.contains("hidden")) renderVisibleSurface()
            },
            onError,
        })

        function availableModels(runtimeId) {
            return modelsByRuntime.get(runtimeId) ?? []
        }

        function runtimeEfforts(runtimeId, selectedModelId) {
            const runtime = catalogs.runtimes.find((entry) => entry.runtimeId === runtimeId)
            const selectedModel = availableModels(runtimeId)
                .find((entry) => modelId(entry) === selectedModelId)
            const efforts = selectedModel?.reasoningEfforts ??
                selectedModel?.supportedReasoningEfforts ??
                selectedModel?.supportedEfforts ??
                runtime?.efforts ?? []
            return [...new Set(efforts.map((entry) => String(
                entry?.reasoningEffort ?? entry?.effort ?? entry?.value ?? entry,
            )))]
        }

        function appendOption(select, value, label) {
            const option = createElement(document_, "option", "", label)
            option.value = value
            select.append(option)
        }

        function populateOptimizationModelSelect(runtimeId, modelSelect, effortSelect) {
            const selectedModel = modelSelect.value
            const selectedEffort = effortSelect.value
            modelSelect.replaceChildren()
            for (const model of availableModels(runtimeId)) {
                const value = modelId(model)
                if (value) appendOption(modelSelect, value, model.displayName ?? value)
            }
            if (availableModels(runtimeId).some((entry) => modelId(entry) === selectedModel)) {
                modelSelect.value = selectedModel
            } else {
                modelSelect.value = availableModels(runtimeId)[0]
                    ? modelId(availableModels(runtimeId)[0])
                    : ""
            }
            const efforts = runtimeEfforts(runtimeId, modelSelect.value)
            effortSelect.replaceChildren()
            appendOption(effortSelect, "", text("operatorRuntimeDefault", "Runtime default"))
            for (const effort of efforts) appendOption(effortSelect, effort, effort)
            effortSelect.value = efforts.includes(selectedEffort) ? selectedEffort : ""
        }

        function renderOptimizationRuntimeSelectors() {
            const selectedJudge = selectors.optimizationJudgeRuntime.value || selectors.runtime.value
            selectors.optimizationJudgeRuntime.replaceChildren()
            for (const runtime of catalogs.runtimes) {
                appendOption(
                    selectors.optimizationJudgeRuntime,
                    runtime.runtimeId,
                    runtimeDisplayLabel(runtime, catalogs.runtimes),
                )
            }
            selectors.optimizationJudgeRuntime.value = catalogs.runtimes.some((entry) => (
                entry.runtimeId === selectedJudge
            )) ? selectedJudge : catalogs.runtimes[0]?.runtimeId ?? ""
            populateOptimizationModelSelect(
                selectors.optimizationJudgeRuntime.value,
                selectors.optimizationJudgeModel,
                selectors.optimizationJudgeEffort,
            )
            for (const card of selectors.targets.querySelectorAll("[data-operator-target-card]")) {
                const runtimeId = card.dataset.operatorTargetCard
                const modelSelect = card.querySelector("[data-optimization-target-model]")
                const effortSelect = card.querySelector("[data-optimization-target-effort]")
                if (modelSelect && effortSelect) {
                    populateOptimizationModelSelect(runtimeId, modelSelect, effortSelect)
                }
            }
        }

        function renderEfforts() {
            const selected = selectors.effort.value
            const runtime = catalogs.runtimes.find((entry) => entry.runtimeId === selectors.runtime.value)
            const models = availableModels(selectors.runtime.value)
            const selectedModel = models.find((entry) => modelId(entry) === selectors.model.value)
            const modelEfforts = selectedModel?.reasoningEfforts ??
                selectedModel?.supportedReasoningEfforts ??
                selectedModel?.supportedEfforts ?? []
            const efforts = (modelEfforts.length ? modelEfforts : runtime?.efforts ?? [])
                .map((entry) => String(entry?.reasoningEffort ?? entry?.effort ?? entry?.value ?? entry))
            selectors.effort.replaceChildren()
            appendOption(selectors.effort, "", text("operatorRuntimeDefault", "Runtime default"))
            for (const effort of [...new Set(efforts)]) appendOption(selectors.effort, effort, effort)
            selectors.effort.value = efforts.includes(selected) ? selected : ""
        }

        function renderModels(runtimeId) {
            const selected = selectors.model.value
            selectors.model.replaceChildren()
            appendOption(
                selectors.model,
                "",
                modelLoads.has(runtimeId)
                    ? text("operatorLoadingModels", "Loading models…")
                    : text("operatorRuntimeDefault", "Runtime default"),
            )
            for (const model of availableModels(runtimeId)) {
                const value = modelId(model)
                if (value) appendOption(selectors.model, value, model.displayName ?? value)
            }
            if (availableModels(runtimeId).some((entry) => modelId(entry) === selected)) {
                selectors.model.value = selected
            }
            selectors.model.disabled = modelLoads.has(runtimeId)
            renderEfforts()
        }

        async function loadRuntimeModels(runtimeId, force = false) {
            if (destroyed) return
            if (!runtimeId || (modelsByRuntime.has(runtimeId) && !force)) {
                if (!root.classList.contains("hidden")) renderModels(runtimeId)
                return
            }
            if (modelLoads.has(runtimeId)) return modelLoads.get(runtimeId)
            const request = (async () => {
                if (!root.classList.contains("hidden")) renderModels(runtimeId)
                try {
                    const response = await api.listModelsForRuntime(runtimeId)
                    if (destroyed) return
                    modelsByRuntime.set(runtimeId, Array.isArray(response?.data) ? response.data : [])
                } catch (error) {
                    if (destroyed) return
                    modelsByRuntime.set(runtimeId, [])
                    onError(error)
                } finally {
                    modelLoads.delete(runtimeId)
                    if (!destroyed && !root.classList.contains("hidden")) {
                        if (selectors.runtime.value === runtimeId) renderModels(runtimeId)
                        renderOptimizationRuntimeSelectors()
                    }
                }
            })()
            modelLoads.set(runtimeId, request)
            if (!root.classList.contains("hidden")) renderModels(runtimeId)
            return request
        }

        function setSelectOptions(select, values, selected, label) {
            select.replaceChildren()
            appendOption(select, "", label)
            for (const entry of values) appendOption(select, entry.id, entry.label)
            select.value = values.some((entry) => entry.id === selected) ? selected : ""
        }

        function renderSetupCatalogs() {
            const selectedRuntime = selectors.runtime.value || catalogs.activeRuntimeId
            selectors.runtime.replaceChildren()
            for (const runtime of catalogs.runtimes) {
                appendOption(
                    selectors.runtime,
                    runtime.runtimeId,
                    runtimeDisplayLabel(runtime, catalogs.runtimes),
                )
                if (!modelsByRuntime.has(runtime.runtimeId) && Array.isArray(runtime.models) && runtime.models.length) {
                    modelsByRuntime.set(runtime.runtimeId, runtime.models.map((entry) => (
                        typeof entry === "string" ? {id: entry, displayName: entry} : entry
                    )))
                }
            }
            selectors.runtime.value = catalogs.runtimes.some((entry) => entry.runtimeId === selectedRuntime)
                ? selectedRuntime
                : catalogs.runtimes[0]?.runtimeId ?? ""
            const activeRuntime = catalogs.runtimes.find((entry) => (
                entry.runtimeId === selectors.runtime.value
            )) ?? {}
            const activeIdentity = runtimeDisplayParts(activeRuntime)
            selectors.runtimeName.textContent = activeIdentity.base
            selectors.runtimeDetail.textContent = activeIdentity.detail
            selectors.runtimeDetail.title = activeIdentity.detail
            setSelectOptions(
                selectors.skill,
                catalogs.skills.filter((entry) => entry.status === undefined || entry.status === "valid")
                    .map((entry) => ({id: entry.id, label: entry.name ?? entry.id})),
                selectors.skill.value,
                text("operatorNoManagedSkill", "No managed Skill"),
            )
            setSelectOptions(
                selectors.dataset,
                catalogs.datasets.map((entry) => ({id: entry.id, label: entry.name ?? entry.id})),
                selectors.dataset.value,
                text("operatorNoDataset", "No Dataset"),
            )
            const selectedBaseline = selectors.optimizationBaseline.value
            const releasedVersions = catalogs.versions.filter((entry) => (
                entry.state === "released" && entry.skillId === selectors.skill.value
            ))
            setSelectOptions(
                selectors.optimizationBaseline,
                releasedVersions.map((entry) => ({
                    id: entry.id,
                    label: entry.label ?? entry.versionLabel ?? entry.id,
                })),
                selectedBaseline,
                text("operatorSelectReleasedBaseline", "Select Released baseline"),
            )
            const selectedTargets = new Set(
                [...selectors.targets.querySelectorAll("[data-operator-target]:checked")]
                    .map((input) => input.value),
            )
            const targetSelections = new Map(
                [...selectors.targets.querySelectorAll("[data-operator-target-card]")].map((card) => [
                    card.dataset.operatorTargetCard,
                    {
                        modelId: card.querySelector("[data-optimization-target-model]")?.value ?? "",
                        effort: card.querySelector("[data-optimization-target-effort]")?.value ?? "",
                    },
                ]),
            )
            selectors.targets.replaceChildren()
            for (const runtime of catalogs.runtimes) {
                const card = createElement(
                    document_,
                    "article",
                    "operator-target-card evaluation-runtime-row",
                )
                card.dataset.operatorTargetCard = runtime.runtimeId
                const input = document_.createElement("input")
                input.type = "checkbox"
                input.value = runtime.runtimeId
                input.dataset.operatorTarget = runtime.runtimeId
                input.checked = selectedTargets.size
                    ? selectedTargets.has(runtime.runtimeId)
                    : runtime.runtimeId === selectors.runtime.value
                const heading = createElement(
                    document_,
                    "label",
                    "operator-target-runtime-heading evaluation-runtime-heading",
                )
                const identity = runtimeDisplayParts(runtime)
                const title = createElement(document_, "span")
                const detail = createElement(document_, "small", "", identity.detail)
                detail.title = identity.detail
                title.append(
                    createElement(document_, "strong", "", identity.base),
                    detail,
                )
                heading.append(input, title)
                const options = createElement(
                    document_,
                    "div",
                    "operator-target-runtime-options evaluation-runtime-controls",
                )
                const targetModel = document_.createElement("select")
                targetModel.dataset.optimizationTargetModel = runtime.runtimeId
                const targetEffort = document_.createElement("select")
                targetEffort.dataset.optimizationTargetEffort = runtime.runtimeId
                options.append(targetModel, targetEffort)
                card.append(heading, options)
                selectors.targets.append(card)
                const selected = targetSelections.get(runtime.runtimeId)
                populateOptimizationModelSelect(runtime.runtimeId, targetModel, targetEffort)
                if (selected && availableModels(runtime.runtimeId).some((entry) => (
                    modelId(entry) === selected.modelId
                ))) {
                    targetModel.value = selected.modelId
                    populateOptimizationModelSelect(runtime.runtimeId, targetModel, targetEffort)
                }
                const efforts = runtimeEfforts(runtime.runtimeId, targetModel.value)
                if (selected && efforts.includes(selected.effort)) targetEffort.value = selected.effort
                targetModel.disabled = !input.checked
                targetEffort.disabled = !input.checked
                if (!modelsByRuntime.has(runtime.runtimeId)) void loadRuntimeModels(runtime.runtimeId)
            }
            void loadRuntimeModels(selectors.runtime.value)
            renderOptimizationRuntimeSelectors()
            renderOptimizationSetupMode()
        }

        function isOptimizationSetup() {
            return selectors.jobKind.value === "optimization"
        }

        function invalidateOptimizationPreflight() {
            optimizationPreflight = null
            optimizationPreflightSignature = null
            selectors.optimizationStart.disabled = true
            if (isOptimizationSetup()) {
                selectors.optimizationPreflightSummary.textContent = text(
                    "operatorConfigurationChanged",
                    "Configuration changed. Run preflight again before starting.",
                )
            }
        }

        function renderOptimizationSetupMode() {
            const optimization = isOptimizationSetup()
            selectors.optimizationFields.classList.toggle("hidden", !optimization)
            selectors.optimizationPreflight.classList.toggle("hidden", !optimization)
            selectors.optimizationStart.classList.toggle("hidden", !optimization)
            selectors.genericStart.classList.toggle("hidden", optimization)
            const objective = selectors.setup.elements.objective
            objective.required = !optimization
            for (const card of selectors.targets.querySelectorAll("[data-operator-target-card]")) {
                card.querySelector(".operator-target-runtime-options")?.classList.toggle("hidden", !optimization)
            }
        }

        function optimizationValues() {
            const targets = [...selectors.targets.querySelectorAll("[data-operator-target]:checked")]
                .map((input) => {
                    const card = input.closest("[data-operator-target-card]")
                    return {
                        runtimeId: input.value,
                        modelId: card?.querySelector("[data-optimization-target-model]")?.value ?? "",
                        effort: card?.querySelector("[data-optimization-target-effort]")?.value ?? "",
                    }
                })
            const limits = Object.fromEntries(
                [...selectors.setup.querySelectorAll("[data-optimization-limit]")]
                    .map((input) => [input.dataset.optimizationLimit, input.value]),
            )
            const target = Object.fromEntries(
                [...selectors.setup.querySelectorAll("[data-optimization-target]")]
                    .map((input) => [
                        input.dataset.optimizationTarget,
                        input.type === "checkbox" ? input.checked : input.value,
                    ]),
            )
            return {
                skillId: selectors.skill.value,
                baselineVersionId: selectors.optimizationBaseline.value,
                datasetId: selectors.dataset.value,
                operator: {
                    runtimeId: selectors.runtime.value,
                    modelId: selectors.model.value,
                    effort: selectors.effort.value,
                },
                targets,
                judge: {
                    runtimeId: selectors.optimizationJudgeRuntime.value,
                    modelId: selectors.optimizationJudgeModel.value,
                    effort: selectors.optimizationJudgeEffort.value,
                },
                activationMode: selectors.optimizationActivation.value,
                mode: selectors.optimizationMode.value,
                limits,
                target,
            }
        }

        function optimizationConfigFromSetup() {
            return buildOptimizationConfig(optimizationValues(), {...catalogs, modelsByRuntime})
        }

        function optimizationRequestId(prefix) {
            const suffix = globalObject?.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
            return `${prefix}-${suffix}`
        }

        function renderOptimizationPreflight(summary) {
            const frozen = summary.frozen
            selectors.optimizationPreflightSummary.textContent = [
                message("operatorPreflightFrozen", {
                    version: frozen.baselineVersionId,
                    digest: frozen.baselineDigest ?? text("operatorDigestPending", "digest pending"),
                }, "Frozen {version} ({digest})"),
                message("operatorPreflightDataset", {
                    id: frozen.datasetId,
                    revision: frozen.datasetRevision,
                }, "Dataset {id} @ revision {revision}"),
                message("operatorPreflightRubric", {
                    id: frozen.rubricId,
                    version: frozen.rubricVersion,
                }, "Rubric {id} @ version {version}"),
                message("operatorPreflightTargets", {
                    count: summary.runtimeMatrix.length,
                }, "{count} target Runtime(s)"),
                message("operatorPreflightTelemetry", {
                    tokens: text(summary.telemetry.tokens ? "operatorYes" : "operatorNo", summary.telemetry.tokens ? "yes" : "no"),
                    cost: text(summary.telemetry.cost ? "operatorYes" : "operatorNo", summary.telemetry.cost ? "yes" : "no"),
                }, "Telemetry: tokens {tokens}, cost {cost}"),
                text(
                    "operatorPreflightApprovals",
                    "Approval remains explicit for the first Candidate experiment install and one final release-and-install decision.",
                ),
            ].join(" · ")
        }

        async function preflightOptimization() {
            selectors.setupError.textContent = ""
            selectors.setupError.classList.add("hidden")
            try {
                const config = optimizationConfigFromSetup()
                const signature = JSON.stringify(config)
                selectors.optimizationPreflight.disabled = true
                selectors.optimizationPreflightSummary.textContent = text(
                    "operatorCheckingPreflight",
                    "Checking frozen inputs and Runtime readiness…",
                )
                const preflight = await api.preflightOptimization({
                    ...config,
                    idempotencyKey: optimizationRequestId("optimization-preflight"),
                })
                if (destroyed) return
                optimizationPreflight = optimizationPreflightSummary(preflight, config)
                optimizationPreflightSignature = signature
                selectors.optimizationStart.disabled = optimizationPreflight.ready !== true
                renderOptimizationPreflight(optimizationPreflight)
            } catch (error) {
                if (destroyed) return
                optimizationPreflight = null
                optimizationPreflightSignature = null
                selectors.optimizationStart.disabled = true
                selectors.optimizationPreflightSummary.textContent = text(
                    "operatorPreflightFailed",
                    "Preflight failed. Fix the configuration and retry.",
                )
                selectors.setupError.textContent = localizedErrorText(error)
                selectors.setupError.classList.remove("hidden")
            } finally {
                if (!destroyed) selectors.optimizationPreflight.disabled = false
            }
        }

        function optimizationRunForSnapshot(snapshot) {
            const runId = snapshot?.job?.optimizationRunId ?? activeOptimizationRunId
            return runId ? optimizationRuns.get(runId) ?? null : null
        }

        function renderOptimizationPanel(run) {
            selectors.optimizationPanel.classList.toggle("hidden", !run)
            if (!run) return
            const view = optimizationPanelView(run)
            const snapshot = state.getSnapshot(state.activeJobId)
            const finalApproval = optimizationFinalApproval(snapshot)
            const finalApprovalEvidence = optimizationFinalApprovalView(run, finalApproval)
            selectors.optimizationFrozen.textContent = [
                message("operatorBaselineValue", {value: view.baseline.versionId ?? "—"}, "Baseline {value}"),
                message("operatorDatasetValue", {
                    id: view.dataset.id ?? "—",
                    revision: view.dataset.revision ?? "—",
                }, "Dataset {id} @ {revision}"),
                message("operatorRubricValue", {
                    id: view.rubric.id ?? "—",
                    version: view.rubric.version ?? "—",
                }, "Rubric {id} @ {version}"),
                message("operatorState", {value: jobStatusText(view.state)}, "State {value}"),
            ].join(" · ")
            selectors.optimizationTimeline.replaceChildren()
            for (const point of view.scoreTrend) {
                const row = createElement(document_, "div", "operator-optimization-epoch")
                row.append(
                    createElement(document_, "strong", "", `E${point.epoch}`),
                    createElement(document_, "span", "", message(
                        "operatorScoreValue",
                        {value: point.score},
                        "score {value}",
                    )),
                    createElement(document_, "span", "", message(
                        "operatorPassValue",
                        {value: (point.passRate * 100).toFixed(1)},
                        "pass {value}%",
                    )),
                )
                selectors.optimizationTimeline.append(row)
            }
            if (!view.scoreTrend.length) {
                selectors.optimizationTimeline.append(createElement(
                    document_,
                    "div",
                    "operator-empty",
                    text("operatorNoEpochScore", "No completed Epoch score yet"),
                ))
            }
            renderList(
                selectors.optimizationInstallations,
                view.installations,
                (installation) => {
                    const card = createElement(document_, "article", "operator-side-card")
                    card.append(
                        createElement(document_, "strong", "", installation.runtimeId),
                        createElement(
                            document_,
                            "small",
                            "",
                            `${operatorStatusText(installation.status, translate)} · ${installation.installationJobId}`,
                        ),
                    )
                    return card
                },
                text("operatorNoInstallationState", "No current installation state"),
            )
            const notReported = text("operatorNotReported", "not reported")
            selectors.optimizationBudget.textContent = [
                message("operatorEpochValue", {value: view.currentEpoch}, "Epoch {value}"),
                message("operatorRegressionsValue", {value: view.regressionCount}, "Regressions {value}"),
                message("operatorRemainingDuration", {value: view.remaining.durationMs ?? notReported}, "Remaining duration {value}"),
                message("operatorRemainingTurns", {value: view.remaining.turns ?? notReported}, "turns {value}"),
                message("operatorRemainingTokens", {value: view.remaining.tokens ?? notReported}, "tokens {value}"),
                message("operatorRemainingCost", {value: view.remaining.costMicros ?? notReported}, "cost µ {value}"),
                message("operatorStopReason", {value: optimizationReasonText(view.stopReason, translate)}, "Stop reason {value}"),
                message("operatorFinalApproval", {
                    value: finalApprovalEvidence.approvalId ?? text("operatorNotRequested", "not requested"),
                }, "Final approval {value}"),
                ...(finalApproval ? [
                    message("operatorApprovalCandidate", {
                        value: finalApprovalEvidence.candidateVersionId ?? notReported,
                    }, "Candidate {value}"),
                    message("operatorApprovalEvaluation", {
                        score: finalApprovalEvidence.score ?? notReported,
                        passRate: finalApprovalEvidence.passRate === null
                            ? notReported
                            : `${Math.round(finalApprovalEvidence.passRate * 100)}%`,
                        regressions: finalApprovalEvidence.regressionCount ?? notReported,
                    }, "Evaluation {score}/100, pass {passRate}, regressions {regressions}"),
                    message("operatorApprovalTargets", {
                        value: finalApprovalEvidence.runtimeIds.join(", ") || notReported,
                    }, "Target Runtimes {value}"),
                    message("operatorApprovalRisk", {
                        value: finalApprovalEvidence.risk ?? notReported,
                    }, "Risk {value}"),
                ] : []),
                message("operatorReleasedValue", {
                    value: view.release.releasedVersionId ?? text("operatorNotPublished", "not published"),
                }, "Released {value}"),
                message("operatorInstalledArtifact", {
                    value: view.release.installArtifactId ?? text("operatorNotRun", "not run"),
                }, "Install result {value}"),
            ].join(" · ")
            selectors.optimizationRecovery.replaceChildren()
            for (const target of view.recoveryTargets) {
                const card = createElement(document_, "button", "operator-link", [
                    target.runtimeId,
                    operatorStatusText(target.status, translate),
                    message("operatorJobValue", {value: target.installationJobId}, "Job {value}"),
                    target.lastVerifiedDigest ?? text("operatorDigestUnavailable", "digest unavailable"),
                ].join(" · "))
                card.type = "button"
                card.dataset.optimizationInstallationId = target.installationJobId
                card.dataset.optimizationSkillId = view.baseline.skillId ?? ""
                selectors.optimizationRecovery.append(card)
            }
            selectors.optimizationStopWarning.classList.toggle("hidden", !view.actions.includes("stop"))
            selectors.optimizationActions.replaceChildren()
            const labels = {
                pause: text("operatorPause", "Pause"),
                resume: text("operatorResume", "Resume"),
                stop: text("operatorStopAndRestore", "Stop and restore"),
                report: text("operatorReport", "Report"),
            }
            for (const action of view.actions) {
                const button = createElement(document_, "button", action === "stop" ? "danger" : "", labels[action])
                button.type = "button"
                button.dataset.optimizationAction = action
                button.dataset.optimizationRunId = view.id
                selectors.optimizationActions.append(button)
            }
            if (finalApproval && snapshot) {
                for (const [decision, key, fallback, className] of [
                    ["approve", "operatorInstallImproved", "Install improved version", ""],
                    ["reject", "operatorRestoreOriginal", "Restore original version", "danger"],
                ]) {
                    const button = createElement(document_, "button", className, text(key, fallback))
                    button.type = "button"
                    button.dataset.operatorApprovalDecision = decision
                    button.dataset.operatorApprovalId = finalApproval.id
                    button.dataset.operatorJobId = finalApproval.jobId ?? snapshot.job.id
                    selectors.optimizationActions.append(button)
                }
            }
        }

        function clearOptimizationPoll() {
            if (optimizationPollTimer !== null) clearTimeout(optimizationPollTimer)
            optimizationPollTimer = null
        }

        function scheduleOptimizationPoll(delay = 0) {
            clearOptimizationPoll()
            if (destroyed || root.classList.contains("hidden") || !activeOptimizationRunId) return
            optimizationPollTimer = setTimeout(async () => {
                optimizationPollTimer = null
                const runId = activeOptimizationRunId
                try {
                    const latest = await api.getOptimizationRun(runId)
                    if (destroyed || runId !== activeOptimizationRunId) return
                    const reduced = reduceOptimizationTimeline(optimizationRuns.get(runId) ?? null, latest)
                    optimizationRuns.set(runId, reduced)
                    renderOptimizationPanel(reduced)
                    if (!["succeeded", "failed", "cancelled"].includes(reduced.state)) {
                        scheduleOptimizationPoll(1_000)
                    }
                } catch (error) {
                    if (!destroyed) onError(error)
                }
            }, delay)
        }

        async function controlOptimization(runId, action) {
            const methods = {
                pause: "pauseOptimization",
                resume: "resumeOptimization",
                stop: "stopOptimization",
                report: "getOptimizationReport",
            }
            const method = methods[action]
            if (!runId || typeof api[method] !== "function") return
            try {
                const result = await api[method](runId, optimizationRequestId(`optimization-${action}`))
                if (destroyed) return
                if (action === "report") {
                    const current = optimizationRuns.get(runId)
                    if (current) {
                        current.checkpoint = {
                            ...current.checkpoint,
                            reportArtifactId: result.artifactId,
                            reportDigest: result.digest,
                        }
                        renderOptimizationPanel(current)
                    }
                    return
                }
                const reduced = reduceOptimizationTimeline(optimizationRuns.get(runId) ?? null, result)
                optimizationRuns.set(runId, reduced)
                renderOptimizationPanel(reduced)
                scheduleOptimizationPoll(500)
            } catch (error) {
                if (!destroyed) onError(error)
            }
        }

        function jobStatusText(status) {
            return operatorStatusText(status, translate)
        }

        function ensureJobNode(jobId) {
            let node_ = jobNodes.get(jobId)
            if (node_) return node_
            node_ = createElement(document_, "button", "operator-job-item")
            node_.type = "button"
            node_.dataset.operatorJobId = jobId
            node_.append(
                createElement(document_, "strong", "operator-job-title"),
                createElement(document_, "span", "operator-job-meta"),
                createElement(document_, "span", "operator-job-unread hidden"),
            )
            jobNodes.set(jobId, node_)
            return node_
        }

        function patchJobList() {
            const snapshots = state.listSnapshots().sort((left, right) => (
                String(right.job.updatedAt ?? right.job.createdAt ?? "").localeCompare(
                    String(left.job.updatedAt ?? left.job.createdAt ?? ""),
                )
            ))
            const retained = new Set()
            if (!snapshots.length) {
                const empty = selectors.jobList.querySelector(".operator-empty") ??
                    createElement(
                        document_,
                        "div",
                        "operator-empty",
                        text("operatorNoJobs", "No Operator Jobs yet"),
                    )
                empty.textContent = text("operatorNoJobs", "No Operator Jobs yet")
                selectors.jobList.append(empty)
            } else {
                selectors.jobList.querySelector(".operator-empty")?.remove()
            }
            for (const snapshot of snapshots) {
                const jobId = snapshot.job.id
                const node_ = ensureJobNode(jobId)
                retained.add(jobId)
                node_.classList.toggle("active", jobId === state.activeJobId && !creating)
                node_.querySelector(".operator-job-title").textContent = snapshot.job.objective || jobId
                node_.querySelector(".operator-job-meta").textContent = jobStatusText(snapshot.job.status)
                const unread = Object.values(snapshot.unread).reduce((sum, value) => sum + value, 0)
                const badge = node_.querySelector(".operator-job-unread")
                badge.textContent = String(unread)
                badge.classList.toggle("hidden", unread === 0)
                selectors.jobList.append(node_)
            }
            for (const [jobId, node_] of jobNodes) {
                if (retained.has(jobId)) continue
                node_.remove()
                jobNodes.delete(jobId)
            }
        }

        function combinedTranscript(snapshot) {
            const byKey = new Map()
            for (const entry of [...snapshot.transcript, ...snapshot.events]) {
                byKey.set(transcriptEntryKey(entry), entry)
            }
            return [...byKey.values()].sort(compareTranscriptEntries)
        }

        function resetTranscript(snapshot) {
            activeRenderedJobId = snapshot.job.id
            transcriptPatcher.reset(combinedTranscript(snapshot))
        }

        function sessionConfiguration(snapshot) {
            const configuration = snapshot.transcript.find((entry) => (
                entry.kind === "operator_session_configuration"
            ))
            return configuration?.payload ?? {}
        }

        function renderList(container, entries, renderEntry, emptyText) {
            container.replaceChildren()
            if (!entries.length) {
                container.append(createElement(document_, "div", "operator-empty", emptyText))
                return
            }
            for (const entry of entries) container.append(renderEntry(entry))
        }

        function patchStatus(snapshot) {
            const configuration = sessionConfiguration(snapshot)
            selectors.scope.textContent = scopeText(configuration.scopes ?? configuration.scope, translate)
            selectors.budget.textContent = Object.entries(snapshot.job.budget ?? {})
                .map(([key, value]) => {
                    const label = OPERATOR_BUDGET_KEYS[key]
                        ? text(OPERATOR_BUDGET_KEYS[key], key)
                        : key
                    return `${label}: ${value ?? text("operatorUnlimited", "unlimited")}`
                })
                .join(" · ") || text("operatorNoBudget", "No budget details")
            renderList(
                selectors.children,
                snapshot.jobs.filter((job) => job.id !== snapshot.job.id),
                (job) => {
                    const card = createElement(document_, "article", "operator-side-card")
                    card.append(
                        createElement(document_, "strong", "", job.objective ?? job.id),
                        createElement(document_, "small", "", jobStatusText(job.status)),
                    )
                    return card
                },
                text("operatorNoChildJobs", "No child Jobs"),
            )
            renderList(
                selectors.artifacts,
                snapshot.artifacts,
                (artifact) => {
                    const card = createElement(document_, "article", "operator-side-card operator-artifact-card")
                    card.dataset.operatorArtifactId = artifact.id
                    card.append(
                        createElement(document_, "strong", "", artifact.name ?? artifact.kind ?? artifact.id),
                        createElement(document_, "small", "", message("operatorArtifactMeta", {
                            kind: artifact.kind ?? text("operatorArtifacts", "artifact"),
                            bytes: artifact.byteLength ?? 0,
                        }, "{kind} · {bytes} bytes")),
                    )
                    const links = artifactDeepLinks(artifact, translate, formatMessage_)
                    if (links.length) {
                        const actions = createElement(document_, "div", "operator-inline-actions")
                        for (const link of links) {
                            const button = createElement(document_, "button", "operator-link", link.label)
                            button.type = "button"
                            button.dataset.operatorEntityKind = link.kind
                            button.dataset.operatorEntityId = link.id
                            button.dataset.operatorArtifactId = artifact.id
                            actions.append(button)
                        }
                        card.append(actions)
                    }
                    return card
                },
                text("operatorNoArtifacts", "No artifacts"),
            )
            const pending = snapshot.approvals.filter((approval) => approval.status === "pending")
            renderList(
                selectors.approvals,
                snapshot.approvals,
                (approval) => {
                    const card = createElement(document_, "article", "operator-approval-card")
                    card.dataset.operatorApprovalId = approval.id
                    card.append(
                        createElement(
                            document_,
                            "strong",
                            "operator-approval-action",
                            approval.action
                                ? operatorActionText(approval.action, translate)
                                : text("operatorUnknownAction", "Unknown action"),
                        ),
                        createElement(document_, "p", "operator-approval-scope", scopeText(approval.scope, translate)),
                        createElement(document_, "small", "operator-approval-status", jobStatusText(approval.status)),
                    )
                    if (approval.status === "pending") {
                        const actions = createElement(document_, "div", "operator-approval-actions")
                        for (const [decision, label] of [
                            ["reject", text("operatorReject", "Reject")],
                            ["approve", text("operatorApproveOnce", "Approve once")],
                        ]) {
                            const button = createElement(document_, "button", decision === "approve" ? "primary" : "", label)
                            button.type = "button"
                            button.dataset.operatorApprovalDecision = decision
                            button.dataset.operatorApprovalId = approval.id
                            button.dataset.operatorJobId = snapshot.job.id
                            actions.append(button)
                        }
                        if (pending.length > 1) {
                            const approveJob = createElement(
                                document_,
                                "button",
                                "",
                                text("operatorApproveCurrentJob", "Approve current Job"),
                            )
                            approveJob.type = "button"
                            approveJob.dataset.operatorApproveJob = snapshot.job.id
                            actions.append(approveJob)
                        }
                        card.append(actions)
                    }
                    return card
                },
                text("operatorNoApprovals", "No approvals"),
            )
        }

        function renderSessionActions(snapshot) {
            selectors.sessionActions.replaceChildren()
            const labels = {
                pause: text("operatorPause", "Pause"),
                resume: text("operatorResume", "Resume"),
                stop: text("operatorStop", "Stop"),
            }
            for (const action of operatorJobActions(snapshot.job.status)) {
                const button = createElement(document_, "button", "operator-control-button", labels[action])
                button.type = "button"
                button.dataset.operatorJobAction = action
                button.dataset.operatorJobId = snapshot.job.id
                selectors.sessionActions.append(button)
            }
        }

        function patchActiveChrome({restoreView = false} = {}) {
            const snapshot = state.getSnapshot(state.activeJobId)
            selectors.setup.classList.toggle("hidden", !creating && Boolean(snapshot))
            selectors.sessionHeader.classList.toggle("hidden", creating || !snapshot)
            selectors.composer.classList.toggle("hidden", creating || !snapshot)
            selectors.status.classList.toggle("operator-panel-empty", creating || !snapshot)
            if (!snapshot || creating) {
                activeOptimizationRunId = null
                clearOptimizationPoll()
                renderOptimizationPanel(null)
                if (creating) {
                    selectors.transcript.replaceChildren(
                        createElement(
                            document_,
                            "div",
                            "operator-empty operator-setup-prompt",
                            text("operatorConfigureScopedJob", "Configure a scoped Operator Job"),
                        ),
                    )
                }
                return
            }
            activeOptimizationRunId = snapshot.job.optimizationRunId ?? null
            renderOptimizationPanel(optimizationRunForSnapshot(snapshot))
            if (activeOptimizationRunId) scheduleOptimizationPoll(0)
            selectors.sessionTitle.textContent = snapshot.job.objective || snapshot.job.id
            selectors.sessionState.textContent = jobStatusText(snapshot.job.status)
            renderSessionActions(snapshot)
            patchStatus(snapshot)
            const sendPending = messageSender.isPending(snapshot.job.id)
            selectors.composerInput.disabled = sendPending
            selectors.composerSend.disabled = sendPending
            if (restoreView) {
                selectors.composerInput.value = snapshot.draft
                selectors.transcript.scrollTop = snapshot.scrollTop
            }
        }

        function saveActiveView() {
            if (!state.activeJobId || activeRenderedJobId !== state.activeJobId) return
            state.setViewState(state.activeJobId, {
                draft: selectors.composerInput.value,
                scrollTop: selectors.transcript.scrollTop,
            })
        }

        function renderVisibleSurface() {
            if (destroyed || root.classList.contains("hidden")) return
            patchJobList()
            const snapshot = state.getSnapshot(state.activeJobId)
            if (snapshot) {
                resetTranscript(snapshot)
                patchActiveChrome({restoreView: true})
            } else {
                creating = true
                selectors.setupScroll.scrollTop = 0
                patchActiveChrome()
            }
        }

        async function activateSession(sessionId) {
            if (destroyed) return
            saveActiveView()
            creating = false
            try {
                const snapshot = await state.activateSession(sessionId)
                if (destroyed || !snapshot) return
                if (!root.classList.contains("hidden")) {
                    patchJobList()
                    resetTranscript(snapshot)
                    patchActiveChrome({restoreView: true})
                }
            } catch (error) {
                if (!destroyed) onError(error)
            }
        }

        async function controlJob(jobId, action) {
            if (destroyed) return
            const method = {
                pause: "pauseOperatorJob",
                resume: "resumeOperatorJob",
                stop: "stopOperatorJob",
            }[action]
            if (!method || typeof api[method] !== "function") return
            try {
                const job = await api[method](jobId)
                if (destroyed) return
                await state.ingest("changed", {
                    generation: state.generation,
                    revision: state.revision,
                    job,
                })
            } catch (error) {
                if (!destroyed) onError(error)
            }
        }

        async function resolveApproval(approvalId, decision) {
            if (destroyed) return
            try {
                const result = await api.resolveOperatorApproval(approvalId, decision)
                if (destroyed) return
                await state.ingest("approval", {
                    generation: state.generation,
                    revision: state.revision,
                    approval: result?.approval,
                })
            } catch (error) {
                if (!destroyed) onError(error)
            }
        }

        async function approveCurrentJob(jobId) {
            if (destroyed) return
            const snapshot = state.getSnapshot(jobId)
            if (!snapshot) return
            const currentJobIds = operatorJobTreeIds(snapshot)
            for (const approval of snapshot.approvals.filter((entry) => (
                entry.status === "pending" && currentJobIds.has(entry.jobId ?? jobId)
            ))) {
                await resolveApproval(approval.id, "approve")
            }
        }

        async function ingest(kind, envelope) {
            if (destroyed) return
            try {
                await state.ingest(kind, envelope)
            } catch (error) {
                if (!destroyed) onError(error)
            }
        }

        async function createSession(event) {
            if (destroyed) return
            event.preventDefault()
            selectors.setupError.textContent = ""
            selectors.setupError.classList.add("hidden")
            if (isOptimizationSetup()) {
                try {
                    const config = optimizationConfigFromSetup()
                    const signature = JSON.stringify(config)
                    if (!optimizationPreflight?.ready || optimizationPreflightSignature !== signature) {
                        throw new Error(text(
                            "operatorPreflightRequired",
                            "Run Optimization preflight for the current configuration before Start.",
                        ))
                    }
                    selectors.optimizationStart.disabled = true
                    const run = await api.startOptimization({
                        ...config,
                        idempotencyKey: optimizationRequestId("optimization-start"),
                    })
                    if (destroyed) return
                    const reduced = reduceOptimizationTimeline(null, run)
                    optimizationRuns.set(reduced.id, reduced)
                    activeOptimizationRunId = reduced.id
                    creating = false
                    renderOptimizationPanel(reduced)
                    await state.catchUp()
                    const snapshot = state.listSnapshots().find((entry) => (
                        entry.job.optimizationRunId === reduced.id
                    ))
                    if (snapshot?.session?.id) await activateSession(snapshot.session.id)
                    else {
                        patchJobList()
                        patchActiveChrome()
                    }
                    scheduleOptimizationPoll(250)
                } catch (error) {
                    if (destroyed) return
                    selectors.setupError.textContent = localizedErrorText(error)
                    selectors.setupError.classList.remove("hidden")
                    selectors.optimizationStart.disabled = !optimizationPreflight?.ready
                }
                return
            }
            const values = {
                runtimeId: selectors.runtime.value,
                modelId: selectors.model.value,
                effort: selectors.effort.value,
                objective: selectors.setup.elements.objective.value,
                skillId: selectors.skill.value,
                datasetId: selectors.dataset.value,
                targetRuntimeIds: [...selectors.targets.querySelectorAll("[data-operator-target]:checked")]
                    .map((input) => input.value),
                maxIterations: selectors.setup.querySelector("[data-operator-max-iterations]").value,
                allowPermanentDelete: selectors.setup.querySelector(
                    '[data-operator-risk="datasets.delete"]',
                ).checked,
            }
            try {
                const request = buildOperatorSessionRequest(values, {
                    ...catalogs,
                    modelsByRuntime,
                })
                const result = await api.createOperatorSession(request)
                if (destroyed) return
                await state.ingest("changed", {
                    generation: state.generation,
                    revision: state.revision,
                    session: result.session,
                })
                if (destroyed) return
                await state.ingest("changed", {
                    generation: state.generation,
                    revision: state.revision,
                    job: result.parentJob,
                })
                if (destroyed) return
                selectors.setup.reset()
                renderSetupCatalogs()
                await activateSession(result.session.id)
            } catch (error) {
                if (destroyed) return
                selectors.setupError.textContent = localizedErrorText(error)
                selectors.setupError.classList.remove("hidden")
            }
        }

        async function sendMessage(event) {
            event.preventDefault()
            const text = selectors.composerInput.value
            const sessionId = state.activeSessionId
            const jobId = state.activeJobId
            if (destroyed || !sessionId || !jobId || !text.trim()) return
            try {
                await messageSender.send({sessionId, jobId, text})
            } catch (error) {
                if (!destroyed) onError(error)
            } finally {
                if (!destroyed && state.activeJobId === jobId) {
                    selectors.composerInput.value = state.getViewState(jobId).draft
                    const pending = messageSender.isPending(jobId)
                    selectors.composerInput.disabled = pending
                    selectors.composerSend.disabled = pending
                    selectors.composerInput.focus()
                }
            }
        }

        function initialize(initial = null) {
            return initializationGate.initialize(initial)
        }

        function setCatalogs(next = {}) {
            return surfaceGate.setCatalogs({
                runtimes: Array.isArray(next.runtimes) ? next.runtimes : [],
                skills: Array.isArray(next.skills) ? next.skills : [],
                versions: Array.isArray(next.versions) ? next.versions : [],
                datasets: Array.isArray(next.datasets) ? next.datasets : [],
                activeRuntimeId: next.activeRuntimeId ?? null,
            })
        }

        function setVisible(nextVisible) {
            const next = nextVisible === true
            if (!next) saveActiveView()
            if (!next) clearOptimizationPoll()
            return surfaceGate.setVisible(next).then((result) => {
                if (next && activeOptimizationRunId) scheduleOptimizationPoll(0)
                return result
            }).catch((error) => {
                if (!destroyed) onError(error)
                return false
            })
        }

        function localize() {
            if (destroyed) return
            renderSetupCatalogs()
            if (optimizationPreflight?.ready) renderOptimizationPreflight(optimizationPreflight)
            if (!initialized || root.classList.contains("hidden")) return
            renderVisibleSurface()
        }

        function destroy() {
            if (destroyed) return
            if (initialized) saveActiveView()
            destroyed = true
            clearOptimizationPoll()
            initializationGate.destroy()
            surfaceGate.destroy()
            messageSender.destroy()
            domEvents.destroy()
            state.destroy()
        }

        registerOperatorActionDelegates({
            listen: domEvents.listen,
            containers: {
                artifacts: selectors.artifacts,
                approvals: selectors.approvals,
                sessionActions: selectors.sessionActions,
            },
            getActiveSnapshot: () => state.getSnapshot(state.activeJobId),
            onSelectEntity,
            onResolveApproval: resolveApproval,
            onApproveCurrentJob: approveCurrentJob,
            onControlJob: controlJob,
        })

        domEvents.listen(selectors.jobList, "click", (event) => {
            const button = event.target.closest("[data-operator-job-id]")
            const snapshot = button ? state.getSnapshot(button.dataset.operatorJobId) : null
            if (snapshot?.session?.id) void activateSession(snapshot.session.id)
        })
        domEvents.listen(selectors.newJob, "click", () => {
            if (destroyed) return
            saveActiveView()
            creating = true
            selectors.setupScroll.scrollTop = 0
            patchJobList()
            patchActiveChrome()
            selectors.setup.elements.objective.focus()
        })
        domEvents.listen(selectors.runtime, "change", () => {
            if (destroyed) return
            invalidateOptimizationPreflight()
            renderSetupCatalogs()
            void loadRuntimeModels(selectors.runtime.value, true)
        })
        domEvents.listen(selectors.model, "change", () => {
            if (!destroyed) {
                invalidateOptimizationPreflight()
                renderEfforts()
            }
        })
        domEvents.listen(selectors.effort, "change", invalidateOptimizationPreflight)
        domEvents.listen(selectors.jobKind, "change", () => {
            invalidateOptimizationPreflight()
            renderOptimizationSetupMode()
        })
        domEvents.listen(selectors.skill, "change", () => {
            invalidateOptimizationPreflight()
            renderSetupCatalogs()
        })
        domEvents.listen(selectors.dataset, "change", invalidateOptimizationPreflight)
        domEvents.listen(selectors.optimizationJudgeRuntime, "change", () => {
            invalidateOptimizationPreflight()
            void loadRuntimeModels(selectors.optimizationJudgeRuntime.value)
            populateOptimizationModelSelect(
                selectors.optimizationJudgeRuntime.value,
                selectors.optimizationJudgeModel,
                selectors.optimizationJudgeEffort,
            )
        })
        domEvents.listen(selectors.optimizationJudgeModel, "change", () => {
            invalidateOptimizationPreflight()
            populateOptimizationModelSelect(
                selectors.optimizationJudgeRuntime.value,
                selectors.optimizationJudgeModel,
                selectors.optimizationJudgeEffort,
            )
        })
        domEvents.listen(selectors.optimizationJudgeEffort, "change", invalidateOptimizationPreflight)
        domEvents.listen(selectors.targets, "change", (event) => {
            if (destroyed) return
            const targetToggle = event.target.closest?.("[data-operator-target]")
            if (targetToggle) {
                const card = targetToggle.closest("[data-operator-target-card]")
                const disabled = !targetToggle.checked
                card.querySelector("[data-optimization-target-model]").disabled = disabled
                card.querySelector("[data-optimization-target-effort]").disabled = disabled
            }
            const modelSelect = event.target.closest?.("[data-optimization-target-model]")
            if (modelSelect) {
                const card = modelSelect.closest("[data-operator-target-card]")
                populateOptimizationModelSelect(
                    card.dataset.operatorTargetCard,
                    modelSelect,
                    card.querySelector("[data-optimization-target-effort]"),
                )
            }
            invalidateOptimizationPreflight()
        })
        domEvents.listen(selectors.optimizationFields, "input", invalidateOptimizationPreflight)
        domEvents.listen(selectors.optimizationFields, "change", invalidateOptimizationPreflight)
        domEvents.listen(selectors.optimizationPreflight, "click", () => { void preflightOptimization() })
        domEvents.listen(selectors.optimizationActions, "click", (event) => {
            const approvalButton = event.target.closest?.(
                "[data-operator-approval-decision][data-operator-approval-id][data-operator-job-id]",
            )
            if (approvalButton) {
                const snapshot = state.getSnapshot(state.activeJobId)
                const approval = optimizationFinalApproval(snapshot)
                const decision = approvalButton.dataset.operatorApprovalDecision
                if (
                    approval?.id === approvalButton.dataset.operatorApprovalId &&
                    approval.jobId === approvalButton.dataset.operatorJobId &&
                    ["approve", "reject"].includes(decision)
                ) void resolveApproval(approval.id, decision)
                return
            }
            const button = event.target.closest?.("[data-optimization-action][data-optimization-run-id]")
            if (button) void controlOptimization(
                button.dataset.optimizationRunId,
                button.dataset.optimizationAction,
            )
        })
        domEvents.listen(selectors.optimizationRecovery, "click", (event) => {
            const button = event.target.closest?.("[data-optimization-installation-id]")
            if (button) void onSelectEntity("installation", button.dataset.optimizationInstallationId, {
                skillId: button.dataset.optimizationSkillId,
            })
        })
        domEvents.listen(selectors.setup, "submit", (event) => { void createSession(event) })
        domEvents.listen(selectors.composer, "submit", (event) => { void sendMessage(event) })
        domEvents.listen(selectors.composerInput, "input", () => {
            if (state.activeJobId) state.setViewState(state.activeJobId, {draft: selectors.composerInput.value})
        })
        domEvents.listen(selectors.transcript, "scroll", () => {
            if (state.activeJobId) state.setViewState(state.activeJobId, {scrollTop: selectors.transcript.scrollTop})
        }, {passive: true})

        return {initialize, setCatalogs, setVisible, ingest, activateSession, localize, destroy, state, language}
    }

    const exported = {
        AUTOMATIC_OPERATOR_ACTIONS,
        OPERATOR_ACTIONS,
        OPTIONAL_OPERATOR_ACTIONS,
        OPERATOR_DELTA_INTERVAL_MS,
        artifactDeepLinks,
        buildOptimizationConfig,
        buildOperatorSessionRequest,
        createKeyedTranscriptPatcher,
        createOperatorDomListenerScope,
        createOperatorInitializationGate,
        createOperatorMessageSender,
        createOperatorSurfaceGate,
        createOperatorWorkbench,
        createOperatorWorkbenchState,
        optimizationPanelView,
        optimizationFinalApproval,
        optimizationFinalApprovalView,
        optimizationPreflightSummary,
        operatorStatusText,
        operatorJobTreeIds,
        operatorSessionActions,
        optimizationRunActions,
        reduceOptimizationTimeline,
        registerOperatorActionDelegates,
        runtimeDisplayParts,
        runtimeDisplayLabel,
        transcriptEntryKey,
    }
    if (typeof module !== "undefined" && module.exports) module.exports = exported
    if (globalObject) globalObject.RollingSkillOperatorWorkbench = exported
})(typeof globalThis === "undefined" ? this : globalThis)
