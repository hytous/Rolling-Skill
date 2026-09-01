const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {
    SURFACE_PARITY_MANIFEST,
    surfaceParityReport,
} = require("../src/surface-parity-manifest.cjs")

describe("Rolling Skill surface parity manifest", () => {
    it("describes real user journeys instead of synthetic completion claims", () => {
        for (const entry of SURFACE_PARITY_MANIFEST) {
            assert.match(entry.journeyId, /^J(?:[1-9]|1[01])$/)
            assert.ok(entry.capability.length >= 8)
            assert.ok(entry.acceptance.length >= 6)
            assert.ok(!entry.electronOwner.includes("baseline capability"))
            assert.ok([
                "native",
                "complete",
                "partial",
                "broken",
                "intentional",
            ].includes(entry.status))
            if (entry.status === "complete") {
                assert.notEqual(entry.uiEvidence, "Pending installed DSH browser verification")
            }
        }
    })

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
            assert.ok([
                "native",
                "complete",
                "partial",
                "broken",
                "intentional",
            ].includes(entry.status))
            assert.equal(typeof entry.implementation, "string")
            assert.equal(typeof entry.automatedEvidence, "string")
            assert.equal(typeof entry.uiEvidence, "string")
            assert.equal(typeof entry.approvedDifference, "string")
        }
        const report = surfaceParityReport()
        assert.equal(report.total, 136)
        assert.equal(Object.values(report.byStatus).reduce((sum, count) => sum + count, 0), 136)
        assert.deepEqual(
            SURFACE_PARITY_MANIFEST.filter((entry) => entry.status === "native").map((entry) => entry.id),
            [
                "SH-01", "SH-02", "SH-03", "SH-04", "SH-05", "SH-06",
                "SH-07", "SH-08", "SH-09", "SH-10", "SH-11", "ST-03",
            ],
        )
        assert.deepEqual(
            SURFACE_PARITY_MANIFEST.filter((entry) => entry.status === "broken").map((entry) => entry.id),
            ["CU-09", "RB-03", "RB-05", "RB-06", "QL-06"],
        )
        assert.deepEqual(report.gaps, SURFACE_PARITY_MANIFEST.filter((entry) => entry.status === "partial" || entry.status === "broken").map((entry) => entry.id))
    })
})
