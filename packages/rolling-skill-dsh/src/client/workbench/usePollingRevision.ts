import {useEffect, useState} from "react"

import pollingScheduler from "./polling-scheduler.cjs"

const {createPollingScheduler} = pollingScheduler as {
    createPollingScheduler(options: {
        intervalMs: number
        schedule(callback: () => void, delay: number): number
        cancel(timer: number): void
    }): {
        start(poll: () => boolean | Promise<boolean>): () => void
        stop(): void
    }
}

export function usePollingRevision(active: boolean, intervalMs = 1_500) {
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        if (!active) return
        const scheduler = createPollingScheduler({
            intervalMs,
            schedule: (callback, delay) => window.setTimeout(callback, delay),
            cancel: (timer) => window.clearTimeout(timer),
        })
        scheduler.start(() => {
            setRevision((value) => value + 1)
            return true
        })
        return () => scheduler.stop()
    }, [active, intervalMs])

    return [revision, () => setRevision((value) => value + 1)] as const
}
