const {
    buildBoundaryPrompt,
    buildOutcomePrompt,
    dueCaptureSlot,
    nextScheduledSlot,
    parseBoundaryResult,
    parseOutcomeResult,
    partitionUserMessages,
} = require("./conversation-discovery.cjs")
const {
    buildEpisodeSnapshot,
    flattenThread,
    userMessageText,
} = require("./episode-curation.cjs")

const MAX_TIMER_DELAY = 2_147_000_000
const AUTOMATIC_CONFIDENCE_THRESHOLD = 0.8
const ROLLING_SKILL_INTERNAL_PROMPT_PREFIXES = [
    "Identify complete user problem ranges from incremental user messages only.",
    "Classify only this completed problem episode. Identify the principal enabled Skill,",
    "You are judging one agent Skill evaluation result.",
    "You are the Curator for an agent Skill evaluation dataset.",
    "You are the Rubric Agent for one Skill evaluation dataset.",
    "Re-execute the immutable evaluation question below with the current Skill and current",
]

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function messageText(item) {
    if (typeof item?.text === "string") return item.text
    return userMessageText(item?.content)
}

function runtimeIdFrom(descriptor) {
    const value = descriptor?.runtimeId ?? descriptor?.runtime?.runtimeId
    const normalized = String(value ?? "").trim()
    if (!normalized) throw new Error("Automatic capture requires an active Runtime identity")
    return normalized
}

function responseText(value) {
    if (typeof value === "string") return value
    for (const field of ["response", "text", "output"]) {
        if (typeof value?.[field] === "string") return value[field]
    }
    throw new Error("Automatic capture analysis returned no text")
}

function arrays(value) {
    return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
}

function normalizedSkillName(value) {
    return String(value ?? "").trim().toLocaleLowerCase("en-US")
}

function sameAutomaticSkill(left, right) {
    if (!left || !right) return false
    const leftId = String(left.id ?? "").trim()
    const rightId = String(right.id ?? "").trim()
    if (leftId && rightId) return leftId === rightId
    if (!normalizedSkillName(left.name) || normalizedSkillName(left.name) !== normalizedSkillName(right.name)) {
        return false
    }
    const leftPath = String(left.path ?? "").trim()
    const rightPath = String(right.path ?? "").trim()
    return !leftPath || !rightPath || leftPath === rightPath
}

function automaticDatasetFor(candidate, datasets, preferredDatasetId = null) {
    const confidence = Number(candidate?.confidence)
    if (
        !Number.isFinite(confidence) ||
        confidence < AUTOMATIC_CONFIDENCE_THRESHOLD ||
        candidate?.outcome === "uncertain" ||
        !candidate?.skill
    ) return null
    const matches = arrays(datasets).filter((dataset) => (
        sameAutomaticSkill(dataset?.skillReference, candidate.skill)
    ))
    if (Array.isArray(preferredDatasetId) && preferredDatasetId.length) {
        const routed = matches.filter((dataset) => preferredDatasetId.some((target) => (
            target?.datasetId === dataset.id &&
            target?.skillId === dataset.skillReference?.id
        )))
        return routed.length === 1 ? routed[0] : null
    }
    const preferred = matches.find((dataset) => dataset.id === preferredDatasetId)
    if (preferred) return preferred
    return matches.length === 1 ? matches[0] : null
}

function closeAnsweredPendingTail(boundary, batch) {
    if (!boundary.pendingStartUserItemId) return boundary
    const pendingIndex = batch.findIndex(
        (message) => message.id === boundary.pendingStartUserItemId,
    )
    const pending = pendingIndex >= 0 ? batch.slice(pendingIndex) : []
    if (!pending.length || pending.some((message) => !message.assistantCompleted)) return boundary
    return {
        segments: [
            ...boundary.segments,
            {
                startUserItemId: pending[0].id,
                endUserItemId: pending.at(-1).id,
                summary: pending.map((message) => message.text.trim()).join(" ").slice(0, 500),
            },
        ],
        pendingStartUserItemId: null,
    }
}

function deferIncompleteSegments(boundary, batch) {
    let pendingStartUserItemId = boundary.pendingStartUserItemId
    const segments = []
    for (const segment of boundary.segments) {
        const end = batch.find((message) => message.id === segment.endUserItemId)
        if (!end?.assistantCompleted) {
            pendingStartUserItemId ??= segment.startUserItemId
            continue
        }
        segments.push(segment)
    }
    return {segments, pendingStartUserItemId}
}

