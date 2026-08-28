function safeMarkdownLink(value) {
    const link = typeof value === "string" ? value.trim() : ""
    return /^(?:https?:|mailto:)/iu.test(link) || link.startsWith("#")
        ? link
        : null
}

module.exports = {safeMarkdownLink}
