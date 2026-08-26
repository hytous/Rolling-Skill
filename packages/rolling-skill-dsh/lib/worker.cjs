#!/usr/bin/env node

// src/worker/cli.cjs
async function main() {
  return 0;
}
if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
module.exports = { main };
