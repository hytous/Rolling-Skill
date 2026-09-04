import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

import {build} from "esbuild"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoot = join(packageRoot, "src")
const outputRoot = join(packageRoot, "lib")
const controlToolSource = join(
    packageRoot,
    "..",
    "..",
    "desktop",
    "rolling-skill",
    "tools",
    "rolling-skill-tool.mjs",
)
const dshExternals = ["@deepseek-ai/*", "react", "react/jsx-runtime"]

await rm(outputRoot, {recursive: true, force: true})
await mkdir(outputRoot, {recursive: true})

await build({
    entryPoints: [join(sourceRoot, "host", "index.js")],
    outfile: join(outputRoot, "index.js"),
    banner: {
        js: 'import {createRequire} from "node:module"; const require = createRequire(import.meta.url);',
    },
    bundle: true,
    external: dshExternals,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "warning",
})

await build({
    entryPoints: [join(sourceRoot, "worker", "cli.cjs")],
    outfile: join(outputRoot, "worker.cjs"),
    bundle: true,
    external: dshExternals,
    format: "cjs",
    platform: "node",
    target: "node22",
    logLevel: "warning",
})

await chmod(join(outputRoot, "worker.cjs"), 0o755)

await build({
    entryPoints: [controlToolSource],
    outfile: join(outputRoot, "rolling-skill-tool"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    legalComments: "none",
    sourcemap: false,
    logLevel: "warning",
})

await chmod(join(outputRoot, "rolling-skill-tool"), 0o755)

await build({
    entryPoints: [join(sourceRoot, "client", "index.tsx")],
    outfile: join(outputRoot, "client.js"),
    banner: {
        js: "window.__ModuleLoader__.load({id:'@rolling-skill/dsh-plugin',factory:(require)=>{var module={exports:{}};var exports=module.exports;",
    },
    footer: {js: "return module.exports;}});"},
    bundle: true,
    external: dshExternals,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    loader: {".css": "text"},
    logLevel: "warning",
})

for (const filename of ["index.js", "client.js", "worker.cjs", "rolling-skill-tool"]) {
    const path = join(outputRoot, filename)
    const source = await readFile(path, "utf8")
    await writeFile(path, source.replace(/[ \t]+$/gmu, ""), "utf8")
}
