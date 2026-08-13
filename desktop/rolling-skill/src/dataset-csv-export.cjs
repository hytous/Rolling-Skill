function csvCell(value) {
    const text = String(value ?? "")
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function messageArray(role, content) {
    return JSON.stringify([{role, content: String(content ?? "")}])
}

function buildDatasetCsv(cases = []) {
    if (!Array.isArray(cases)) throw new Error("Dataset Cases must be an array")
    const rows = [["input", "output"]]
    for (const entry of cases) {
        const question = entry?.source?.originalQuestion || entry?.question || ""
        const answer = entry?.answer || entry?.curated?.referenceAnswer?.summary || ""
        rows.push([
            messageArray("user", question),
            messageArray("assistant", answer),
        ])
    }
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}

function datasetExportFilename(name) {
    const safe = String(name ?? "")
        .trim()
        .replace(/[\\/:：*?"<>|]+/gu, "-")
        .replace(/\s+/gu, "-")
        .replace(/-+/gu, "-")
        .replace(/^-|-$/gu, "")
    return `${safe || "rolling-skill-dataset"}.csv`
}

module.exports = {buildDatasetCsv, datasetExportFilename}
