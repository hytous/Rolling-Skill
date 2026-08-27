const counts = new Map<string, number>()
const order: string[] = []
const listeners = new Set<() => void>()
let lastObservedSessionId: string | null = null

function notify() {
    for (const listener of listeners) listener()
}

export function registerActiveConversationSession(sessionId: string): () => void {
    if (!sessionId) return () => {}
    lastObservedSessionId = sessionId
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1)
    const previous = order.indexOf(sessionId)
    if (previous >= 0) order.splice(previous, 1)
    order.push(sessionId)
    notify()
    return () => {
        const remaining = (counts.get(sessionId) ?? 1) - 1
        if (remaining > 0) counts.set(sessionId, remaining)
        else {
            counts.delete(sessionId)
            const index = order.indexOf(sessionId)
            if (index >= 0) order.splice(index, 1)
        }
        notify()
    }
}

export function activeConversationSessionSnapshot(): string | null {
    return order.at(-1) ?? lastObservedSessionId
}

export function subscribeActiveConversationSession(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
