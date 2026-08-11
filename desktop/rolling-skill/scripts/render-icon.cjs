const {app, BrowserWindow} = require("electron")
const {writeFileSync} = require("node:fs")
const {resolve} = require("node:path")
const {pathToFileURL} = require("node:url")

const source = resolve(process.argv[2] ?? "assets/icon-spin-keycap.svg")
const target = resolve(process.argv[3] ?? "assets/icon-spin-keycap.png")

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        width: 1024,
        height: 1024,
        useContentSize: true,
        show: false,
        frame: false,
        transparent: true,
    })
    await window.loadURL(pathToFileURL(source).href)
    await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)")
    const rendered = await window.webContents.capturePage({x: 0, y: 0, width: 1024, height: 1024})
    const output = rendered.resize({width: 1024, height: 1024, quality: "best"})
    writeFileSync(target, output.toPNG())
    window.destroy()
    app.quit()
}).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    app.exit(1)
})
