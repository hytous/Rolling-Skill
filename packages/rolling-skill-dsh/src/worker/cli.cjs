#!/usr/bin/env node

async function main() {
    return 0
}

if (require.main === module) {
    void main().then((code) => {
        process.exitCode = code
    })
}

module.exports = {main}
