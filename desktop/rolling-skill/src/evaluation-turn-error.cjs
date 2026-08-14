function evaluationTraceDiagnostics({recorder, traceMark, threadId, turnId, startedAt, lastActivityAt}) {
    let traceReference = null
    let traceEvidence = null
    try {
        traceReference = traceMark
            ? recorder?.referenceFrom?.(traceMark) ?? null
            : recorder?.latestReference ?? null
        traceEvidence = traceReference
            ? recorder?.evidenceForReference?.(traceReference) ?? null
            : null
    } catch {
        // A diagnostic snapshot must never replace the original runtime failure.
    }
    return {
        threadId: threadId ?? null,
        turnId: turnId ?? null,
        durationMs: Math.max(0, Date.now() - startedAt),
        lastActivityAt: lastActivityAt ?? null,
        traceReference,
        traceEvidence,
    }
}

function evaluationTurnError(message, options = {}) {
    const error = new Error(message)
    Object.assign(error, {
        code: options.code ?? "EVALUATION_TURN_FAILED",
        ...evaluationTraceDiagnostics(options),
    })
    return error
}

module.exports = {evaluationTraceDiagnostics, evaluationTurnError}