function isAutomaticAnalysisTask(messages) {
    return messages.some((message) => ROLLING_SKILL_INTERNAL_PROMPT_PREFIXES.some(
        (prefix) => {
            const text = message.text.trimStart()
            if (text.startsWith(prefix)) return true
            const offset = text.indexOf(prefix)
            return text.startsWith("/") && offset > 0 && offset <= 200
        },
    ))
}

function completedTurn(status) {
    return status === undefined || status === null || status === "completed"
}

function sourceMatchesSession(observation, session) {
    const source = session?.episode?.source ?? session?.source
    if (!observation || !source) return false
    return (
        String(observation.threadId ?? "") === String(source.threadId ?? "") &&
        String(observation.endItemId ?? "") === String(source.endItemId ?? "")
    )
}

class ConversationDiscoveryManager {
    constructor({
        store,
        stateStore,
        rawCaseStore,
        getRuntime,
        getRuntimeDescriptor,
        curationManager = null,
        listDatasets = () => store.listDatasets(),
        listSkills = async () => [],
        runAnalysis,
        captureEpisode = null,
        saveEvidence = null,
        getHiddenThreadIds = () => new Set(),
        now = () => new Date(),
        setTimer = (callback, delay) => setTimeout(callback, delay),
        clearTimer = (timer) => clearTimeout(timer),
        onStatus = () => {},
        onError = () => {},
    }) {
        this.store = store
        this.stateStore = stateStore
        this.rawCaseStore = rawCaseStore
        this.getRuntime = getRuntime
        this.getRuntimeDescriptor = getRuntimeDescriptor
        this.curationManager = curationManager
        this.listDatasets = listDatasets
        this.listSkills = listSkills
        this.runAnalysis = runAnalysis
        this.captureEpisode = captureEpisode
        this.saveEvidence = saveEvidence
        this.getHiddenThreadIds = getHiddenThreadIds
        this.now = now
        this.setTimer = setTimer
        this.clearTimer = clearTimer
        this.onStatus = onStatus
        this.onError = onError
        this.analysisThreadIds = new Set()
        this.automaticSessions = new Map()
        this.automaticArchiveAttempts = new Set()
        this.automaticRecoveryAttempts = new Set()
        this.runningPromise = null
        this.timer = null
        this.started = false
    }

    profile() {
        return this.store.read().settings.autoCaptureProfile
    }

    hiddenThreadIds() {
        return new Set(this.analysisThreadIds)
    }

    allHiddenThreadIds() {
        return new Set([
            ...this.analysisThreadIds,
            ...(this.getHiddenThreadIds?.() ?? []),
            ...(this.curationManager?.hiddenThreadIds?.() ?? []),
        ])
    }

    pendingCount() {
        return (this.rawCaseStore.list?.() ?? []).filter(
            (entry) => entry.source?.kind === "automatic_capture" ||
                Array.isArray(entry.source?.observations),
        ).length
    }

    status() {
        const profile = this.profile()
        const persisted = this.stateStore.read()
        let nextRunAt = null
        if (profile.mode !== "off") {
            nextRunAt = nextScheduledSlot(this.now(), profile.schedule).toISOString()
        }
        return {
            mode: profile.mode,
            nextRunAt,
            running: Boolean(this.runningPromise),
            pendingCount: this.pendingCount(),
            lastSuccessAt: persisted.lastSuccessAt,
            error: persisted.lastError?.message ?? null,
        }
    }

    emitStatus() {
        const status = this.status()
        this.onStatus(copy(status))
        return status
    }

    start() {
        if (this.started) return
        this.started = true
        this.reschedule()
        void this.runDueScan()
    }

    stop() {
        this.started = false
        if (this.timer !== null) {
            this.clearTimer(this.timer)
            this.timer = null
        }
        this.emitStatus()
    }

