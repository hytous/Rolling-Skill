import {chmod, mkdir} from "node:fs/promises"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {build} from "esbuild"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const outputDirectory = join(root, "dist-tools")
const outputPath = join(outputDirectory, "rolling-skill-tool")

await mkdir(outputDirectory, {recursive: true})
await build({
    entryPoints: [join(root, "tools", "rolling-skill-tool.mjs")],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    legalComments: "none",
    sourcemap: false,
})
await chmod(outputPath, 0o755)

process.stdout.write(`${outputPath}\n`)
