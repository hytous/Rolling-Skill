const {join} = require("node:path")
const {acquireRunLease} = require("./run-lease.cjs")

function acquireDataOwner(lockDirectory) {
    return acquireRunLease(join(lockDirectory, "data-owner"), {
        slot: new Date().toISOString(),
        // Never evict a live data writer merely because a model runs slowly.
        staleAfterMs: Number.MAX_SAFE_INTEGER,
    })
}

function createOwnedApplication({lockDirectory, createApplication}) {
    let pending = null
    let application = null
    let lease = null
    let closed = false
    async function start() {
        if (closed) throw new Error("Rolling Skill application is closed")
        if (application) return application
        if (!pending) {
            pending = (async () => {
                try {
                    lease = await acquireDataOwner(lockDirectory)
                } catch (error) {
                    if (error?.code === "LEASE_BUSY") {
                        throw Object.assign(new Error("Rolling Skill data is owned by another active Host or Worker"), {code: "DATA_BUSY"})
                    }
                    throw error
                }
                try {
                    application = await createApplication()
                    return application
                } catch (error) {
                    await lease.release()
                    lease = null
                    throw error
                }
            })().finally(() => {pending = null})
        }
        return pending
    }
    return {
        start,
        async dispatch(method, input) {return (await start()).dispatch(method, input)},
        async close() {
            closed = true
            await pending?.catch(() => {})
            // Retain ownership until all runtime notifications and saves stop.
            try {await application?.close()} finally {await lease?.release()}
        },
    }
}

module.exports = {acquireDataOwner, createOwnedApplication}
