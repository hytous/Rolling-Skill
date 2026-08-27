const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {
    SURFACE_PARITY_MANIFEST,
    surfaceParityReport,
} = require("../src/surface-parity-manifest.cjs")

describe("Rolling Skill surface parity manifest", () => {
    it("tracks exactly every ID in the 136-capability ledger with explicit evidence state", () => {
        const ledger = readFileSync(join(
            __dirname,
            "../../../docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md",
        ), "utf8")
        const ledgerIds = [...ledger.matchAll(/^\| ([A-Z]{2}-\d{2}) \|/gmu)].map((match) => match[1])
        const manifestIds = SURFACE_PARITY_MANIFEST.map((entry) => entry.id)

        assert.equal(manifestIds.length, 136)
        assert.equal(new Set(manifestIds).size, 136)
        assert.deepEqual(manifestIds, ledgerIds)
        for (const entry of SURFACE_PARITY_MANIFEST) {
            assert.ok(entry.family)
            assert.ok(entry.electronOwner)
            assert.ok(entry.dshOwner)
            assert.ok(["baseline", "red", "green", "ui-verified"].includes(entry.status))
            assert.equal(typeof entry.implementation, "string")
            assert.equal(typeof entry.automatedEvidence, "string")
            assert.equal(typeof entry.uiEvidence, "string")
            assert.equal(typeof entry.approvedDifference, "string")
        }
        const report = surfaceParityReport()
        assert.equal(report.total, 136)
        assert.equal(report.byStatus.green + report.byStatus["ui-verified"] + report.byStatus.red + report.byStatus.baseline, 136)
        assert.deepEqual(
            SURFACE_PARITY_MANIFEST.filter((entry) => entry.status === "ui-verified").map((entry) => entry.id),
            [
                "SH-01", "SH-02", "SH-03", "SH-04", "SH-05", "SH-06",
                "SH-07", "SH-08", "SH-09", "SH-10", "SH-11", "SH-12",
                "ST-03", "QL-09",
            ],
        )
        assert.deepEqual(report.gaps, ["ST-10"])
        assert.deepEqual(report.gaps, SURFACE_PARITY_MANIFEST.filter((entry) => entry.status === "red" || entry.status === "baseline").map((entry) => entry.id))
    })
})
