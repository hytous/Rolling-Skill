import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  evaluateCodexSkillCompliance,
  type CodexSkillEvaluationInput,
  type EvaluatedSkillAssertion,
  type SkillEvaluationEvidence,
  type SkillRubricAssertion,
  type ValidatedObservableEvidenceIndex,
} from "../../src/evaluation/codex-skill-evaluation.ts";

const INDEX: ValidatedObservableEvidenceIndex = {
  payloads: [
    { reference: "payloads/000001.json", digest: "sha256:skill" },
    { reference: "payloads/000002.json", digest: "sha256:reference" },
    { reference: "payloads/000003.json", digest: "sha256:resolve" },
    { reference: "payloads/000004.json", digest: "sha256:query" },
    { reference: "trace.jsonl#1-4", digest: "sha256:window" },
  ],
  events: [
    {
      sequence: 1,
      eventType: "file.read",
      observable: "skill_file_read",
      payloadReference: "payloads/000001.json",
      payloadDigest: "sha256:skill",
      attributes: { path: "/skills/billing-cost-management/SKILL.md" },
    },
    {
      sequence: 2,
      eventType: "file.read",
      observable: "reference_file_read",
      payloadReference: "payloads/000002.json",
      payloadDigest: "sha256:reference",
      attributes: { path: "/skills/billing-cost-management/references/query.md" },
    },
    {
      sequence: 3,
      eventType: "tool.completed",
      observable: "tool_order",
      payloadReference: "payloads/000003.json",
      payloadDigest: "sha256:resolve",
      attributes: { operation: "resolve_product" },
    },
    {
      sequence: 4,
      eventType: "tool.completed",
      observable: "tool_order",
      payloadReference: "payloads/000004.json",
      payloadDigest: "sha256:query",
      attributes: { operation: "query_billing" },
    },
  ],
  searchWindow: {
    startSequence: 1,
    endSequence: 4,
    eventType: "bounded_search_window",
    payloadReference: "trace.jsonl#1-4",
    payloadDigest: "sha256:window",
  },
};

const EVIDENCE: SkillEvaluationEvidence = {
  bundleId: "rollout-123",
  sourceTrust: "runtime_isolated",
  valid: true,
  completeness: "rollout_complete",
  hardScoreEligible: true,
  reasonCodes: [],
  index: INDEX,
};

const SKILL_READ_RULE: SkillRubricAssertion = {
  id: "billing.skill-read",
  tier: "A",
  observable: "skill_file_read",
  explanation: "The required billing SKILL.md must be read.",
  expectation: {
    kind: "event_present",
    event: {
      eventType: "file.read",
      attributes: { path: "/skills/billing-cost-management/SKILL.md" },
    },
  },
};

const REFERENCE_RULE: SkillRubricAssertion = {
  id: "billing.reference-read",
  tier: "A",
  observable: "reference_file_read",
  explanation: "The query reference must be read.",
  expectation: {
    kind: "count_at_least",
    minimum: 1,
    event: {
      eventType: "file.read",
      attributes: { path: "/skills/billing-cost-management/references/query.md" },
    },
  },
};

const ORDER_RULE: SkillRubricAssertion = {
  id: "billing.query-order",
  tier: "A",
  observable: "tool_order",
  explanation: "Product resolution must precede the billing query.",
  expectation: {
    kind: "ordered_events",
    before: {
      eventType: "tool.completed",
      attributes: { operation: "resolve_product" },
    },
    after: {
      eventType: "tool.completed",
      attributes: { operation: "query_billing" },
    },
  },
};

function evaluate(overrides: Partial<CodexSkillEvaluationInput> = {}) {
  return evaluateCodexSkillCompliance({
    evidence: EVIDENCE,
    rubric: [SKILL_READ_RULE, REFERENCE_RULE, ORDER_RULE],
    bClassAssessment: { kind: "unscored" },
    ...overrides,
  });
}

