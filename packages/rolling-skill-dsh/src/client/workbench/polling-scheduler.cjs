function createPollingScheduler({
    intervalMs = 1_500,
    schedule = setTimeout,
    cancel = clearTimeout,
} = {}) {
    let generation = 0
    let timer = null
    let settle = null
    let reject = null
    let idlePromise = Promise.resolve()

    const finish = (error = null) => {
        if (timer !== null) cancel(timer)
        timer = null
        const resolveIdle = settle
        const rejectIdle = reject
        settle = null
        reject = null
        if (error) rejectIdle?.(error)
        else resolveIdle?.()
    }

    const stop = () => {
        generation += 1
        finish()
    }

    const start = (poll) => {
        if (typeof poll !== "function") throw new TypeError("Polling callback must be a function")
        stop()
        const currentGeneration = generation
        idlePromise = new Promise((resolve, rejectPromise) => {
            settle = resolve
            reject = rejectPromise
        })
        const tick = async () => {
            timer = null
            if (currentGeneration !== generation) return
            try {
                const active = await poll()
                if (currentGeneration !== generation) return
                if (!active) {
                    finish()
                    return
                }
                timer = schedule(tick, intervalMs)
            } catch (error) {
                finish(error)
            }
        }
        timer = schedule(tick, intervalMs)
        return stop
    }

    return {
        start,
        stop,
        idle: () => idlePromise,
    }
}

module.exports = {createPollingScheduler}
