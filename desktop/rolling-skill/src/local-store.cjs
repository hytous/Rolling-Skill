const {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} = require("node:fs")
const {dirname} = require("node:path")
const {randomUUID} = require("node:crypto")

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function initialState() {
    const now = new Date().toISOString()
    return {
        schemaVersion: "rolling-skill-local/v1",
        settings: {autoCapture: false},
        datasets: [
            {
                id: randomUUID(),
                name: "Skill evaluation cases",
                createdAt: now,
            },
        ],
        cases: [],
    }
}

class LocalEvaluationStore {
    constructor(path) {
        this.path = path
        this.state = null
    }

    load() {
        if (this.state) return this.state
        if (existsSync(this.path)) {
            this.state = JSON.parse(readFileSync(this.path, "utf8"))
        } else {
            this.state = initialState()
            this.persist()
        }
        return this.state
    }

    persist() {
        const directory = dirname(this.path)
        mkdirSync(directory, {recursive: true, mode: 0o700})
        const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
        writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {mode: 0o600})
        chmodSync(temporary, 0o600)
        renameSync(temporary, this.path)
    }

    read() {
        return copy(this.load())
    }

    listDatasets() {
        const state = this.load()
        return state.datasets.map((dataset) => {
            const cases = state.cases.filter((entry) => entry.datasetId === dataset.id)
            return {
                ...copy(dataset),
                caseCount: cases.length,
                goodcaseCount: cases.filter((entry) => entry.caseType === "goodcase").length,
                badcaseCount: cases.filter((entry) => entry.caseType === "badcase").length,
            }
        })
    }

    createDataset(name) {
        const trimmed = String(name ?? "").trim()
        if (!trimmed) throw new Error("Dataset name is required")
        const state = this.load()
        const dataset = {id: randomUUID(), name: trimmed, createdAt: new Date().toISOString()}
        state.datasets.push(dataset)
        this.persist()
        return copy(dataset)
    }

    saveCase(input) {
        const state = this.load()
        const question = String(input.question ?? "").trim()
        const answer = String(input.answer ?? "").trim()
        if (input.caseType !== "goodcase" && input.caseType !== "badcase") {
            throw new Error("Case type must be goodcase or badcase")
        }
        if (!state.datasets.some((dataset) => dataset.id === input.datasetId)) {
            throw new Error("Unknown dataset")
        }
        if (!question) throw new Error("Case question is required")
        if (!answer) throw new Error("Case answer is required")
        const entry = {
            id: randomUUID(),
            datasetId: input.datasetId,
            caseType: input.caseType,
            question,
            answer,
            source: {
                threadId: input.threadId ?? null,
                turnId: input.turnId ?? null,
                itemId: input.itemId ?? null,
                runtimeId: input.runtimeId ?? null,
                traceReference: input.traceReference ?? null,
            },
            createdAt: new Date().toISOString(),
        }
        state.cases.push(entry)
        this.persist()
        return copy(entry)
    }
}

module.exports = {LocalEvaluationStore, initialState}
