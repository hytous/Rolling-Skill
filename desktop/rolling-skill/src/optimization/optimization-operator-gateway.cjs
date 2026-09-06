"use strict"

function requiredText(value, label, maximum = 8_192) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) throw new Error(`${label} is required`)
    if (normalized.length > maximum) throw new Error(`${label} is too long`)
    return normalized
}

function requestIdentity(request, kind) {
    const runId = requiredText(request?.run?.runId ?? request?.run?.id, "Optimization Run id", 200)
    const operatorSessionId = requiredText(
        request?.operatorSessionId,
        "Optimization current Operator session",
        300,
    )
    const epoch = request?.epoch
    if (!Number.isSafeInteger(epoch) || epoch < 1) {
        throw new Error("Optimization pending Epoch is invalid")
    }
    return {runId, kind, epoch, operatorSessionId}
}

class OptimizationOperatorGateway {
    constructor(options = {}) {
        if (options.onRequest !== undefined && typeof options.onRequest !== "function") {
            throw new Error("Optimization Operator notification callback is invalid")
        }
        this.requests = new Map()
        this.onRequest = options.onRequest ?? null
    }

    #request(request, kind) {
        const identity = requestIdentity(request, kind)
        if (this.requests.has(identity.runId)) {
            throw new Error("Optimization Run already has a pending Operator request")
        }
        const pending = new Promise((resolve, reject) => {
            this.requests.set(identity.runId, {...identity, resolve, reject})
        })
        if (this.onRequest !== null) {
            Promise.resolve().then(() => this.onRequest({...identity})).catch((error) => {
                const current = this.requests.get(identity.runId)
                if (current?.kind !== identity.kind || current?.epoch !== identity.epoch) return
                this.requests.delete(identity.runId)
                current.reject(error)
            })
        }
        return pending
    }

    requestCandidate(request) {
        return this.#request(request, "candidate")
    }

    requestDecision(request) {
        return this.#request(request, "decision")
    }

    pending(runId) {
        const current = this.requests.get(String(runId))
        if (!current) return null
        return {
            runId: current.runId,
            kind: current.kind,
            epoch: current.epoch,
            operatorSessionId: current.operatorSessionId,
        }
    }

    #submit(input, kind, value) {
        const runId = requiredText(input?.runId, "Optimization Run id", 200)
        const operatorSessionId = requiredText(
            input?.operatorSessionId,
            "Optimization current Operator session",
            300,
        )
        const current = this.requests.get(runId)
        if (!current) throw new Error("Optimization Run has no current pending Operator request")
        if (current.kind !== kind) {
            throw new Error(`Optimization Run is waiting for a ${current.kind} decision phase submission`)
        }
        if (current.operatorSessionId !== operatorSessionId) {
            throw new Error("Optimization submission does not belong to the current Operator session")
        }
        this.requests.delete(runId)
        current.resolve(value)
        return {runId, kind}
    }

    submitCandidate(input) {
        const message = requiredText(input?.message, "Optimization Candidate message", 2_000)
        const title = input?.title ? requiredText(input.title, "Candidate title", 80) : null
        return this.#submit(input, "candidate", {message, ...(title ? {title} : {})})
    }

    submitDecision(input) {
        return this.#submit(input, "decision", {
            decision: structuredClone(input?.decision),
        })
    }

    cancelRun(runId, reason = "Optimization Operator request cancelled") {
        const current = this.requests.get(String(runId))
        if (!current) return false
        this.requests.delete(current.runId)
        current.reject(new Error(requiredText(reason, "Optimization cancellation reason", 1_000)))
        return true
    }

    cancelAll(reason = "Optimization Operator gateway stopped") {
        for (const runId of [...this.requests.keys()]) this.cancelRun(runId, reason)
    }
}

module.exports = {OptimizationOperatorGateway}