describe("evaluateCodexSkillCompliance", () => {
  it("fails closed before structural evaluation when the writer is not isolated", () => {
    const result = evaluate({
      evidence: {
        ...EVIDENCE,
        sourceTrust: "diagnostic_full_access",
        valid: false,
        reasonCodes: ["forged.bundle.reason"],
      },
    });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["trace.writer-not-isolated"]);
    assert.deepEqual(result.assertions, []);
  });

  it("evaluates event_present, count_at_least, and ordered_events from the validated index", () => {
    const result = evaluate();

    assert.equal(result.state, "PASSED");
    assert.deepEqual(result.assertions.map(({ outcome }) => outcome), ["pass", "pass", "pass"]);
    assert.deepEqual(result.bClass, {
      state: "B_UNSCORED",
      reasonCode: "b.oracle-not-configured",
    });
  });

  it("does not evaluate A assertions when hardScoreEligible is false", () => {
    const result = evaluate({
      evidence: {
        ...EVIDENCE,
        hardScoreEligible: false,
        reasonCodes: ["trace.unknown-event-type"],
      },
    });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.hardGate.failedAssertionIds, []);
    assert.deepEqual(result.assertions, []);
  });

  it("rejects an untrusted prefilled outcome instead of accepting or copying it", () => {
    const forged = {
      ...SKILL_READ_RULE,
      outcome: "pass",
      expectation: {
        kind: "event_present" as const,
        event: {
          eventType: "file.read",
          attributes: { path: "/skills/not-read/SKILL.md" },
        },
      },
    };
    const result = evaluate({ rubric: [forged] });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.assertions, []);
    assert.deepEqual(result.reasonCodes, ["evaluator.invalid-assertion"]);
  });

  it("constructs a reference-read locator from the exact indexed event and payload", () => {
    const result = evaluate({ rubric: [REFERENCE_RULE] });

    assert.deepEqual(result.assertions[0].evidence, [
      {
        bundleId: "rollout-123",
        sequence: 2,
        eventType: "file.read",
        payloadDigest: "sha256:reference",
        payloadReference: "payloads/000002.json",
      },
    ]);
  });

  it("returns no assertion results for structurally invalid evidence", () => {
    const result = evaluate({
      evidence: {
        ...EVIDENCE,
        valid: false,
        reasonCodes: ["trace.sequence-gap"],
      },
    });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["trace.sequence-gap"]);
    assert.deepEqual(result.assertions, []);
  });

  it("returns no assertion results when the run is cancelled", () => {
    const result = evaluate({ cancelled: true });

    assert.equal(result.state, "CANCELLED");
    assert.deepEqual(result.hardGate.failedAssertionIds, []);
    assert.deepEqual(result.assertions, []);
  });

  it("rejects event locators whose digest/reference do not match the payload index", () => {
    const tamperedIndex: ValidatedObservableEvidenceIndex = {
      ...INDEX,
      events: INDEX.events.map((event) =>
        event.sequence === 1 ? { ...event, payloadDigest: "sha256:forged" } : event,
      ),
    };
    const result = evaluate({ evidence: { ...EVIDENCE, index: tamperedIndex } });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["evaluator.invalid-evidence-index"]);
    assert.deepEqual(result.assertions, []);
  });

  it("rejects sequence zero instead of producing a locator outside the native contract", () => {
    const invalidIndex: ValidatedObservableEvidenceIndex = {
      ...INDEX,
      events: INDEX.events.map((event, index) =>
        index === 0 ? { ...event, sequence: 0 } : event,
      ),
    };
    const result = evaluate({ evidence: { ...EVIDENCE, index: invalidIndex } });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["evaluator.invalid-evidence-index"]);
  });

  it("rejects an empty bundle identifier before constructing locators", () => {
    const result = evaluate({ evidence: { ...EVIDENCE, bundleId: "" } });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["evaluator.invalid-evidence-index"]);
  });

  it("accepts a valid warm-turn slice whose bounded window starts after sequence one", () => {
    const warmIndex: ValidatedObservableEvidenceIndex = {
      payloads: [
        ...INDEX.payloads,
        { reference: "trace.jsonl#3-4", digest: "sha256:warm-window" },
      ],
      events: INDEX.events.filter(({ sequence }) => sequence >= 3),
      searchWindow: {
        startSequence: 3,
        endSequence: 4,
        eventType: "bounded_search_window",
        payloadReference: "trace.jsonl#3-4",
        payloadDigest: "sha256:warm-window",
      },
    };
    const result = evaluate({
      evidence: { ...EVIDENCE, index: warmIndex },
      rubric: [ORDER_RULE],
    });

    assert.equal(result.state, "PASSED");
    assert.equal(result.assertions[0].outcome, "pass");
  });

  it("rejects an indexed event that precedes the declared warm-turn window", () => {
    const invalidWarmIndex: ValidatedObservableEvidenceIndex = {
      ...INDEX,
      searchWindow: {
        ...INDEX.searchWindow,
        startSequence: 2,
      },
    };
    const result = evaluate({
      evidence: { ...EVIDENCE, index: invalidWarmIndex },
    });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["evaluator.invalid-evidence-index"]);
    assert.deepEqual(result.assertions, []);
  });

  it("uses two real indexed points when observed events are in the wrong order", () => {
    const reversedIndex: ValidatedObservableEvidenceIndex = {
      ...INDEX,
      events: INDEX.events.map((event) => {
        if (event.sequence === 3) return { ...event, attributes: { operation: "query_billing" } };
        if (event.sequence === 4) return { ...event, attributes: { operation: "resolve_product" } };
        return event;
      }),
    };
    const result = evaluate({
      evidence: { ...EVIDENCE, index: reversedIndex },
      rubric: [ORDER_RULE],
    });

    assert.equal(result.assertions[0].outcome, "fail");
    assert.deepEqual(result.assertions[0].evidence.map(({ sequence }) => sequence), [4, 3]);
  });

  it("uses the bounded absence window when an ordered endpoint is absent", () => {
    const absentAfter: SkillRubricAssertion = {
      ...ORDER_RULE,
      expectation: {
        kind: "ordered_events",
        before: {
          eventType: "tool.completed",
          attributes: { operation: "resolve_product" },
        },
        after: {
          eventType: "tool.completed",
          attributes: { operation: "publish_iwiki" },
        },
      },
    };
    const result = evaluate({ rubric: [absentAfter] });

    assert.equal(result.assertions[0].outcome, "fail");
    assert.deepEqual(result.assertions[0].evidence[0].sequence, { start: 1, end: 4 });
  });

  it("reports a scored B failure without changing a passing A state", () => {
    const result = evaluate({
      rubric: [SKILL_READ_RULE],
      bClassAssessment: {
        kind: "scored",
        oracleId: "billing-ground-truth-v1",
        score: 0.2,
        passed: false,
      },
    });

    assert.equal(result.state, "PASSED");
    assert.deepEqual(result.bClass, {
      scored: true,
      outcome: "fail",
      oracleId: "billing-ground-truth-v1",
      score: 0.2,
    });
  });

  it.each([null, 42, [null], ["not-an-assertion"]])(
    "fails closed with a stable reason for malformed rubric input %j",
    (rubric) => {
      const result = evaluate({ rubric });

      assert.equal(result.state, "INVALID_TRACE");
      assert.deepEqual(result.reasonCodes, ["evaluator.invalid-assertion"]);
      assert.deepEqual(result.assertions, []);
    },
  );

  it("deeply snapshots and freezes the auditable result", () => {
    const mutableRule = structuredClone(SKILL_READ_RULE) as SkillRubricAssertion;
    const result = evaluate({ rubric: [mutableRule] });
    const expectation = mutableRule.expectation;
    assert.equal(expectation.kind, "event_present");
    (expectation.event.attributes as Record<string, string>).path = "/mutated/SKILL.md";

    const resultExpectation = result.assertions[0].expectation;
    assert.equal(resultExpectation.kind, "event_present");
    assert.equal(
      resultExpectation.event.attributes?.path,
      "/skills/billing-cost-management/SKILL.md",
    );
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.hardGate));
    assert.ok(Object.isFrozen(result.hardGate.failedAssertionIds));
    assert.ok(Object.isFrozen(result.bClass));
    assert.ok(Object.isFrozen(result.assertions));
    assert.ok(Object.isFrozen(result.assertions[0]));
    assert.ok(Object.isFrozen(resultExpectation));
    assert.ok(Object.isFrozen(resultExpectation.event));
    assert.ok(Object.isFrozen(resultExpectation.event.attributes));
    assert.ok(Object.isFrozen(result.assertions[0].evidence));
    assert.throws(
      () =>
        (result.assertions as unknown as EvaluatedSkillAssertion[]).push(
          result.assertions[0],
        ),
      TypeError,
    );
  });

  it("exposes the entire result tree as recursively readonly", () => {
    const result = evaluate();

    if (false) {
      // @ts-expect-error public top-level state is readonly
      result.state = "CANCELLED";
      // @ts-expect-error nested hard-gate arrays are readonly
      result.hardGate.failedAssertionIds.push("forged.assertion");
      // @ts-expect-error evaluated outcomes are readonly
      result.assertions[0].outcome = "fail";
      // @ts-expect-error nested expectation objects are readonly
      result.assertions[0].expectation.kind = "event_present";
      // @ts-expect-error locator fields are readonly
      result.assertions[0].evidence[0].eventType = "forged.event";
      // @ts-expect-error result reason arrays are readonly
      result.reasonCodes.push("forged.reason");
    }

    assert.ok(Object.isFrozen(result));
  });

  it.each([
    [
      { ...SKILL_READ_RULE, unexpected: true },
      "evaluator.invalid-assertion",
    ],
    [
      {
        ...SKILL_READ_RULE,
        expectation: {
          ...SKILL_READ_RULE.expectation,
          unexpected: true,
        },
      },
      "evaluator.invalid-expectation",
    ],
    [
      {
        ...SKILL_READ_RULE,
        expectation: {
          kind: "event_present",
          event: {
            eventType: "file.read",
            attributes: {},
            unexpected: true,
          },
        },
      },
      "evaluator.invalid-expectation",
    ],
  ])("rejects unknown rubric keys with %s", (rubric, reasonCode) => {
    const result = evaluate({ rubric: [rubric] });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, [reasonCode]);
  });

  it("rejects a cyclic unknown property without recursing or throwing", () => {
    const cyclic: Record<string, unknown> = { ...SKILL_READ_RULE };
    cyclic.unexpected = cyclic;

    const result = evaluate({ rubric: [cyclic] });

    assert.equal(result.state, "INVALID_TRACE");
    assert.deepEqual(result.reasonCodes, ["evaluator.invalid-assertion"]);
  });

  it("bounds rubric assertion count and matcher attribute count/size", () => {
    const tooManyAssertions = Array.from({ length: 257 }, (_, index) => ({
      ...SKILL_READ_RULE,
      id: `billing.rule-${index}`,
    }));
    const tooManyAttributes = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`key-${index}`, "value"]),
    );
    const oversizedAttribute = "x".repeat(20_000);

    assert.deepEqual(
      evaluate({ rubric: tooManyAssertions }).reasonCodes,
      ["evaluator.rubric-limit-exceeded"],
    );
    assert.deepEqual(
      evaluate({
        rubric: [
          {
            ...SKILL_READ_RULE,
            expectation: {
              kind: "event_present",
              event: {
                eventType: "file.read",
                attributes: tooManyAttributes,
              },
            },
          },
        ],
      }).reasonCodes,
      ["evaluator.invalid-expectation"],
    );
    assert.deepEqual(
      evaluate({
        rubric: [
          {
            ...SKILL_READ_RULE,
            expectation: {
              kind: "event_present",
              event: {
                eventType: "file.read",
                attributes: { path: oversizedAttribute },
              },
            },
          },
        ],
      }).reasonCodes,
      ["evaluator.invalid-expectation"],
    );
  });

  it("finds a stable reversed-order witness without quadratic sequence scans", () => {
    const eventCountPerSide = 300;
    let sequenceReads = 0;
    const payloads: Array<{ reference: string; digest: string }> = [];
    const events = Array.from(
      { length: eventCountPerSide * 2 },
      (_, index) => {
        const sequence = index + 1;
        const payloadReference = `payloads/${String(sequence).padStart(6, "0")}.json`;
        const payloadDigest = `sha256:event-${sequence}`;
        payloads.push({ reference: payloadReference, digest: payloadDigest });
        return {
          get sequence() {
            sequenceReads += 1;
            if (sequenceReads > 10_000) {
              throw new Error("quadratic ordered-events witness scan");
            }
            return sequence;
          },
          eventType: "tool.completed",
          observable: "tool_order" as const,
          payloadReference,
          payloadDigest,
          attributes: {
            operation:
              sequence <= eventCountPerSide
                ? "query_billing"
                : "resolve_product",
          },
        };
      },
    );
    payloads.push({ reference: "trace.jsonl#1-600", digest: "sha256:large-window" });
    const largeIndex: ValidatedObservableEvidenceIndex = {
      payloads,
      events,
      searchWindow: {
        startSequence: 1,
        endSequence: eventCountPerSide * 2,
        eventType: "bounded_search_window",
        payloadReference: "trace.jsonl#1-600",
        payloadDigest: "sha256:large-window",
      },
    };

    const result = evaluate({
      evidence: { ...EVIDENCE, index: largeIndex },
      rubric: [ORDER_RULE],
    });

    assert.equal(result.state, "BEHAVIOR_FAILED");
    assert.deepEqual(result.assertions[0].evidence.map(({ sequence }) => sequence), [301, 300]);
    assert.ok(sequenceReads < 10_000);
  });
});