    reschedule() {
        if (this.timer !== null) {
            this.clearTimer(this.timer)
            this.timer = null
        }
        const profile = this.profile()
        if (profile.mode === "off") {
            this.emitStatus()
            return null
        }
        const next = nextScheduledSlot(this.now(), profile.schedule)
        const delay = Math.max(1, Math.min(MAX_TIMER_DELAY, next.getTime() - this.now().getTime()))
        this.timer = this.setTimer(() => {
            this.timer = null
            void this.runDueScan().finally(() => {
                if (this.started) this.reschedule()
            })
        }, delay)
        this.emitStatus()
        return next
    }

    async handleNotification() {
        return false
    }

    async handleCurationChanged(session) {
        const tracked = this.trackAutomaticSession(session)
        if (
            !tracked ||
            session.status !== "needs_review" ||
            !session.draft ||
            this.automaticArchiveAttempts.has(session.id)
        ) return false
        this.automaticArchiveAttempts.add(session.id)
        try {
            const savedCase = await this.curationManager.archive(session.id)
            this.rawCaseStore.markDispatched(tracked.rawCaseId, {
                mode: "automatic",
                caseId: savedCase.id,
            })
            this.automaticSessions.delete(session.id)
            this.emitStatus()
            return true
        } catch (error) {
            this.automaticArchiveAttempts.delete(session.id)
            this.onError(error)
            this.emitStatus()
            return false
        }
    }

    trackAutomaticSession(session) {
        if (!session?.id) return null
        const existing = this.automaticSessions.get(session.id)
        if (existing) return existing
        const rawCase = (this.rawCaseStore.list?.() ?? []).find((record) => {
            const observations = Array.isArray(record?.source?.observations)
                ? record.source.observations
                : record?.source?.kind === "automatic_capture"
                    ? [record.source]
                    : []
            return observations.some((observation) => sourceMatchesSession(observation, session))
        })
        if (!rawCase?.id) return null
        const tracked = {rawCaseId: rawCase.id}
        this.automaticSessions.set(session.id, tracked)
        return tracked
    }

    async recoverAutomaticSessions() {
        if (this.profile().mode !== "automatic" || !this.curationManager?.listSessions) {
            return false
        }
        let recovered = false
        const sessions = await Promise.resolve(this.curationManager.listSessions({archived: false}))
        for (const session of arrays(sessions)) {
            if (!this.trackAutomaticSession(session)) continue
            recovered = true
            if (session.status === "needs_review" && session.draft) {
                await this.handleCurationChanged(session)
                continue
            }
            if (
                session.status === "failed" &&
                /Curator task was interrupted when Rolling Skill stopped/u.test(session.error ?? "") &&
                typeof this.curationManager.retry === "function" &&
                !this.automaticRecoveryAttempts.has(session.id)
            ) {
                this.automaticRecoveryAttempts.add(session.id)
                const retried = await this.curationManager.retry(session.id)
                await this.handleCurationChanged(retried)
            }
        }
        return recovered
    }

    async runDueScan() {
        const profile = this.profile()
        if (profile.mode === "off") {
            this.emitStatus()
            return false
        }
        if (this.runningPromise) return false
        const slot = dueCaptureSlot({
            now: this.now(),
            schedule: profile.schedule,
            lastScheduledSlot: this.stateStore.read().lastScheduledSlot,
        })
        if (!slot) {
            this.emitStatus()
            return false
        }
        const operation = this.runSlot(slot, profile)
        this.runningPromise = operation
        this.emitStatus()
        try {
            await operation
            return true
        } catch (error) {
            this.stateStore.failSlot(error, this.now())
            this.onError(error)
            return false
        } finally {
            if (this.runningPromise === operation) this.runningPromise = null
            this.emitStatus()
        }
    }

    async runSlot(slot, profile = this.profile()) {
        this.stateStore.beginSlot(slot, this.now())
        const runtime = await this.getRuntime()
        const runtimeId = runtimeIdFrom(this.getRuntimeDescriptor())
        const [threads, skillsValue, datasetsValue] = await Promise.all([
            this.listAllThreads(runtime),
            this.listSkills(runtime),
            Promise.resolve(this.listDatasets()),
        ])
        const skills = arrays(skillsValue)
        const datasets = arrays(datasetsValue)
        const targets = arrays(profile.targets)
        const scopedDatasets = targets.length
            ? datasets.filter((dataset) => targets.some((target) => (
                target?.datasetId === dataset.id &&
                target?.skillId === dataset.skillReference?.id
            )))
            : datasets
        const scopedSkills = targets.length
            ? skills.filter((skill) => scopedDatasets.some((dataset) => (
                sameAutomaticSkill(dataset.skillReference, skill)
            )))
            : skills
        const hidden = this.allHiddenThreadIds()
        for (const summary of threads) {
            if (!summary?.id || hidden.has(summary.id)) continue
            await this.scanThread({
                runtime,
                runtimeId,
                threadId: summary.id,
                skills: scopedSkills,
                datasets: scopedDatasets,
                profile,
            })
        }
        this.stateStore.completeSlot(slot, this.now())
    }

