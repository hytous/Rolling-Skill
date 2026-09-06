function approvalHasExpired(approval, now = Date.now()) {
    // Final review concerns an immutable candidate, not a short-lived tool request.
    if (approval.action === "optimization.release-install" &&
        approval.proposedMutation?.method === "optimization.approval") return false
    return Date.parse(approval.expiresAt) <= now
}

module.exports = {approvalHasExpired}
