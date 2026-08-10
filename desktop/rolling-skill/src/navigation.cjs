function classifyNavigation(target, localOrigin) {
    try {
        const url = new URL(target)
        const configuredOrigin = new URL(localOrigin).origin
        if (url.origin === configuredOrigin && (url.protocol === "http:" || url.protocol === "https:")) {
            return "internal"
        }
        if (url.protocol === "https:") return "external"
        return "blocked"
    } catch {
        return "blocked"
    }
}

module.exports = {classifyNavigation}