    async listAllThreads(runtime) {
        const found = new Map()
        for (const archived of [false, true]) {
            let cursor = null
            const seenCursors = new Set()
            for (let page = 0; page < 100; page += 1) {
                const response = await runtime.listThreads({
                    archived,
                    ...(cursor ? {cursor} : {}),
                    limit: 100,
                })
                for (const entry of response?.data ?? []) {
                    if (entry?.id && !found.has(entry.id)) found.set(entry.id, entry)
                }
                const next = response?.nextCursor ?? null
                if (!next || seenCursors.has(next)) break
                seenCursors.add(next)
                cursor = next
            }
        }
        return [...found.values()]
    }

    userMessages(thread) {
        const flattened = flattenThread(thread)
        const turnStatuses = new Map(
            (thread?.turns ?? []).map((turn) => [String(turn.id ?? ""), turn.status]),
        )
        return flattened
            .map(({turnId, item}, index) => ({
                index,
                id: String(item.id ?? ""),
                turnId: String(turnId ?? ""),
                text: messageText(item),
                type: item?.type,
            }))
            .filter((message) => message.type === "userMessage")
            .map((message, index, messages) => {
                const nextUserIndex = messages[index + 1]?.index ?? flattened.length
                return {
                    id: message.id,
                    turnId: message.turnId,
                    text: message.text,
                    assistantCompleted: flattened.some(({turnId, item}, flattenedIndex) => (
                        flattenedIndex > message.index &&
                        flattenedIndex < nextUserIndex &&
                        item?.type === "agentMessage" &&
                        completedTurn(turnStatuses.get(String(turnId ?? "")))
                    )),
                }
            })
            .filter((message) => message.id && message.turnId && message.text.trim())
    }

    async analyze(stage, prompt, profile) {
        if (typeof this.runAnalysis !== "function") {
            throw new Error("Automatic capture analysis Runtime is not configured")
        }
        const result = await this.runAnalysis({
            stage,
            prompt,
            modelId: profile.modelId,
            effort: profile.effort,
            onThreadStarted: (threadId) => {
                if (threadId) this.analysisThreadIds.add(threadId)
            },
        })
        if (result?.threadId) this.analysisThreadIds.add(result.threadId)
        return responseText(result)
    }

    async episodeForSegment(thread, segment, runtimeId) {
        const flattened = flattenThread(thread)
        const startIndex = flattened.findIndex(
            ({item}) => item.type === "userMessage" && item.id === segment.startUserItemId,
        )
        const endUserIndex = flattened.findIndex(
            ({item}) => item.type === "userMessage" && item.id === segment.endUserItemId,
        )
        if (startIndex < 0 || endUserIndex < startIndex) {
            throw new Error("Automatic capture boundary no longer exists in the source task")
        }
        let nextUserIndex = flattened.findIndex(
            ({item}, index) => index > endUserIndex && item.type === "userMessage",
        )
        if (nextUserIndex < 0) nextUserIndex = flattened.length
        let endIndex = -1
        const turnStatuses = new Map(
            (thread?.turns ?? []).map((turn) => [String(turn.id ?? ""), turn.status]),
        )
        for (let index = endUserIndex + 1; index < nextUserIndex; index += 1) {
            if (
                flattened[index].item.type === "agentMessage" &&
                completedTurn(turnStatuses.get(String(flattened[index].turnId ?? "")))
            ) endIndex = index
        }
        if (endIndex < 0) {
            throw new Error("Automatic capture candidate has no final Assistant response")
        }
        if (thread.modelProvider === "deepseek-harness") {
            if (typeof this.captureEpisode !== "function") {
                throw new Error("Automatic capture trusted DSH episode source is unavailable")
            }
            const startSeq = flattened[startIndex].item.sourceSeq
            const endMessageId = flattened[endIndex].item.sourceMessageId
            if (!Number.isSafeInteger(startSeq) || !String(endMessageId ?? "").trim()) {
                throw new Error("Automatic capture cannot freeze the DSH source range")
            }
            const captured = await this.captureEpisode({
                sessionId: thread.id,
                startSeq,
                endMessageId,
            })
            if (!captured?.episode) {
                throw new Error("Automatic capture returned no trusted DSH episode")
            }
            return captured.episode
        }
        return buildEpisodeSnapshot(thread, {
            startItemId: flattened[startIndex].item.id,
            startTurnId: flattened[startIndex].turnId,
            endItemId: flattened[endIndex].item.id,
            endTurnId: flattened[endIndex].turnId,
            runtimeId,
        })
    }

