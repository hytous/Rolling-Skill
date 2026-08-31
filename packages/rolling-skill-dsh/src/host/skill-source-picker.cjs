const {spawn} = require("node:child_process")
const {isAbsolute, resolve, win32} = require("node:path")

const LOCAL_SOURCE_KINDS = new Set(["folder", "local-git", "zip"])
const MAX_OUTPUT_BYTES = 16 * 1024

function requiredLocalKind(value) {
    if (typeof value !== "string" || !LOCAL_SOURCE_KINDS.has(value)) {
        throw new Error("Unsupported local Skill source kind")
    }
    return value
}

function normalizedAbsolutePath(value, platform = process.platform) {
    const selected = typeof value === "string" ? value.trim() : ""
    if (!selected || selected.length > 8_192) return null
    if (platform === "win32") {
        return win32.isAbsolute(selected) ? win32.resolve(selected) : null
    }
    return isAbsolute(selected) ? resolve(selected) : null
}

function macCommand(kind) {
    const prompt = kind === "zip"
        ? "Choose a Skill ZIP file"
        : kind === "local-git"
          ? "Choose a local Git repository"
          : "Choose a Skill folder"
    const choose = kind === "zip"
        ? `choose file with prompt "${prompt}" of type {"zip"}`
        : `choose folder with prompt "${prompt}"`
    return [{
        command: "osascript",
        args: ["-e", `try\nset selectedItem to ${choose}\nPOSIX path of selectedItem\non error number -128\nreturn ""\nend try`],
    }]
}

function windowsCommand(kind) {
    const folder = kind !== "zip"
    const script = folder
        ? [
            "Add-Type -AssemblyName System.Windows.Forms",
            "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
            `$dialog.Description = '${kind === "local-git" ? "Choose a local Git repository" : "Choose a Skill folder"}'`,
            "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
        ].join("; ")
        : [
            "Add-Type -AssemblyName System.Windows.Forms",
            "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
            "$dialog.Title = 'Choose a Skill ZIP file'",
            "$dialog.Filter = 'ZIP archives (*.zip)|*.zip'",
            "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }",
        ].join("; ")
    return [{command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-STA", "-Command", script]}]
}

function linuxCommands(kind) {
    const folder = kind !== "zip"
    const title = kind === "zip"
        ? "Choose a Skill ZIP file"
        : kind === "local-git"
          ? "Choose a local Git repository"
          : "Choose a Skill folder"
    const zenityArgs = ["--file-selection", `--title=${title}`]
    if (folder) zenityArgs.push("--directory")
    else zenityArgs.push("--file-filter=ZIP archives | *.zip")
    const kdialogArgs = folder
        ? ["--getexistingdirectory", ".", title]
        : ["--getopenfilename", ".", "*.zip|ZIP archives", title]
    return [
        {command: "zenity", args: zenityArgs},
        {command: "kdialog", args: kdialogArgs},
    ]
}

function pickerCommands(platform, kind) {
    if (platform === "darwin") return macCommand(kind)
    if (platform === "win32") return windowsCommand(kind)
    if (platform === "linux") return linuxCommands(kind)
    throw new Error(`System Skill source picker is unavailable on ${platform}`)
}

function runPickerCommand(command, args, {spawnProcess = spawn} = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawnProcess(command, args, {
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        })
        let output = ""
        let errorOutput = ""
        let settled = false
        const finish = (value, error = null) => {
            if (settled) return
            settled = true
            if (error) rejectPromise(error)
            else resolvePromise(value)
        }
        const append = (current, chunk) => {
            const next = current + String(chunk)
            return next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next
        }
        child.stdout?.on("data", (chunk) => { output = append(output, chunk) })
        child.stderr?.on("data", (chunk) => { errorOutput = append(errorOutput, chunk) })
        child.once("error", (error) => {
            if (error?.code === "ENOENT") finish({status: "unavailable", output: ""})
            else finish(null, new Error("System Skill source picker could not start"))
        })
        child.once("close", (code) => {
            if (code === 0) finish({status: "selected", output})
            else if (code === 1 || /cancel(?:led|ed)|-128/iu.test(errorOutput)) {
                finish({status: "cancelled", output: ""})
            } else finish(null, new Error("System Skill source picker failed"))
        })
    })
}

function createNativeSkillSourcePicker({platform = process.platform, run = runPickerCommand} = {}) {
    return async function pickSkillSource(kindValue) {
        const kind = requiredLocalKind(kindValue)
        for (const {command, args} of pickerCommands(platform, kind)) {
            const result = await run(command, args)
            if (result?.status === "unavailable") continue
            if (result?.status === "cancelled") return null
            const location = normalizedAbsolutePath(result?.output, platform)
            if (!location) return null
            return location
        }
        throw new Error("No supported system Skill source picker is available")
    }
}

function createSkillSourceDispatch(application, skillSourcePicker) {
    if (!application || typeof application.dispatch !== "function") {
        throw new Error("Rolling Skill application dispatch is required")
    }
    if (typeof skillSourcePicker !== "function") {
        throw new Error("Skill source picker is required")
    }
    return Object.freeze({
        async dispatch(method, input = {}) {
            if (method !== "skills.chooseSource") return application.dispatch(method, input)
            if (!input || typeof input !== "object" || Array.isArray(input)) {
                throw new Error("Skill source selection input must contain only kind")
            }
            const keys = Object.keys(input)
            if (keys.length !== 1 || keys[0] !== "kind") {
                throw new Error("Skill source selection input must contain only kind")
            }
            const kind = requiredLocalKind(input.kind)
            const selected = await skillSourcePicker(kind)
            const location = selected === null ? null : normalizedAbsolutePath(selected)
            if (selected !== null && !location) throw new Error("Selected Skill source must be absolute")
            return {kind, location}
        },
    })
}

module.exports = {
    createNativeSkillSourcePicker,
    createSkillSourceDispatch,
    pickerCommands,
    runPickerCommand,
}
