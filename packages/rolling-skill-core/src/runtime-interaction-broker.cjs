"use strict"

const {randomUUID} = require("node:crypto")

const PRIVATE_KEY = /(?:token|secret|path|sourceClient|signal|capability|environment|(?:^|_)body$)/iu
const MAX_TEXT = 32 * 1024
const MAX_ITEMS = 100

function requiredText(value, label, maximum = 300) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function exactKeys(value, allowed, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    const unsupported = Object.keys(value).find((key) => !allowed.has(key))
    if (unsupported) throw new Error(`${label} contains an unsupported field: ${unsupported}`)
    return value
}

function publicValue(value, depth = 0) {
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string") return value.length <= MAX_TEXT
        ? value
        : `${value.slice(0, MAX_TEXT - 1)}…`
    if (!value || typeof value !== "object" || depth >= 6) return null
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((entry) => publicValue(entry, depth + 1))
    const output = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, "value") || PRIVATE_KEY.test(key)) continue
        output[key] = publicValue(descriptor.value, depth + 1)
    }
    return output
}

function runtimeSummary(value) {
    if (!value || typeof value !== "object") return null
    return publicValue({
        runtimeId: value.runtimeId,
        providerId: value.providerId,
        displayName: value.displayName,
        version: value.version,
    })
}

