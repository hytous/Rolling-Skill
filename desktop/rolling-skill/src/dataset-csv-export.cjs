function csvCell(value) {
    const text = String(value ?? "")
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function messageArray(role, content) {
    return JSON.stringify([{role, content: String(content ?? "")}])
}

function normalizeExportOptions(options = {}) {
    const caseScope = options.caseScope ?? "all"
    const outputMode = options.outputMode ?? "curated"
    if (caseScope !== "all" && caseScope !== "goodcase") {
        throw new Error("Dataset export case scope is unsupported")
    }
    if (outputMode !== "curated" && outputMode !== "original") {
        throw new Error("Dataset export output mode is unsupported")
    }
    return {caseScope, outputMode}
}

function originalFinalAssistantMessages(entry) {
    if (!Array.isArray(entry?.source?.originalAssistantMessages)) return []
    for (let index = entry.source.originalAssistantMessages.length - 1; index >= 0; index -= 1) {
        const message = entry.source.originalAssistantMessages[index]
        if (message?.role === "assistant" && typeof message.content === "string") {
            return [{role: "assistant", content: message.content}]
        }
    }
    return []
}

function buildDatasetCsv(cases = [], options = {}) {
    if (!Array.isArray(cases)) throw new Error("Dataset Cases must be an array")
    const {caseScope, outputMode} = normalizeExportOptions(options)
    const rows = [["input", "output"]]
    const selectedCases = caseScope === "goodcase"
        ? cases.filter((entry) => entry?.caseType === "goodcase")
        : cases
    for (const entry of selectedCases) {
        const question = entry?.source?.originalQuestion || entry?.question || ""
        const answer = entry?.answer || entry?.curated?.referenceAnswer?.summary || ""
        rows.push([
            messageArray("user", question),
            outputMode === "original"
                ? JSON.stringify(originalFinalAssistantMessages(entry))
                : messageArray("assistant", answer),
        ])
    }
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}

function datasetExportFilename(name, options = {}) {
    const {caseScope, outputMode} = normalizeExportOptions(options)
    const safe = String(name ?? "")
        .trim()
        .replace(/[\\/:：*?"<>|]+/gu, "-")
        .replace(/\s+/gu, "-")
        .replace(/-+/gu, "-")
        .replace(/^-|-$/gu, "")
    const suffix = [
        caseScope === "goodcase" ? "goodcases" : null,
        outputMode === "original" ? "original" : null,
    ].filter(Boolean)
    return `${safe || "rolling-skill-dataset"}${suffix.length ? `-${suffix.join("-")}` : ""}.csv`
}

module.exports = {buildDatasetCsv, datasetExportFilename, originalFinalAssistantMessages}
