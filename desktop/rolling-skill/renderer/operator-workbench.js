(function operatorWorkbenchModule(globalObject) {
    "use strict"

    const OPERATOR_DELTA_INTERVAL_MS = 64
    const SUMMARY_PAGE_LIMIT = 100
    const MAX_SUMMARY_PAGES = 50
    const MAX_STALE_CURSOR_RETRIES = 2
    const BUDGET_FIELDS = Object.freeze([
        "maxDurationMs",
        "maxRuntimeTurns",
        "maxEvaluations",
        "maxTargetExecutions",
        "maxJudgeExecutions",
        "maxTokens",
        "maxReportedCost",
    ])

    function modelId(model) {
        return String(model?.id ?? model?.modelId ?? model?.model ?? model ?? "").trim()
    }

    function catalogForRuntime(catalogs, runtimeId) {
        const source = catalogs?.modelsByRuntime
        if (source instanceof Map) return source.get(runtimeId) ?? []
        return source?.[runtimeId] ?? []
    }

    function budgetValue(field, value) {
        if ((field === "maxTokens" || field === "maxReportedCost") && (value === "" || value === null)) {
            return null
        }
        const numeric = Number(value)
        const valid = field === "maxReportedCost"
            ? Number.isFinite(numeric) && numeric >= 0
            : Number.isSafeInteger(numeric) && numeric >= 0
        if (!valid) throw new TypeError(`Operator budget ${field} is invalid`)
        return numeric
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
        const actionIds = [...new Set((values.actionIds ?? []).filter((entry) => typeof entry === "string" && entry))]
        if (actionIds.some((action) => !OPERATOR_ACTIONS.includes(action))) {
            throw new Error("Operator action is not in the control catalog")
        }
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
        const budget = Object.fromEntries(BUDGET_FIELDS.map((field) => (
            [field, budgetValue(field, values.budget?.[field])]
        )))
        return {
            runtimeId: runtime.runtimeId,
            ...(selectedModelId ? {modelId: selectedModelId} : {}),
            ...(selectedEffort ? {effort: selectedEffort} : {}),
            objective,
            actions: actionIds,
            scopes: {
                skillIds: skill ? [skill.id] : [],
                datasetIds: values.datasetId ? [values.datasetId] : [],
                runtimeIds,
                repositoryIds: skill?.repositoryId ? [skill.repositoryId] : [],
            },
            budget,
            ...(skill ? {managedSkillBinding: {
                repositoryId: skill.repositoryId,
                skillId: skill.id,
            }} : {}),
        }
    }

    function artifactDeepLinks(artifact = {}) {
        const metadata = artifact?.metadata && typeof artifact.metadata === "object"
            ? artifact.metadata
            : {}
        const installationIds = [
            metadata.installationId,
            ...(Array.isArray(metadata.installationIds) ? metadata.installationIds.slice(0, 100) : []),
        ]
        const candidates = [
            ["dataset", metadata.datasetId, "Dataset"],
            ["case", metadata.caseId, "Case"],
            ["evaluation", metadata.evaluationId ?? metadata.runId, "Evaluation"],
            ["candidate", metadata.candidateId ?? metadata.versionId, "Candidate"],
            ...installationIds.map((id) => ["installation", id, "Installation"]),
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
            .map(([kind, id, label]) => ({kind, id, label: `${label} ${id}`}))
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
            if (!entry || !visible || snapshot?.job?.id !== activeJobId) return
            dirtyEntries.set(transcriptEntryKey(entry), {...entry})
            if (patchTimer !== null) return
            const scheduledJobId = activeJobId
            patchTimer = schedule(() => {
                patchTimer = null
                if (!visible || activeJobId !== scheduledJobId) {
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
            return error?.code === "STALE_CURSOR" || /stale[^\n]*cursor|cursor[^\n]*stale/iu.test(error?.message ?? "")
        }

        async function readAllSummaryPages() {
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
                        const page = await readSummaryPage(cursor, SUMMARY_PAGE_LIMIT)
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

        async function readAllArtifactPages(snapshot) {
            if (typeof readArtifactPage !== "function") return snapshot.artifacts
            const artifacts = new Map()
            for (const job of [...snapshot.jobs.values()].slice(0, SUMMARY_PAGE_LIMIT)) {
                const seenCursors = new Set()
                let cursor = null
                for (let pageIndex = 0; pageIndex < MAX_SUMMARY_PAGES; pageIndex += 1) {
                    const page = await readArtifactPage(job.id, cursor, SUMMARY_PAGE_LIMIT)
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
            const request = (async () => {
                const sessionId = initial.session?.id ?? initial.job?.sessionId
                if (!sessionId) return getSnapshot(jobId)
                const detail = await readOperatorSession(sessionId)
                const current = snapshots.get(jobId)
                if (!current || current !== initial) return getSnapshot(jobId)

                updateSession(detail?.session)
                updateJob(detail?.parentJob)
                if (Array.isArray(detail?.session?.transcript)) {
                    const transcript = new Map()
                    for (const entry of detail.session.transcript) {
                        transcript.set(transcriptEntryKey(entry), entry)
                    }
                    current.transcript = transcript
                    for (const [key, entry] of current.events) {
                        if (transcript.has(transcriptEntryKey(entry))) current.events.delete(key)
                    }
                }
                const artifacts = await readAllArtifactPages(current)
                if (snapshots.get(jobId) !== current) return getSnapshot(jobId)
                current.artifacts = artifacts
                current.needsDetailCatchUp = false
                if (notifyReset && visible && activeJobId === jobId) {
                    cancelActivePatch()
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
            if (catchUpPromise) return catchUpPromise
            catchUpPromise = (async () => {
                const pages = await readAllSummaryPages()
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
            visible = nextVisible === true
            if (!visible) cancelActivePatch()
        }

        async function activateSession(sessionId) {
            cancelActivePatch()
            activeSessionId = sessionId ?? null
            const root = activeSessionId ? rootForSession(activeSessionId) : null
            activeJobId = root?.id ?? null
            if (activeJobId && visible) {
                await recoverDetail(activeJobId, {reason: "activation", notifyReset: false})
                const snapshot = snapshots.get(activeJobId)
                if (snapshot) snapshot.unread = emptyUnread()
            }
            return activeJobId ? getSnapshot(activeJobId) : null
        }

        async function ensureActiveCaughtUp() {
            if (!visible || !activeJobId) return activeJobId ? getSnapshot(activeJobId) : null
            const jobId = activeJobId
            await recoverDetail(jobId, {reason: "activation", notifyReset: false})
            const snapshot = snapshots.get(jobId)
            if (snapshot && !snapshot.needsDetailCatchUp) snapshot.unread = emptyUnread()
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
    ])

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

    function scopeText(scope = {}) {
        const parts = []
        for (const [key, values] of Object.entries(scope ?? {})) {
            if (Array.isArray(values) && values.length) parts.push(`${key}: ${values.join(", ")}`)
            else if (values !== null && values !== undefined && values !== "") parts.push(`${key}: ${String(values)}`)
        }
        return parts.join(" · ") || "No additional scope"
    }

    function createOperatorWorkbench(options = {}) {
        const api = options.api
        const root = options.root
        const document_ = root?.ownerDocument ?? globalObject?.document
        if (!api || !root || !document_) throw new TypeError("Operator workbench DOM options are required")
        const onError = options.onError ?? (() => {})
        const onSelectEntity = options.onSelectEntity ?? (() => {})
        const language = options.language ?? (() => "en")
        const selectors = {
            jobList: root.querySelector("#operator-job-list"),
            newJob: root.querySelector("#operator-new-job"),
            setup: root.querySelector("#operator-setup-form"),
            setupError: root.querySelector("#operator-setup-error"),
            runtime: root.querySelector("#operator-runtime"),
            model: root.querySelector("#operator-model"),
            effort: root.querySelector("#operator-effort"),
            skill: root.querySelector("#operator-managed-skill"),
            dataset: root.querySelector("#operator-managed-dataset"),
            targets: root.querySelector("#operator-target-runtimes"),
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
        }
        if (Object.values(selectors).some((element) => !element)) {
            throw new Error("Operator workbench markup is incomplete")
        }

        let catalogs = {runtimes: [], skills: [], datasets: [], activeRuntimeId: null}
        const modelsByRuntime = new Map()
        const modelLoads = new Map()
        const jobNodes = new Map()
        const unsubscribers = []
        let initialized = false
        let creating = false
        let activeRenderedJobId = null
        let visibilityEpoch = 0

        const state = createOperatorWorkbenchState({
            readSummaryPage: (cursor, limit) => api.readOperatorSummaryPage(cursor, limit),
            readOperatorSession: (sessionId) => api.getOperatorSession(sessionId),
            readArtifactPage: (jobId, cursor, limit) => api.listOperatorArtifacts(jobId, cursor, limit),
            onListPatch: () => {
                if (!initialized || root.classList.contains("hidden")) return
                patchJobList()
                patchActiveChrome()
            },
            onActivePatch: ({jobId, entries}) => {
                if (root.classList.contains("hidden")) return
                if (jobId !== state.activeJobId || activeRenderedJobId !== jobId) return
                transcriptPatcher.patch(entries)
            },
            onActiveReset: ({jobId}) => {
                if (root.classList.contains("hidden") || jobId !== state.activeJobId) return
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
                card.querySelector(".operator-entry-label").textContent = role === "activity"
                    ? String(entry.kind ?? "activity").replaceAll("_", " ")
                    : role
                card.querySelector(".operator-entry-copy").textContent = entryText(entry)
            },
        })

        function availableModels(runtimeId) {
            return modelsByRuntime.get(runtimeId) ?? []
        }

        function appendOption(select, value, label) {
            const option = createElement(document_, "option", "", label)
            option.value = value
            select.append(option)
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
            appendOption(selectors.effort, "", "Runtime default")
            for (const effort of [...new Set(efforts)]) appendOption(selectors.effort, effort, effort)
            selectors.effort.value = efforts.includes(selected) ? selected : ""
        }

        function renderModels(runtimeId) {
            const selected = selectors.model.value
            selectors.model.replaceChildren()
            appendOption(selectors.model, "", modelLoads.has(runtimeId) ? "Loading models…" : "Runtime default")
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
            if (!runtimeId || (modelsByRuntime.has(runtimeId) && !force)) {
                renderModels(runtimeId)
                return
            }
            if (modelLoads.has(runtimeId)) return modelLoads.get(runtimeId)
            const request = (async () => {
                renderModels(runtimeId)
                try {
                    const response = await api.listModelsForRuntime(runtimeId)
                    modelsByRuntime.set(runtimeId, Array.isArray(response?.data) ? response.data : [])
                } catch (error) {
                    modelsByRuntime.set(runtimeId, [])
                    onError(error)
                } finally {
                    modelLoads.delete(runtimeId)
                    if (selectors.runtime.value === runtimeId) renderModels(runtimeId)
                }
            })()
            modelLoads.set(runtimeId, request)
            renderModels(runtimeId)
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
                    `${runtime.displayName ?? runtime.providerId ?? runtime.runtimeId}${runtime.version ? ` ${runtime.version}` : ""}`,
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
            setSelectOptions(
                selectors.skill,
                catalogs.skills.filter((entry) => entry.status === undefined || entry.status === "valid")
                    .map((entry) => ({id: entry.id, label: entry.name ?? entry.id})),
                selectors.skill.value,
                "No managed Skill",
            )
            setSelectOptions(
                selectors.dataset,
                catalogs.datasets.map((entry) => ({id: entry.id, label: entry.name ?? entry.id})),
                selectors.dataset.value,
                "No Dataset",
            )
            const selectedTargets = new Set(
                [...selectors.targets.querySelectorAll("[data-operator-target]:checked")]
                    .map((input) => input.value),
            )
            selectors.targets.replaceChildren()
            for (const runtime of catalogs.runtimes) {
                const label = createElement(document_, "label", "operator-check")
                const input = document_.createElement("input")
                input.type = "checkbox"
                input.value = runtime.runtimeId
                input.dataset.operatorTarget = runtime.runtimeId
                input.checked = selectedTargets.size
                    ? selectedTargets.has(runtime.runtimeId)
                    : runtime.runtimeId === selectors.runtime.value
                label.append(input, createElement(document_, "span", "", runtime.displayName ?? runtime.runtimeId))
                selectors.targets.append(label)
            }
            void loadRuntimeModels(selectors.runtime.value)
        }

        function jobStatusText(status) {
            return String(status ?? "unknown").replaceAll("_", " ")
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
                    createElement(document_, "div", "operator-empty", "No Operator Jobs yet")
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
            selectors.scope.textContent = scopeText(configuration.scopes ?? configuration.scope)
            selectors.budget.textContent = Object.entries(snapshot.job.budget ?? {})
                .map(([key, value]) => `${key}: ${value ?? "unlimited"}`)
                .join(" · ") || "No budget details"
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
                "No child Jobs",
            )
            renderList(
                selectors.artifacts,
                snapshot.artifacts,
                (artifact) => {
                    const card = createElement(document_, "article", "operator-side-card operator-artifact-card")
                    card.dataset.operatorArtifactId = artifact.id
                    card.append(
                        createElement(document_, "strong", "", artifact.name ?? artifact.kind ?? artifact.id),
                        createElement(document_, "small", "", `${artifact.kind ?? "artifact"} · ${artifact.byteLength ?? 0} bytes`),
                    )
                    const links = artifactDeepLinks(artifact)
                    if (links.length) {
                        const actions = createElement(document_, "div", "operator-inline-actions")
                        for (const link of links) {
                            const button = createElement(document_, "button", "operator-link", link.label)
                            button.type = "button"
                            button.dataset.operatorEntityKind = link.kind
                            button.dataset.operatorEntityId = link.id
                            button.addEventListener("click", () => onSelectEntity(link.kind, link.id, artifact.metadata ?? {}))
                            actions.append(button)
                        }
                        card.append(actions)
                    }
                    return card
                },
                "No artifacts",
            )
            const pending = snapshot.approvals.filter((approval) => approval.status === "pending")
            renderList(
                selectors.approvals,
                snapshot.approvals,
                (approval) => {
                    const card = createElement(document_, "article", "operator-approval-card")
                    card.dataset.operatorApprovalId = approval.id
                    card.append(
                        createElement(document_, "strong", "operator-approval-action", approval.action ?? "Unknown action"),
                        createElement(document_, "p", "operator-approval-scope", scopeText(approval.scope)),
                        createElement(document_, "small", "operator-approval-status", jobStatusText(approval.status)),
                    )
                    if (approval.status === "pending") {
                        const actions = createElement(document_, "div", "operator-approval-actions")
                        for (const [decision, label] of [["reject", "Reject"], ["approve", "Approve once"]]) {
                            const button = createElement(document_, "button", decision === "approve" ? "primary" : "", label)
                            button.type = "button"
                            button.dataset.operatorApprovalDecision = decision
                            button.addEventListener("click", () => void resolveApproval(approval.id, decision))
                            actions.append(button)
                        }
                        if (pending.length > 1) {
                            const approveJob = createElement(document_, "button", "", "Approve current Job")
                            approveJob.type = "button"
                            approveJob.dataset.operatorApproveJob = snapshot.job.id
                            approveJob.addEventListener("click", () => void approveCurrentJob(snapshot.job.id))
                            actions.append(approveJob)
                        }
                        card.append(actions)
                    }
                    return card
                },
                "No approvals",
            )
        }

        function renderSessionActions(snapshot) {
            selectors.sessionActions.replaceChildren()
            const actions = []
            if (snapshot.job.status === "running") actions.push(["pause", "Pause"])
            if (snapshot.job.status === "paused") actions.push(["resume", "Resume"])
            if (!["succeeded", "failed", "cancelled"].includes(snapshot.job.status)) {
                actions.push(["stop", "Stop"])
            }
            for (const [action, label] of actions) {
                const button = createElement(document_, "button", "operator-control-button", label)
                button.type = "button"
                button.dataset.operatorJobAction = action
                button.addEventListener("click", () => void controlJob(snapshot.job.id, action))
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
                if (creating) {
                    selectors.transcript.replaceChildren(
                        createElement(document_, "div", "operator-empty operator-setup-prompt", "Configure a scoped Operator Job"),
                    )
                }
                return
            }
            selectors.sessionTitle.textContent = snapshot.job.objective || snapshot.job.id
            selectors.sessionState.textContent = jobStatusText(snapshot.job.status)
            renderSessionActions(snapshot)
            patchStatus(snapshot)
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

        async function activateSession(sessionId) {
            saveActiveView()
            creating = false
            try {
                const snapshot = await state.activateSession(sessionId)
                if (!snapshot) return
                if (!root.classList.contains("hidden")) {
                    patchJobList()
                    resetTranscript(snapshot)
                    patchActiveChrome({restoreView: true})
                }
            } catch (error) {
                onError(error)
            }
        }

        async function controlJob(jobId, action) {
            const method = {
                pause: "pauseOperatorJob",
                resume: "resumeOperatorJob",
                stop: "stopOperatorJob",
            }[action]
            if (!method || typeof api[method] !== "function") return
            try {
                const job = await api[method](jobId)
                await state.ingest("changed", {
                    generation: state.generation,
                    revision: state.revision,
                    job,
                })
            } catch (error) {
                onError(error)
            }
        }

        async function resolveApproval(approvalId, decision) {
            try {
                const result = await api.resolveOperatorApproval(approvalId, decision)
                await state.ingest("approval", {
                    generation: state.generation,
                    revision: state.revision,
                    approval: result?.approval,
                })
            } catch (error) {
                onError(error)
            }
        }

        async function approveCurrentJob(jobId) {
            const snapshot = state.getSnapshot(jobId)
            if (!snapshot) return
            for (const approval of snapshot.approvals.filter((entry) => entry.status === "pending")) {
                await resolveApproval(approval.id, "approve")
            }
        }

        async function ingest(kind, envelope) {
            try {
                await state.ingest(kind, envelope)
            } catch (error) {
                onError(error)
            }
        }

        async function createSession(event) {
            event.preventDefault()
            selectors.setupError.textContent = ""
            selectors.setupError.classList.add("hidden")
            const values = {
                runtimeId: selectors.runtime.value,
                modelId: selectors.model.value,
                effort: selectors.effort.value,
                objective: selectors.setup.elements.objective.value,
                skillId: selectors.skill.value,
                datasetId: selectors.dataset.value,
                targetRuntimeIds: [...selectors.targets.querySelectorAll("[data-operator-target]:checked")]
                    .map((input) => input.value),
                actionIds: [...selectors.setup.querySelectorAll("[data-operator-action]:checked")]
                    .map((input) => input.value),
                budget: Object.fromEntries(
                    [...selectors.setup.querySelectorAll("[data-operator-budget]")]
                        .map((input) => [input.dataset.operatorBudget, input.value]),
                ),
            }
            try {
                const request = buildOperatorSessionRequest(values, {
                    ...catalogs,
                    modelsByRuntime,
                })
                const result = await api.createOperatorSession(request)
                await state.ingest("changed", {
                    generation: state.generation,
                    revision: state.revision,
                    session: result.session,
                })
                await state.ingest("changed", {
                    generation: state.generation,
                    revision: state.revision,
                    job: result.parentJob,
                })
                selectors.setup.reset()
                renderSetupCatalogs()
                await activateSession(result.session.id)
            } catch (error) {
                selectors.setupError.textContent = error?.message ?? String(error)
                selectors.setupError.classList.remove("hidden")
            }
        }

        async function sendMessage(event) {
            event.preventDefault()
            const text = selectors.composerInput.value
            if (!state.activeSessionId || !text.trim()) return
            selectors.composerInput.disabled = true
            selectors.composerSend.disabled = true
            try {
                await api.sendOperatorMessage(state.activeSessionId, text)
                selectors.composerInput.value = ""
                state.setViewState(state.activeJobId, {draft: ""})
            } catch (error) {
                onError(error)
            } finally {
                selectors.composerInput.disabled = false
                selectors.composerSend.disabled = false
                selectors.composerInput.focus()
            }
        }

        async function initialize(initial = null) {
            const bootstrap = initial ?? await api.bootstrapOperator()
            state.setVisible(!root.classList.contains("hidden"))
            state.initialize(bootstrap)
            initialized = true
            if (bootstrap?.truncated || bootstrap?.nextCursor !== null) await state.catchUp()
            const first = state.listSnapshots()[0]
            if (first) await activateSession(first.session?.id ?? first.job.sessionId)
            else {
                creating = true
                if (!root.classList.contains("hidden")) patchActiveChrome()
            }
            for (const [kind, method] of [
                ["changed", "onOperatorChanged"],
                ["event", "onOperatorEvent"],
                ["approval", "onOperatorApproval"],
                ["artifact", "onOperatorArtifact"],
            ]) {
                if (typeof api[method] !== "function") continue
                unsubscribers.push(api[method]((payload) => { void ingest(kind, payload) }))
            }
        }

        function setCatalogs(next = {}) {
            catalogs = {
                runtimes: Array.isArray(next.runtimes) ? next.runtimes : [],
                skills: Array.isArray(next.skills) ? next.skills : [],
                datasets: Array.isArray(next.datasets) ? next.datasets : [],
                activeRuntimeId: next.activeRuntimeId ?? null,
            }
            renderSetupCatalogs()
        }

        function setVisible(nextVisible) {
            const next = nextVisible === true
            const epoch = ++visibilityEpoch
            if (!next) saveActiveView()
            state.setVisible(next)
            if (!next) {
                root.classList.add("hidden")
                return
            }
            root.classList.add("hidden")
            void (async () => {
                try {
                    await state.ensureActiveCaughtUp()
                    if (epoch !== visibilityEpoch) return
                    root.classList.remove("hidden")
                    patchJobList()
                    const snapshot = state.getSnapshot(state.activeJobId)
                    if (snapshot) {
                        resetTranscript(snapshot)
                        patchActiveChrome({restoreView: true})
                    } else {
                        creating = true
                        patchActiveChrome()
                    }
                } catch (error) {
                    if (epoch === visibilityEpoch) root.classList.remove("hidden")
                    onError(error)
                }
            })()
        }

        function destroy() {
            saveActiveView()
            state.destroy()
            for (const unsubscribe of unsubscribers.splice(0)) unsubscribe?.()
        }

        selectors.jobList.addEventListener("click", (event) => {
            const button = event.target.closest("[data-operator-job-id]")
            const snapshot = button ? state.getSnapshot(button.dataset.operatorJobId) : null
            if (snapshot?.session?.id) void activateSession(snapshot.session.id)
        })
        selectors.newJob.addEventListener("click", () => {
            saveActiveView()
            creating = true
            patchJobList()
            patchActiveChrome()
            selectors.setup.elements.objective.focus()
        })
        selectors.runtime.addEventListener("change", () => {
            renderSetupCatalogs()
            void loadRuntimeModels(selectors.runtime.value, true)
        })
        selectors.model.addEventListener("change", renderEfforts)
        selectors.setup.addEventListener("submit", (event) => { void createSession(event) })
        selectors.composer.addEventListener("submit", (event) => { void sendMessage(event) })
        selectors.composerInput.addEventListener("input", () => {
            if (state.activeJobId) state.setViewState(state.activeJobId, {draft: selectors.composerInput.value})
        })
        selectors.transcript.addEventListener("scroll", () => {
            if (state.activeJobId) state.setViewState(state.activeJobId, {scrollTop: selectors.transcript.scrollTop})
        }, {passive: true})

        for (const action of OPERATOR_ACTIONS) {
            if (selectors.setup.querySelector(`[data-operator-action="${action}"]`)) continue
            const label = createElement(document_, "label", "operator-check")
            const input = document_.createElement("input")
            input.type = "checkbox"
            input.value = action
            input.dataset.operatorAction = action
            input.checked = action.endsWith(".read") || action === "context.read"
            label.append(input, createElement(document_, "span", "", action))
            selectors.setup.querySelector("#operator-permission-grants")?.append(label)
        }

        return {initialize, setCatalogs, setVisible, ingest, activateSession, destroy, state, language}
    }

    const exported = {
        OPERATOR_ACTIONS,
        OPERATOR_DELTA_INTERVAL_MS,
        artifactDeepLinks,
        buildOperatorSessionRequest,
        createKeyedTranscriptPatcher,
        createOperatorWorkbench,
        createOperatorWorkbenchState,
        transcriptEntryKey,
    }
    if (typeof module !== "undefined" && module.exports) module.exports = exported
    if (globalObject) globalObject.RollingSkillOperatorWorkbench = exported
})(typeof globalThis === "undefined" ? this : globalThis)
