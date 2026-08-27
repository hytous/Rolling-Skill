import {randomUUID} from "node:crypto"

import {createUserMessage} from "@deepseek-ai/dsh-llm"

export function createNativeSessionDispatcher({agents, createMessage = createUserMessage, createId = randomUUID} = {}) {
    if (!agents || typeof agents.create !== "function") throw new Error("DSH Agent registry is required")
    if (typeof createMessage !== "function" || typeof createId !== "function") {
        throw new Error("DSH Session dispatch helpers are invalid")
    }
    return async ({question, target, sessionId: currentSessionId}) => {
        if (target !== "new" && target !== "current") throw new Error("DSH Session dispatch target is invalid")
        if (typeof question !== "string" || !question.length || question.length > 120_000) {
            throw new Error("Raw Case question is invalid")
        }
        const sessionId = target === "current" ? currentSessionId : createId()
        if (typeof sessionId !== "string" || !sessionId) throw new Error("Current DSH Session is required")
        const handle = target === "current" ? null : await agents.create({sessionId})
        const agent = handle?.agent ?? agents.get?.(sessionId)
        if (!agent || typeof agent.followup !== "function") {
            await handle?.dispose?.()
            throw new Error("The current DSH Session is not active")
        }
        try {
            agent.followup(createMessage({
                content: [{type: "text", text: question}],
                source: {kind: "user"},
            }))
        } catch (error) {
            await handle?.dispose?.()
            throw error
        }
        return {sessionId, status: "queued"}
    }
}