    async classifySegment({thread, threadId, runtimeId, segment, skills, datasets, profile}) {
        const episode = await this.episodeForSegment(thread, segment, runtimeId)
        if (this.store.hasCurationForSource?.(threadId, episode.source.endItemId)) {
            return {
                irrelevant: true,
                skipReason: "already_curated",
                episode,
                result: null,
            }
        }
        const prompt = buildOutcomePrompt({threadId, episode, skills, datasets})
        const result = parseOutcomeResult(await this.analyze("outcome", prompt, profile), {
            skillNames: skills.map((skill) => skill.name).filter(Boolean),
            assistantItemIds: episode.items
                .filter((item) => item.type === "agentMessage")
                .map((item) => item.id),
        })
        if (!result.eligibleForCase) {
            return {
                irrelevant: true,
                skipReason: `ineligible_${result.sourceKind}`,
                episode,
                result,
            }
        }
        if (result.outcome === "uncertain") {
            return {irrelevant: true, skipReason: "uncertain_outcome", episode, result}
        }
        if (result.confidence < AUTOMATIC_CONFIDENCE_THRESHOLD) {
            return {irrelevant: true, skipReason: "low_confidence", episode, result}
        }
        const matchingSkills = skills.filter((entry) => entry.name === result.skillName)
        if (matchingSkills.length > 1) {
            throw new Error(`Automatic capture has an ambiguous managed Skill name: ${result.skillName}`)
        }
        const skill = matchingSkills[0] ?? null
        if (!skill) return {irrelevant: true, episode, result}
        const finalItem = result.finalAssistantItemId
            ? episode.items.find((item) => item.id === result.finalAssistantItemId)
            : null
        const endItemId = finalItem?.id ?? episode.source.endItemId
        const endTurnId = finalItem?.turnId ?? episode.source.endTurnId
        const source = {
            kind: "automatic_capture",
            runtimeId,
            threadId,
            startTurnId: episode.source.startTurnId,
            startItemId: episode.source.startItemId,
            endTurnId,
            endItemId,
            outcome: result.outcome,
            caseType: result.caseType,
            confidence: result.confidence,
            summary: segment.summary,
            reason: result.reason,
            inspectedAt: this.now().toISOString(),
        }
        const candidateSkill = {
            ...(skill.id ? {id: skill.id} : {}),
            name: skill.name,
        }
        const evidence = typeof this.saveEvidence === "function"
            ? await Promise.resolve(this.saveEvidence(episode))
            : null
        if (evidence) source.evidence = evidence
        const saved = this.rawCaseStore.addAutomaticCandidate({
            question: episode.originalQuestion,
            skill: candidateSkill,
            note: result.reason || segment.summary,
            source,
        })
        await this.createAutomaticCuration({
            saved,
            source,
            episode,
            skill: candidateSkill,
            datasets,
            profile,
        })
        return {irrelevant: false, episode, result, saved}
    }

