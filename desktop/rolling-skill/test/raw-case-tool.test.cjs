const assert = require("node:assert/strict")
const {execFileSync} = require("node:child_process")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {RawCaseStore} = require("../src/raw-case-store.cjs")

const toolPath = join(__dirname, "..", "tools", "rolling-skill-tool.mjs")
const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixtureEnvironment() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-raw-case-tool-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "raw-case-events.jsonl")
    return {
        path,
        environment: {...process.env, ROLLING_SKILL_RAW_CASE_PATH: path},
    }
}

function runTool(arguments_, {environment, input} = {}) {
    return execFileSync(process.execPath, [toolPath, ...arguments_], {
        env: environment,
        encoding: "utf8",
        input,
    })
}

describe("rolling-skill external Raw Case tool", () => {
    it("enqueues one verbatim question and lists it as JSON", () => {
        const {path, environment} = fixtureEnvironment()
        const question = "  查一下 7 月账单，混元 3 花了多少？  "

        const enqueueResult = JSON.parse(runTool([
            "enqueue",
            "--skill",
            "billing-cost-management",
            "--question",
            question,
            "--note",
            "来自另一个 Agent",
        ], {environment}))
        const listResult = JSON.parse(runTool(["list", "--json"], {environment}))
        const store = new RawCaseStore(path)

        assert.equal(enqueueResult.created.length, 1)
        assert.equal(listResult.rawCases.length, 1)
        assert.equal(listResult.rawCases[0].question, question.trim())
        assert.equal(listResult.rawCases[0].skill.name, "billing-cost-management")
        assert.equal(store.list()[0].source.kind, "external-cli")
        store.close()
    })

    it("accepts a bounded JSON batch from stdin and reports duplicates", () => {
        const {environment} = fixtureEnvironment()
        const payload = JSON.stringify({
            skill: {name: "billing-cost-management"},
            cases: [
                {question: "问题一"},
                {question: "问题一"},
                {question: "问题二", note: "稍后确认"},
            ],
        })

        const result = JSON.parse(runTool(["enqueue", "--json", "-"], {
            environment,
            input: payload,
        }))

        assert.equal(result.created.length, 2)
        assert.equal(result.duplicates.length, 1)
        assert.equal(result.rejected.length, 0)
    })

    it("serves enqueue and list through MCP stdio without protocol noise on stdout", async () => {
        const {environment} = fixtureEnvironment()
        const [{Client}, {StdioClientTransport}] = await Promise.all([
            import("@modelcontextprotocol/client"),
            import("@modelcontextprotocol/client/stdio"),
        ])
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [toolPath, "mcp"],
            env: environment,
            stderr: "pipe",
        })
        const client = new Client({name: "rolling-skill-tool-test", version: "1.0.0"})
        try {
            await client.connect(transport)
            const tools = await client.listTools()
            assert.deepEqual(
                tools.tools.map((tool) => tool.name).sort(),
                ["rolling_skill_enqueue_raw_cases", "rolling_skill_list_raw_cases"],
            )

            const enqueued = await client.callTool({
                name: "rolling_skill_enqueue_raw_cases",
                arguments: {
                    skill: {name: "billing-cost-management"},
                    cases: [{question: "MCP 生成的问题一"}, {question: "MCP 生成的问题二"}],
                },
            })
            assert.equal(enqueued.structuredContent.created.length, 2)

            const listed = await client.callTool({
                name: "rolling_skill_list_raw_cases",
                arguments: {skillName: "billing-cost-management"},
            })
            assert.equal(listed.structuredContent.rawCases.length, 2)
        } finally {
            await client.close().catch(() => {})
        }
    })
})
