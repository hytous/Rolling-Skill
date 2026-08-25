const OPERATOR_SAFE_ARRAY_LIMIT = 10_000
const OPERATOR_SAFE_TEXT_LIMIT = 32 * 1_024
const OPERATOR_PRIVATE_KEYS = /(?:token|socket|path|capabilityId|executablePath|inline|body)/iu

function safeValue(value, depth = 0) {
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string") {
        return value.length <= OPERATOR_SAFE_TEXT_LIMIT
            ? value
            : `${value.slice(0, OPERATOR_SAFE_TEXT_LIMIT - 1)}…`
    }
    if (depth >= 8 || !value || typeof value !== "object") return null
    if (Array.isArray(value)) {
        return value.slice(0, OPERATOR_SAFE_ARRAY_LIMIT)
            .map((entry) => safeValue(entry, depth + 1))
    }
    const output = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, "value") || OPERATOR_PRIVATE_KEYS.test(key)) continue
        output[key] = safeValue(descriptor.value, depth + 1)
    }
    return output
}

function publicSessionSummary(session = {}) {
    const runtime = session.runtime ?? {}
    return safeValue({
        id: session.id,
        runtime: {
            runtimeId: runtime.runtimeId,
            providerId: runtime.providerId,
            displayName: runtime.displayName,
            version: runtime.version ?? null,
        },
        modelId: session.modelId ?? null,
        effort: session.effort ?? null,
        protocol: session.protocol,
        transcriptSequence: Number.isSafeInteger(session.transcriptSequence)
            ? session.transcriptSequence
            : 0,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        closedAt: session.closedAt ?? null,
    })
}

function publicJobSummary(job = {}) {
    const childJobIds = Array.isArray(job.childJobIds)
        ? job.childJobIds
        : Array.isArray(job.children) ? job.children : []
    return safeValue({
        id: job.id,
        sessionId: job.sessionId,
        parentJobId: job.parentJobId ?? null,
        type: job.type,
        objective: job.objective,
        budget: job.budget,
        status: job.status,
        childJobIds,
        artifactIds: Array.isArray(job.artifactIds) ? job.artifactIds : [],
        approvalIds: Array.isArray(job.approvalIds) ? job.approvalIds : [],
        error: job.error ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null,
    })
}

function publicStepSummary(step = {}) {
    return safeValue({
        id: step.id,
        jobId: step.jobId,
        sessionId: step.sessionId,
        method: step.method,
        status: step.status,
        outputArtifactIds: Array.isArray(step.outputArtifactIds) ? step.outputArtifactIds : [],
        attempt: step.attempt,
        error: step.error ?? null,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        startedAt: step.startedAt ?? null,
        completedAt: step.completedAt ?? null,
    })
}

function publicApprovalSummary(approval = {}) {
    return safeValue({
        id: approval.id,
        jobId: approval.jobId,
        sessionId: approval.sessionId,
        stepId: approval.stepId ?? null,
        action: approval.action,
        scope: approval.scope,
        risk: approval.risk,
        expiresAt: approval.expiresAt,
        status: approval.status,
        decision: approval.decision ?? null,
        decisionScope: approval.decisionScope ?? null,
        decidedBy: approval.decidedBy ?? null,
        createdAt: approval.createdAt,
        resolvedAt: approval.resolvedAt ?? null,
    })
}

function publicOperatorSummaryPage(page = {}) {
    return {
        generation: typeof page.generation === "string" ? page.generation : null,
        revision: Number.isSafeInteger(page.revision) ? page.revision : 0,
        sessions: (Array.isArray(page.sessions) ? page.sessions : []).map(publicSessionSummary),
        jobs: (Array.isArray(page.jobs) ? page.jobs : []).map(publicJobSummary),
        steps: (Array.isArray(page.steps) ? page.steps : []).map(publicStepSummary),
        approvals: (Array.isArray(page.approvals) ? page.approvals : []).map(publicApprovalSummary),
        totals: safeValue(page.totals ?? {sessions: 0, jobs: 0, steps: 0, approvals: 0}),
        truncated: page.truncated === true,
        nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
    }
}

module.exports = {
    publicApprovalSummary,
    publicJobSummary,
    publicOperatorSummaryPage,
    publicSessionSummary,
    publicStepSummary,
}