    async createAutomaticCuration({saved, source, episode, skill}) {
        const currentProfile = this.profile()
        if (currentProfile.mode !== "automatic") return null
        if (!this.curationManager?.createSession) {
            throw new Error("Automatic curation is unavailable")
        }
        const currentDatasets = arrays(await Promise.resolve(this.listDatasets()))
        const dataset = automaticDatasetFor({
            confidence: source.confidence,
            outcome: source.outcome,
            skill,
        }, currentDatasets, arrays(currentProfile.targets).length
            ? currentProfile.targets
            : currentProfile.datasetId)
        if (!dataset?.activeRubricVersionId) {
            throw new Error(
                "Automatic curation requires one compatible Dataset with a published Rubric",
            )
        }
        if (!saved?.rawCase?.id) {
            throw new Error("Automatic curation requires a persisted Raw Case")
        }
        const curatorProfile = this.store.read().settings.curatorProfile ?? {}
        try {
            const session = await this.curationManager.createSession({
                datasetId: dataset.id,
                caseType: source.caseType,
                episode,
                source: episode.source,
                sourceThreadId: source.threadId,
                startItemId: source.startItemId,
                startTurnId: source.startTurnId,
                endItemId: source.endItemId,
                endTurnId: source.endTurnId,
                issueDescription: source.reason ?? "",
                modelId: curatorProfile.modelId ?? null,
                effort: curatorProfile.effort ?? null,
            })
            this.automaticSessions.set(session.id, {rawCaseId: saved.rawCase.id})
            if (session.status === "needs_review" && session.draft) {
                await this.handleCurationChanged(session)
            }
            return session
        } catch (error) {
            this.onError(error)
            this.emitStatus()
            throw error
        }
    }

    async scanThread({runtime, runtimeId, threadId, skills, datasets, profile}) {
        const response = await runtime.readThread(threadId)
        const thread = response?.thread
        if (!thread) throw new Error(`Automatic capture could not read task ${threadId}`)
        const messages = this.userMessages(thread)
        if (!messages.length) return false
        const cursor = this.stateStore.thread(runtimeId, threadId)
        if (isAutomaticAnalysisTask(messages)) {
            this.analysisThreadIds.add(threadId)
            if (
                cursor.lastInspectedUserItemId !== messages.at(-1).id ||
                cursor.pendingStartUserItemId !== null
            ) {
                this.stateStore.commitThread(runtimeId, threadId, {
                    lastInspectedUserItemId: messages.at(-1).id,
                    pendingStartUserItemId: null,
                    checkedRanges: cursor.checkedRanges ?? [],
                }, this.now())
            }
            return false
        }
        const cursorIndex = cursor.lastInspectedUserItemId
            ? messages.findIndex((message) => message.id === cursor.lastInspectedUserItemId)
            : -1
        const hasNewMessages = cursorIndex < messages.length - 1
        if (cursor.lastInspectedUserItemId && !hasNewMessages && !cursor.pendingStartUserItemId) {
            return false
        }
        const pendingIndex = cursor.pendingStartUserItemId
            ? messages.findIndex((message) => message.id === cursor.pendingStartUserItemId)
            : -1
        const startIndex = pendingIndex >= 0 ? pendingIndex : cursorIndex + 1
        const incremental = messages.slice(Math.max(0, startIndex))
        if (!incremental.length) return false

        const checkedRanges = [...(cursor.checkedRanges ?? [])]
        for (const batch of partitionUserMessages(incremental, {
            maxMessages: 40,
            maxCharacters: 24_000,
        })) {
            const boundaryPrompt = buildBoundaryPrompt({threadId, userMessages: batch})
            const boundary = deferIncompleteSegments(closeAnsweredPendingTail(
                parseBoundaryResult(
                    await this.analyze("boundary", boundaryPrompt, profile),
                    {userMessageIds: batch.map((message) => message.id)},
                ),
                batch,
            ), batch)
            for (const segment of boundary.segments) {
                const classified = await this.classifySegment({
                    thread,
                    threadId,
                    runtimeId,
                    segment,
                    skills,
                    datasets,
                    profile,
                })
                if (classified.irrelevant) {
                    checkedRanges.push({
                        startUserItemId: segment.startUserItemId,
                        endUserItemId: segment.endUserItemId,
                        reason: classified.skipReason ?? "no_identifiable_skill",
                        checkedAt: this.now().toISOString(),
                    })
                }
            }
            this.stateStore.commitThread(runtimeId, threadId, {
                lastInspectedUserItemId: batch.at(-1).id,
                pendingStartUserItemId: boundary.pendingStartUserItemId,
                checkedRanges: checkedRanges.slice(-200),
            }, this.now())
        }
        return true
    }
}

module.exports = {
    AutomaticCaptureManager: ConversationDiscoveryManager,
    ConversationDiscoveryManager,
    automaticDatasetFor,
    sameAutomaticSkill,
}
