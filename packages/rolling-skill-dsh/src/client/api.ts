export const ROLLING_SKILL_API_PATH = "/rolling-skill/api"

interface SuccessEnvelope<T> {
    ok: true
    value: T
}

interface FailureEnvelope {
    ok: false
    error: {
        code: string
        message: string
    }
}

export class RollingSkillApiError extends Error {
    readonly code: string
    readonly status: number

    constructor(code: string, message: string, status: number) {
        super(message)
        this.name = "RollingSkillApiError"
        this.code = code
        this.status = status
    }
}

export async function requestRollingSkill<T>(
    method: string,
    input: Record<string, unknown> = {},
    signal?: AbortSignal,
): Promise<T> {
    const response = await fetch(ROLLING_SKILL_API_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: {accept: "application/json", "content-type": "application/json"},
        body: JSON.stringify({method, input}),
        signal,
    })
    let envelope: SuccessEnvelope<T> | FailureEnvelope
    try {
        envelope = await response.json() as SuccessEnvelope<T> | FailureEnvelope
    } catch {
        throw new RollingSkillApiError(
            "INVALID_RESPONSE",
            "Rolling Skill returned an invalid response",
            response.status,
        )
    }
    if (!response.ok || !envelope.ok) {
        const failure = envelope as FailureEnvelope
        throw new RollingSkillApiError(
            failure.error?.code ?? "REQUEST_FAILED",
            failure.error?.message ?? "Rolling Skill request failed",
            response.status,
        )
    }
    return envelope.value
}
