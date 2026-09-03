import {randomUUID} from "node:crypto"

export function createNativeSessionDispatcher({apiProxy, createId = randomUUID} = {}) {
    const sessions = apiProxy?.sessions
    if (typeof sessions?.create !== "function" || typeof sessions?.prompt !== "function") throw new Error("DSH native Session API is required")
    const invoke = async (method, payload) => {
        const response = await sessions[method]({rpcId: createId(), payload})
        if (response?.result?.ok !== true) throw new Error(response?.result?.error?.message ?? "DSH Session request failed")
        return response.result.value
    }
    return async ({question, target, sessionId: currentSessionId}) => {
        if (target !== "new" && target !== "current") throw new Error("DSH Session dispatch target is invalid")
        if (typeof question !== "string" || !question.length || question.length > 120_000) {
            throw new Error("Raw Case question is invalid")
        }
        const sessionId = target === "current" ? currentSessionId : createId()
        if (typeof sessionId !== "string" || !sessionId) throw new Error("Current DSH Session is required")
        // This is the same entry as the DSH New Session UI. A bare agents.create
        // skips preset/tool composition and can produce an invisible, unusable Agent.
        if (target === "new") await invoke("create", {sessionId})
        await invoke("prompt", {sessionId, mode: "queue", content: [{type: "text", text: question}]})
        return {sessionId, status: "queued"}
    }
}
