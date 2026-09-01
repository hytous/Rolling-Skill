import connectionStore from "./connection-store.cjs"

export const ROLLING_SKILL_API_PATH = "/rolling-skill/api"

const {rollingSkillConnection} = connectionStore as {
    rollingSkillConnection: {
        getSnapshot(): {status: "connected" | "disconnected"; error: string | null; revision: number}
        subscribe(listener: () => void): () => void
        markConnected(): void
        markDisconnected(error?: string | null): void
    }
}

export const getRollingSkillConnectionSnapshot = () => rollingSkillConnection.getSnapshot()
export const subscribeRollingSkillConnection = (listener: () => void) =>
    rollingSkillConnection.subscribe(listener)

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
    let response: Response
    try {
        response = await fetch(ROLLING_SKILL_API_PATH, {
            method: "POST",
            credentials: "same-origin",
            headers: {accept: "application/json", "content-type": "application/json"},
            body: JSON.stringify({method, input}),
            signal,
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error
        rollingSkillConnection.markDisconnected(error instanceof Error ? error.message : null)
        throw new RollingSkillApiError(
            "CONNECTION_UNAVAILABLE",
            "DSH service connection is unavailable",
            0,
        )
    }
    rollingSkillConnection.markConnected()
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
