import {spawn} from "node:child_process"

export function createPathRevealer({platform = process.platform, spawnProcess = spawn} = {}) {
    if (typeof spawnProcess !== "function") throw new Error("Path reveal launcher is invalid")
    return (path) => new Promise((resolve, reject) => {
        if (typeof path !== "string" || !path) {
            reject(new Error("Trusted path is required"))
            return
        }
        const [command, args] = platform === "darwin"
            ? ["open", [path]]
            : platform === "win32"
                ? ["explorer.exe", [path]]
                : ["xdg-open", [path]]
        const child = spawnProcess(command, args, {detached: true, shell: false, stdio: "ignore"})
        child.once("error", reject)
        child.once("spawn", () => {
            child.unref?.()
            resolve()
        })
    })
}
