export interface NativeSessions {
    open(id: string): void
    list: {getSnapshot(): {ids: string[]}; subscribe(listener: () => void): () => void}
}

let sessions: NativeSessions | null = null

export function registerNativeSessionNavigation(value: NativeSessions): () => void {
    sessions = value
    return () => {if (sessions === value) sessions = null}
}

export async function openNativeSession(sessionId: string): Promise<void> {
    const runtime = sessions
    if (!runtime) throw new Error("DSH session navigation is unavailable")
    if (!runtime.list.getSnapshot().ids.includes(sessionId)) {
        await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {unsubscribe(); reject(new Error("DSH has not listed the new session yet; try opening it again."))}, 10_000)
            const inspect = () => {
                if (!runtime.list.getSnapshot().ids.includes(sessionId)) return
                window.clearTimeout(timer)
                unsubscribe()
                resolve()
            }
            const unsubscribe = runtime.list.subscribe(inspect)
            inspect()
        })
    }
    runtime.open(sessionId)
}
