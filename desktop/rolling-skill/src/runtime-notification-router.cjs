const SUMMARY_METHODS = new Set([
    "thread/started",
    "thread/archived",
    "thread/unarchived",
    "thread/name/updated",
    "thread/status/changed",
])

const TIMELINE_METHODS = new Set([
    "thread/settings/updated",
    "turn/started",
    "item/started",
    "item/agentMessage/delta",
    "item/completed",
    "turn/completed",
    "error",
])

function notificationThreadId(message) {
    return message?.params?.threadId ?? message?.params?.thread?.id ?? null
}

class RuntimeNotificationRouter {
    constructor({maxBufferedNotifications = 2_000} = {}) {
        this.maxBufferedNotifications = maxBufferedNotifications
        this.nextEpoch = 1
        this.observation = null
    }

    beginObservation(threadId) {
        const epoch = this.nextEpoch
        this.nextEpoch += 1
        this.observation = {
            epoch,
            threadId,
            phase: "snapshot",
            notifications: [],
            overflow: false,
        }
        return epoch
    }

    snapshotReady(epoch) {
        if (this.observation?.epoch !== epoch) return false
        this.observation.phase = "catch-up"
        this.observation.notifications = []
        this.observation.overflow = false
        return true
    }

    clear(epoch = null) {
        if (epoch !== null && this.observation?.epoch !== epoch) return false
        this.observation = null
        return true
    }

    route(message) {
        const method = message?.method
        const threadId = notificationThreadId(message)
        if (SUMMARY_METHODS.has(method)) return {forward: true, kind: "summary"}
        if (!TIMELINE_METHODS.has(method)) return {forward: false, kind: "unused"}

        const observed = this.observation
        if (!observed || threadId !== observed.threadId) {
            return {forward: false, kind: "background"}
        }
        if (observed.phase === "live") return {forward: true, kind: "timeline"}
        if (observed.phase === "catch-up") {
            if (observed.notifications.length >= this.maxBufferedNotifications) {
                observed.overflow = true
            } else {
                observed.notifications.push(message)
            }
        }
        return {forward: false, kind: "buffered"}
    }

    drain(epoch) {
        const observed = this.observation
        if (!observed || observed.epoch !== epoch) {
            return {matched: false, live: false, notifications: []}
        }
        if (observed.overflow) {
            this.observation = null
            return {
                matched: true,
                live: false,
                reloadRequired: true,
                notifications: [],
            }
        }
        if (observed.notifications.length) {
            return {
                matched: true,
                live: false,
                notifications: observed.notifications.splice(0),
            }
        }
        observed.phase = "live"
        return {matched: true, live: true, notifications: []}
    }
}

module.exports = {
    RuntimeNotificationRouter,
    notificationThreadId,
}
