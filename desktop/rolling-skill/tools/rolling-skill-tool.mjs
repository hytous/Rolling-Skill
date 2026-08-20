#!/usr/bin/env node

import {readFile} from "node:fs/promises"
import process from "node:process"
import {McpServer} from "@modelcontextprotocol/server"
import {serveStdio} from "@modelcontextprotocol/server/stdio"
import {z} from "zod"
import rawCaseStoreModule from "../src/raw-case-store.cjs"

const {RawCaseStore} = rawCaseStoreModule

const TOOL_VERSION = "0.1.0"

function parseArguments(arguments_) {
    const [command = "help", ...tokens] = arguments_
    const options = {}
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]
        if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`)
        const name = token.slice(2)
        if (name === "json") {
            options.json = tokens[index + 1]
            index += 1
        } else if (name === "skill" || name === "skill-path" || name === "question" || name === "note") {
            if (tokens[index + 1] === undefined) throw new Error(`Missing value for --${name}`)
            options[name] = tokens[index + 1]
            index += 1
        } else {
            throw new Error(`Unknown option: --${name}`)
        }
    }
    return {command, options}
}

async function readStandardInput() {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return Buffer.concat(chunks).toString("utf8")
}

async function readJsonInput(path) {
    if (!path) throw new Error("--json requires a file path or - for stdin")
    return JSON.parse(path === "-" ? await readStandardInput() : await readFile(path, "utf8"))
}

function externalInput(entry, skill, sourceKind) {
    return {
        question: entry?.question,
        skill: entry?.skill ?? skill,
        note: entry?.note ?? "",
        source: {kind: sourceKind},
    }
}

function enqueueBatch(store, payload, sourceKind) {
    const cases = Array.isArray(payload?.cases) ? payload.cases : []
    if (!cases.length) throw new Error("At least one Raw Case is required")
    return store.addMany(cases.map((entry) => externalInput(entry, payload.skill, sourceKind)))
}

function serializableResult(result) {
    return JSON.parse(JSON.stringify(result))
}

function toolResponse(result) {
    const structuredContent = serializableResult(result)
    return {
        content: [{type: "text", text: JSON.stringify(structuredContent)}],
        structuredContent,
    }
}

function createRawCaseMcpServer() {
    const server = new McpServer(
        {name: "rolling-skill-raw-case-inbox", version: TOOL_VERSION},
        {capabilities: {tools: {}}},
    )
    server.registerTool(
        "rolling_skill_enqueue_raw_cases",
        {
            title: "Enqueue Rolling Skill Raw Cases",
            description:
                "Append unverified natural-language questions to Rolling Skill's Raw Case inbox. This does not execute a runtime or create formal evaluation Cases.",
            inputSchema: z.object({
                skill: z.object({
                    name: z.string().min(1).max(200),
                    path: z.string().max(4000).optional(),
                }),
                cases: z.array(z.object({
                    question: z.string().min(1).max(120000),
                    note: z.string().max(10000).optional(),
                })).min(1).max(200),
            }),
            outputSchema: z.object({
                created: z.array(z.any()),
                duplicates: z.array(z.any()),
                rejected: z.array(z.any()),
            }),
            annotations: {
                title: "Enqueue Raw Cases",
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async (input) => {
            const store = new RawCaseStore()
            try {
                return toolResponse(enqueueBatch(store, input, "external-mcp"))
            } finally {
                store.close()
            }
        },
    )
    server.registerTool(
        "rolling_skill_list_raw_cases",
        {
            title: "List Rolling Skill Raw Cases",
            description: "List pending questions in Rolling Skill's Raw Case inbox.",
            inputSchema: z.object({skillName: z.string().max(200).optional()}),
            outputSchema: z.object({rawCases: z.array(z.any())}),
            annotations: {
                title: "List Raw Cases",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({skillName}) => {
            const store = new RawCaseStore()
            try {
                return toolResponse({rawCases: store.list({skillName})})
            } finally {
                store.close()
            }
        },
    )
    return server
}

function usage() {
    return [
        "rolling-skill-tool enqueue --skill <name> --question <text> [--skill-path <path>] [--note <text>]",
        "rolling-skill-tool enqueue --json <file|->",
        "rolling-skill-tool list [--skill <name>] --json",
        "rolling-skill-tool mcp",
    ].join("\n")
}

async function runCli(arguments_) {
    const {command, options} = parseArguments(arguments_)
    if (command === "mcp") {
        serveStdio(() => createRawCaseMcpServer(), {
            onerror: (error) => console.error(error?.stack || error?.message || String(error)),
        })
        return
    }
    if (command === "help" || command === "--help" || command === "-h") {
        process.stdout.write(`${usage()}\n`)
        return
    }
    const store = new RawCaseStore()
    try {
        if (command === "enqueue") {
            let result
            if (options.json) {
                result = enqueueBatch(store, await readJsonInput(options.json), "external-cli")
            } else {
                const added = store.add({
                    question: options.question,
                    skill: {name: options.skill, path: options["skill-path"]},
                    note: options.note,
                    source: {kind: "external-cli"},
                })
                result = added?.created === false
                    ? {created: [], duplicates: [{index: 0, duplicateOf: added.duplicateOf}], rejected: []}
                    : {created: [added], duplicates: [], rejected: []}
            }
            process.stdout.write(`${JSON.stringify(result)}\n`)
            return
        }
        if (command === "list") {
            process.stdout.write(`${JSON.stringify({rawCases: store.list({skillName: options.skill})})}\n`)
            return
        }
        throw new Error(`Unknown command: ${command}\n${usage()}`)
    } finally {
        store.close()
    }
}

runCli(process.argv.slice(2)).catch((error) => {
    console.error(error?.message || String(error))
    process.exitCode = 1
})

export {createRawCaseMcpServer, enqueueBatch, parseArguments, runCli}
