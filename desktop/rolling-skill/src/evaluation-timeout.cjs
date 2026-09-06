function evaluationTimeoutMs(input = {}) {
    const timeoutMs = input?.timeoutMs
    if (timeoutMs === undefined || timeoutMs === null) return null
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError("Evaluation timeout must be a positive finite number")
    }
    return timeoutMs
}

function startEvaluationTimeout(input, onTimeout) {
    const timeoutMs = evaluationTimeoutMs(input)
    return timeoutMs === null ? null : setTimeout(onTimeout, timeoutMs)
}

function clearEvaluationTimeout(timeout) {
    if (timeout !== null) clearTimeout(timeout)
}

module.exports = {
    clearEvaluationTimeout,
    evaluationTimeoutMs,
    startEvaluationTimeout,
}
