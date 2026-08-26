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
        this.getHiddenThreadIds = getHiddenThreadIds
        this.now = now
        this.setTimer = setTimer
        this.clearTimer = clearTimer
        this.onStatus = onStatus
        this.onError = onError
        this.analysisThreadIds = new Set()
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
        const hidden = this.allHiddenThreadIds()
        for (const summary of threads) {
            if (!summary?.id || hidden.has(summary.id)) continue
            await this.scanThread({
                runtime,
                runtimeId,
                threadId: summary.id,
                skills,
                datasets,
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
        return flattenThread(thread)
            .filter(({item}) => item?.type === "userMessage")
            .map(({turnId, item}) => ({
                id: String(item.id ?? ""),
                turnId: String(turnId ?? ""),
                text: messageText(item),
            }))
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

    episodeForSegment(thread, segment, runtimeId) {
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
        for (let index = endUserIndex + 1; index < nextUserIndex; index += 1) {
            if (flattened[index].item.type === "agentMessage") endIndex = index
        }
        if (endIndex < 0) {
            throw new Error("Automatic capture candidate has no final Assistant response")
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
        const episode = this.episodeForSegment(thread, segment, runtimeId)
        const prompt = buildOutcomePrompt({threadId, episode, skills, datasets})
        const result = parseOutcomeResult(await this.analyze("outcome", prompt, profile), {
            skillNames: skills.map((skill) => skill.name).filter(Boolean),
            assistantItemIds: episode.items
                .filter((item) => item.type === "agentMessage")
                .map((item) => item.id),
        })
        const skill = skills.find((entry) => entry.name === result.skillName) ?? null
        if (!skill) return {irrelevant: true, episode, result}
        const finalItem = result.finalAssistantItemId
            ? episode.items.find((item) => item.id === result.finalAssistantItemId)
            : null
        const endItemId = finalItem?.id ?? episode.source.endItemId
        const endTurnId = finalItem?.turnId ?? episode.source.endTurnId
        const saved = this.rawCaseStore.addAutomaticCandidate({
            question: episode.originalQuestion,
            skill: {
                ...(skill.id ? {id: skill.id} : {}),
                name: skill.name,
                ...(skill.path ? {path: skill.path} : {}),
            },
            note: result.reason || segment.summary,
            source: {
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
            },
        })
        return {irrelevant: false, episode, result, saved}
    }

    async scanThread({runtime, runtimeId, threadId, skills, datasets, profile}) {
        const response = await runtime.readThread(threadId)
        const thread = response?.thread
        if (!thread) throw new Error(`Automatic capture could not read task ${threadId}`)
        const messages = this.userMessages(thread)
        if (!messages.length) return false
        const cursor = this.stateStore.thread(runtimeId, threadId)
        const cursorIndex = cursor.lastInspectedUserItemId
            ? messages.findIndex((message) => message.id === cursor.lastInspectedUserItemId)
            : -1
        const hasNewMessages = cursorIndex < messages.length - 1
        if (cursor.lastInspectedUserItemId && !hasNewMessages) return false
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
            const boundary = parseBoundaryResult(
                await this.analyze("boundary", boundaryPrompt, profile),
                {userMessageIds: batch.map((message) => message.id)},
            )
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
                        reason: "no_identifiable_skill",
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
}
