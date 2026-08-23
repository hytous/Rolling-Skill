import {chmod, mkdir} from "node:fs/promises"
import {join, relative} from "node:path"
import {fileURLToPath} from "node:url"
import {build} from "esbuild"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const outputDirectory = join(root, "dist-tools")
const outputPath = join(outputDirectory, "rolling-skill-tool")
const requiredBundledSources = [
    join(root, "src", "control-plane", "contracts.cjs"),
    join(root, "src", "control-plane", "socket-client.cjs"),
    join(root, "src", "json-rpc.cjs"),
]

await mkdir(outputDirectory, {recursive: true})
const result = await build({
    entryPoints: [join(root, "tools", "rolling-skill-tool.mjs")],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    legalComments: "none",
    sourcemap: false,
    metafile: true,
})
const bundledInputs = new Set(Object.keys(result.metafile.inputs).map((input) =>
    relative(root, input.startsWith("/") ? input : join(process.cwd(), input)),
))
for (const source of requiredBundledSources) {
    const input = relative(root, source)
    if (!bundledInputs.has(input)) {
        throw new Error(`External Tool build omitted required shared source: ${input}`)
    }
}
await chmod(outputPath, 0o755)

process.stdout.write(`${outputPath}\n`)