function consentValue(value, depth = 0) {
    if (typeof value === "string") return value
        .replace(/\b(Bearer\s+)\S+/giu, "$1[redacted]")
        .replace(/((?:[\w-]*(?:token|secret|password|api[_-]?key|authorization|cookie)[\w-]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, "$1[redacted]")
        .slice(0, 4000)
    if (value === null || typeof value === "boolean" || typeof value === "number") return value
    if (!value || typeof value !== "object" || depth >= 4) return null
    if (Array.isArray(value)) return value.slice(0, 30).map((entry) => consentValue(entry, depth + 1))
    return Object.fromEntries(Object.entries(value).slice(0, 30)
        .filter(([key]) => !/token|secret|password|api.?key|authorization|cookie|environment/iu.test(key))
        .map(([key, entry]) => [key, consentValue(entry, depth + 1)]))
}

function permissionDetails(request) {
    const params = request.params ?? {}
    const tool = params.toolCall ?? {}
    return consentValue({
        tool: params.toolName ?? tool.name ?? null,
        reason: params.reason ?? tool.title ?? null,
        command: params.command ?? null,
        cwd: params.cwd ?? null,
        arguments: tool.rawInput ?? null,
        permissions: params.permissions ?? null,
        locations: tool.locations ?? null,
    })
}

function owner(request) {
    if (typeof request.operatorSessionId === "string" && request.operatorSessionId.trim()) {
        return {
            ownerKind: "operator",
            ownerId: requiredText(request.operatorSessionId, "Operator Session id", 300),
            jobId: typeof request.operatorJobId === "string" ? request.operatorJobId.slice(0, 300) : null,
        }
    }
    return {
        ownerKind: "installation",
        ownerId: requiredText(request.jobId, "Installation Job id", 300),
        jobId: requiredText(request.jobId, "Installation Job id", 300),
    }
}

class RuntimeInteractionBroker {
    constructor({timeoutMs = 15 * 60 * 1000, onChanged = () => {}} = {}) {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 24 * 60 * 60 * 1000) {
            throw new Error("Runtime interaction timeout is invalid")
        }
        if (typeof onChanged !== "function") throw new Error("Runtime interaction callback is invalid")
        this.timeoutMs = timeoutMs
        this.onChanged = onChanged
        this.pending = new Map()
        this.closed = false
    }

    requestPermission(request = {}) {
        return this.#request("permission", request, "decline")
    }

    requestQuestion(request = {}) {
        return this.#request("question", request, {answers: []})
    }

    #request(kind, request, fallback) {
        if (this.closed) return Promise.resolve(fallback)
        const selectedOwner = owner(request)
        const id = `interaction-${randomUUID()}`
        const createdAt = new Date().toISOString()
        const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString()
        const options = kind === "permission"
            ? publicValue(Array.isArray(request.options) ? request.options : [])
            : []
        const questions = kind === "question"
            ? publicValue(Array.isArray(request.questions) ? request.questions : [])
            : []
        const record = {
            id,
            kind,
            ...selectedOwner,
            requestId: typeof request.rpcId === "string" ? request.rpcId.slice(0, 500) : null,
            runtime: runtimeSummary(request.runtime),
            options,
            questions,
            ...(kind === "permission" ? {details: permissionDetails(request)} : {}),
            createdAt,
            expiresAt,
        }
        return new Promise((resolve) => {
            const signal = request.signal
            const finish = (value) => {
                const current = this.pending.get(id)
                if (!current) return
                this.pending.delete(id)
                clearTimeout(current.timer)
                signal?.removeEventListener?.("abort", current.abort)
                resolve(value)
                this.onChanged()
            }
            const abort = () => finish(fallback)
            const timer = setTimeout(abort, this.timeoutMs)
            timer.unref?.()
            this.pending.set(id, {record, resolve: finish, fallback, timer, abort, request})
            signal?.addEventListener?.("abort", abort, {once: true})
            if (signal?.aborted) abort()
            else this.onChanged()
        })
    }

    list(input = {}) {
        exactKeys(input, new Set(["ownerKind", "ownerId"]), "Runtime interaction list request")
        if (input.ownerKind !== undefined && !["installation", "operator"].includes(input.ownerKind)) {
            throw new Error("Runtime interaction owner kind is invalid")
        }
        if (input.ownerId !== undefined) requiredText(input.ownerId, "Runtime interaction owner id", 300)
        return [...this.pending.values()]
            .map(({record}) => structuredClone(record))
            .filter((record) => input.ownerKind === undefined || record.ownerKind === input.ownerKind)
            .filter((record) => input.ownerId === undefined || record.ownerId === input.ownerId)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    }

    resolve(input = {}) {
        exactKeys(input, new Set(["interactionId", "decision", "answers"]), "Runtime interaction resolution")
        const interactionId = requiredText(input.interactionId, "Runtime interaction id", 300)
        const pending = this.pending.get(interactionId)
        if (!pending) throw new Error("Runtime interaction is no longer pending")
        if (pending.record.kind === "permission") {
            if (input.answers !== undefined) throw new Error("Permission resolution cannot include answers")
            const decision = requiredText(input.decision, "Runtime permission decision", 300)
            const allowed = new Set(["decline"])
            for (const option of pending.record.options) {
                const optionId = option?.optionId ?? option?.id ?? option?.value
                if (typeof optionId === "string" && optionId) allowed.add(optionId)
            }
            if (!allowed.has(decision)) throw new Error("Runtime permission decision is not offered")
            pending.resolve(decision)
            return {interactionId, status: "resolved", decision}
        }
        if (input.decision !== undefined) throw new Error("Question resolution cannot include a permission decision")
        if (!Array.isArray(input.answers) || input.answers.length > MAX_ITEMS) {
            throw new Error("Runtime question answers are invalid")
        }
        const questionIds = new Set(pending.record.questions.map((question) => (
            question?.id ?? question?.questionId
        )).filter((value) => typeof value === "string" && value))
        const seen = new Set()
        const answers = input.answers.map((entry) => {
            exactKeys(entry, new Set(["questionId", "answer"]), "Runtime question answer")
            const questionId = requiredText(entry.questionId, "Runtime question id", 300)
            if (!questionIds.has(questionId)) throw new Error("Runtime answer references an unknown question")
            if (seen.has(questionId)) throw new Error("Runtime question has duplicate answers")
            seen.add(questionId)
            const answer = typeof entry.answer === "string" ? entry.answer : ""
            if (answer.length > MAX_TEXT) throw new Error("Runtime question answer is too large")
            return {questionId, answer}
        })
        pending.resolve({answers})
        return {interactionId, status: "resolved", answerCount: answers.length}
    }

    close() {
        if (this.closed) return
        this.closed = true
        for (const pending of [...this.pending.values()]) pending.resolve(pending.fallback)
    }
}

module.exports = {RuntimeInteractionBroker}
