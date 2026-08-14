class EvaluationPowerGuard {
    constructor(powerSaveBlocker) {
        this.powerSaveBlocker = powerSaveBlocker
        this.activeLeaseCount = 0
        this.blockerId = null
    }

    acquire() {
        if (this.activeLeaseCount === 0) {
            try {
                this.blockerId = this.powerSaveBlocker?.start?.("prevent-app-suspension") ?? null
            } catch {
                this.blockerId = null
            }
        }
        if (this.blockerId === null) return () => {}

        this.activeLeaseCount += 1
        let released = false
        return () => {
            if (released) return
            released = true
            this.activeLeaseCount = Math.max(0, this.activeLeaseCount - 1)
            if (this.activeLeaseCount !== 0 || this.blockerId === null) return
            const blockerId = this.blockerId
            this.blockerId = null
            try {
                if (this.powerSaveBlocker?.isStarted?.(blockerId) !== false) {
                    this.powerSaveBlocker?.stop?.(blockerId)
                }
            } catch {
                // A stopped Electron process makes the lease moot.
            }
        }
    }
}

module.exports = {EvaluationPowerGuard}
