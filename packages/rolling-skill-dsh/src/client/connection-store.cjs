function createConnectionStore() {
    let snapshot = Object.freeze({status: "connected", error: null, revision: 0})
    const listeners = new Set()

    const publish = (status, error = null) => {
        if (snapshot.status === status && snapshot.error === error) return snapshot
        snapshot = Object.freeze({
            status,
            error,
            revision: snapshot.revision + 1,
        })
        for (const listener of listeners) listener()
        return snapshot
    }

    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        markConnected: () => publish("connected"),
        markDisconnected: (error = null) => publish("disconnected", error),
    }
}

const rollingSkillConnection = createConnectionStore()

module.exports = {createConnectionStore, rollingSkillConnection}
