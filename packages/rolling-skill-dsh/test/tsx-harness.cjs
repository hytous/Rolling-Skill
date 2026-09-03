const {buildSync} = require("esbuild")
const {join} = require("node:path")
const React = require("react")

function loadView(file) {
    const built = buildSync({
        entryPoints: [join(__dirname, "../src/client/workbench", file)],
        bundle: true,
        platform: "node",
        format: "cjs",
        jsx: "automatic",
        write: false,
        external: ["react", "react/jsx-runtime", "@deepseek-ai/*"],
    })
    const loaded = {exports: {}}
    const boundaryRequire = (id) => id === "@deepseek-ai/dsh-client-ui-primitives"
        ? {
            Button: ({children, ...props}) => React.createElement("button", props, children),
            Input: (props) => React.createElement("input", props),
            Modal: ({open, children, footer}) => open ? React.createElement("section", {}, children, footer) : null,
        }
        : require(id)
    new Function("require", "module", "exports", built.outputFiles[0].text)(boundaryRequire, loaded, loaded.exports)
    return loaded.exports
}

function textOf(node) {
    if (typeof node === "string") return node
    return (node.children ?? []).map(textOf).join("")
}

module.exports = {loadView, textOf}
