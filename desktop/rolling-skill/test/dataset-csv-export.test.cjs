const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    buildDatasetCsv,
    datasetExportFilename,
} = require("../src/dataset-csv-export.cjs")

function parseCsvRows(csv) {
    const rows = []
    let row = []
    let field = ""
    let quoted = false
    for (let index = 0; index < csv.length; index += 1) {
        const character = csv[index]
        if (quoted) {
            if (character === '"' && csv[index + 1] === '"') {
                field += '"'
                index += 1
            } else if (character === '"') quoted = false
            else field += character
        } else if (character === '"') quoted = true
        else if (character === ",") {
            row.push(field)
            field = ""
        } else if (character === "\n") {
            row.push(field)
            rows.push(row)
            row = []
            field = ""
        } else if (character !== "\r") field += character
    }
    if (field || row.length) {
        row.push(field)
        rows.push(row)
    }
    return rows
}

describe("dataset CSV export", () => {
    it("exports one Case per row with required input and output JSON message arrays", () => {
        const csv = buildDatasetCsv([
            {
                question: "查一下 7 月成本，包含\"混元\"。",
                answer: "第一行\n第二行",
                source: {originalQuestion: "用户原始问题"},
            },
            {question: "第二问", answer: "第二答"},
        ])
        const rows = parseCsvRows(csv)

        assert.deepEqual(rows[0], ["input", "output"])
        assert.equal(rows.length, 3)
        assert.deepEqual(JSON.parse(rows[1][0]), [{role: "user", content: "用户原始问题"}])
        assert.deepEqual(JSON.parse(rows[1][1]), [{role: "assistant", content: "第一行\n第二行"}])
        assert.deepEqual(JSON.parse(rows[2][0]), [{role: "user", content: "第二问"}])
        assert.deepEqual(JSON.parse(rows[2][1]), [{role: "assistant", content: "第二答"}])
    })

    it("keeps the two required headers for an empty dataset", () => {
        assert.equal(buildDatasetCsv([]), "input,output\r\n")
    })

    it("creates a filesystem-safe CSV filename", () => {
        assert.equal(datasetExportFilename(" 成本/账单：7月 "), "成本-账单-7月.csv")
        assert.equal(datasetExportFilename(""), "rolling-skill-dataset.csv")
    })
})
