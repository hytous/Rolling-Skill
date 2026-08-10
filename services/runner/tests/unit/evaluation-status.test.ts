import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  B_CLASS_EVALUATION_STATES,
  EVALUATION_STATES,
  appendAttemptRecord,
  decideAutomaticRetry,
  normalizeAutomaticRetryReasonCode,
  type AttemptEvaluationRecord,
  type RetryPolicyProvenance,
} from "../../src/evaluation/evaluation-status.ts";
import type {
  CodexEvidenceValidationReasonCode,
} from "../../src/engines/sandbox_agent/codex-rollout-schema.ts";

function provenance(
  reasonCode: string,
  declaredTransientToolReasonCodes: readonly string[] = [],
): RetryPolicyProvenance {
  return {
    classifier: "agenta.retry-policy/v1",
    reasonCode,
    declaredTransientToolReasonCodes,
  };
}

describe("evaluation status policy", () => {
  it.each([
    ["EVENT_LOG_NOT_NEWLINE_COMPLETE", "trace.truncated"],
    ["ROOT_THREAD_END_MISSING", "trace.root-terminal-missing"],
    ["PAYLOAD_MISSING", "trace.payload-missing"],
  ] satisfies readonly (readonly [
    CodexEvidenceValidationReasonCode,
    string,
  ])[])("normalizes and retries native validator reason %s", (reasonCode, normalized) => {
    assert.equal(normalizeAutomaticRetryReasonCode(reasonCode), normalized);
    const decision = decideAutomaticRetry({
      observedState: "INVALID_TRACE",
      reasonCode,
      declaredTransientToolReasonCodes: [],
      attemptNumber: 1,
      maxAttempts: 2,
    });

    assert.equal(decision.cause, "TRACE_COMPLETENESS");
    assert.equal(decision.state, "INFRA_RETRYING");
    assert.equal(decision.reasonCode, reasonCode);
  });

  it.each([
    "PAYLOAD_MALFORMED",
    "ROOT_THREAD_ID_MISMATCH",
  ] satisfies readonly CodexEvidenceValidationReasonCode[])(
    "does not retry non-transient native validator reason %s",
    (reasonCode) => {
      const decision = decideAutomaticRetry({
        observedState: "INVALID_TRACE",
        reasonCode,
        declaredTransientToolReasonCodes: [],
        attemptNumber: 1,
        maxAttempts: 2,
      });

      assert.equal(decision.cause, "NON_RETRYABLE_TRACE");
      assert.equal(decision.state, "INVALID_TRACE");
    },
  );

  it("exposes only the approved explicit states", () => {
    assert.deepEqual(EVALUATION_STATES, [
      "PASSED",
      "BEHAVIOR_FAILED",
      "INVALID_TRACE",
      "INFRA_RETRYING",
      "RETRY_EXHAUSTED",
      "CANCELLED",
    ]);
    assert.deepEqual(B_CLASS_EVALUATION_STATES, ["B_UNSCORED"]);
  });

  it.each([
    ["infra.runtime-unavailable", "INFRASTRUCTURE"],
    ["trace.root-terminal-missing", "TRACE_COMPLETENESS"],
  ] as const)("retries the trusted reason %s and retains its classified cause", (reasonCode, cause) => {
    assert.deepEqual(
      decideAutomaticRetry({
        observedState: "INVALID_TRACE",
        reasonCode,
        declaredTransientToolReasonCodes: [],
        attemptNumber: 1,
        maxAttempts: 3,
      }),
      {
        observedState: "INVALID_TRACE",
        state: "INFRA_RETRYING",
        cause,
        retryPolicyProvenance: provenance(reasonCode),
        shouldRetry: true,
        nextAttemptNumber: 2,
        reasonCode,
      },
    );
  });

  it("retries a tool failure only when its exact reason is declared transient", () => {
    const allowed = decideAutomaticRetry({
      observedState: "INVALID_TRACE",
      reasonCode: "tool.billing.rate-limited",
      declaredTransientToolReasonCodes: ["tool.billing.rate-limited"],
      attemptNumber: 1,
      maxAttempts: 2,
    });
    const denied = decideAutomaticRetry({
      observedState: "INVALID_TRACE",
      reasonCode: "tool.billing.permission-denied",
      declaredTransientToolReasonCodes: ["tool.billing.rate-limited"],
      attemptNumber: 1,
      maxAttempts: 2,
    });

    assert.equal(allowed.cause, "TRANSIENT_TOOL");
    assert.deepEqual(
      allowed.retryPolicyProvenance,
      provenance("tool.billing.rate-limited", ["tool.billing.rate-limited"]),
    );
    assert.equal(allowed.state, "INFRA_RETRYING");
    assert.equal(denied.cause, "NON_RETRYABLE_TRACE");
    assert.equal(denied.state, "INVALID_TRACE");
  });

  it("ends a retryable failure as RETRY_EXHAUSTED with the cause visible", () => {
    const result = decideAutomaticRetry({
      observedState: "INVALID_TRACE",
      reasonCode: "trace.truncated",
      declaredTransientToolReasonCodes: [],
      attemptNumber: 3,
      maxAttempts: 3,
    });

    assert.equal(result.state, "RETRY_EXHAUSTED");
    assert.equal(result.cause, "TRACE_COMPLETENESS");
    assert.equal(result.shouldRetry, false);
  });

  it("rejects an attempt number beyond the configured bound", () => {
    assert.throws(
      () =>
        decideAutomaticRetry({
          observedState: "INVALID_TRACE",
          reasonCode: "trace.truncated",
          declaredTransientToolReasonCodes: [],
          attemptNumber: 4,
          maxAttempts: 3,
        }),
      /attemptNumber cannot exceed maxAttempts/,
    );
  });

  it("never retries deterministic behavior failure or cancellation", () => {
    const behavior = decideAutomaticRetry({
      observedState: "BEHAVIOR_FAILED",
      reasonCode: "skill.output-format",
      declaredTransientToolReasonCodes: ["skill.output-format"],
      attemptNumber: 1,
      maxAttempts: 3,
    });
    const cancelled = decideAutomaticRetry({
      observedState: "CANCELLED",
      reasonCode: "run.cancelled",
      declaredTransientToolReasonCodes: ["run.cancelled"],
      attemptNumber: 1,
      maxAttempts: 3,
    });

    assert.equal(behavior.state, "BEHAVIOR_FAILED");
    assert.equal(behavior.cause, "DETERMINISTIC_BEHAVIOR");
    assert.equal(cancelled.state, "CANCELLED");
    assert.equal(cancelled.cause, "USER_CANCELLED");
  });

  it("returns a deeply immutable history snapshot and retains recovery links", () => {
    const mutableReasons = ["trace.truncated"];
    const first: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "INVALID_TRACE",
      state: "INFRA_RETRYING",
      cause: "TRACE_COMPLETENESS",
      retryPolicyProvenance: provenance("trace.truncated"),
      reasonCodes: mutableReasons,
      retryOfAttemptNumber: null,
    };
    const second: AttemptEvaluationRecord = {
      attemptNumber: 2,
      observedState: "PASSED",
      state: "PASSED",
      cause: "NONE",
      retryPolicyProvenance: provenance("evaluation.passed"),
      reasonCodes: [],
      retryOfAttemptNumber: 1,
    };

    const history = appendAttemptRecord([], first);
    const recovered = appendAttemptRecord(history, second);
    mutableReasons.push("mutated.after.append");

    assert.deepEqual(recovered[0].reasonCodes, ["trace.truncated"]);
    assert.equal(recovered[1].retryOfAttemptNumber, 1);
    assert.ok(Object.isFrozen(recovered));
    assert.ok(Object.isFrozen(recovered[0]));
    assert.ok(Object.isFrozen(recovered[0].reasonCodes));
  });

  it("rejects retryOf links that do not target an existing retryable attempt", () => {
    const passed: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "PASSED",
      state: "PASSED",
      cause: "NONE",
      retryPolicyProvenance: provenance("evaluation.passed"),
      reasonCodes: [],
      retryOfAttemptNumber: null,
    };
    const recovery: AttemptEvaluationRecord = {
      attemptNumber: 2,
      observedState: "PASSED",
      state: "PASSED",
      cause: "NONE",
      retryPolicyProvenance: provenance("evaluation.passed"),
      reasonCodes: [],
      retryOfAttemptNumber: 1,
    };

    assert.throws(() => appendAttemptRecord([passed], recovery), /must reference an INFRA_RETRYING/);
    assert.throws(
      () => appendAttemptRecord([], { ...recovery, retryOfAttemptNumber: 99 }),
      /must reference an existing attempt/,
    );
  });

  it("rejects state, observed-state, and cause combinations that cannot occur", () => {
    const inconsistent: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "PASSED",
      state: "INFRA_RETRYING",
      cause: "TRACE_COMPLETENESS",
      retryPolicyProvenance: provenance("trace.truncated"),
      reasonCodes: ["trace.truncated"],
      retryOfAttemptNumber: null,
    };

    assert.throws(() => appendAttemptRecord([], inconsistent), /inconsistent attempt state/);
  });

  it("rejects a corrupted existing history even when the new recovery edge is valid", () => {
    const first: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "INVALID_TRACE",
      state: "INFRA_RETRYING",
      cause: "TRACE_COMPLETENESS",
      retryPolicyProvenance: provenance("trace.truncated"),
      reasonCodes: ["trace.truncated"],
      retryOfAttemptNumber: null,
    };
    const corruptedSecond: AttemptEvaluationRecord = {
      ...first,
      attemptNumber: 2,
      retryOfAttemptNumber: null,
    };
    const recovery: AttemptEvaluationRecord = {
      attemptNumber: 3,
      observedState: "PASSED",
      state: "PASSED",
      cause: "NONE",
      retryPolicyProvenance: provenance("evaluation.passed"),
      reasonCodes: [],
      retryOfAttemptNumber: 2,
    };

    assert.throws(
      () => appendAttemptRecord([first, corruptedSecond], recovery),
      /corrupted history: retryOfAttemptNumber/,
    );
  });

  it("rejects sequence gaps already present in the supplied history", () => {
    const first: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "INVALID_TRACE",
      state: "INFRA_RETRYING",
      cause: "TRACE_COMPLETENESS",
      retryPolicyProvenance: provenance("trace.truncated"),
      reasonCodes: ["trace.truncated"],
      retryOfAttemptNumber: null,
    };
    const corruptedThird: AttemptEvaluationRecord = {
      ...first,
      attemptNumber: 3,
      retryOfAttemptNumber: 1,
    };
    const recovery: AttemptEvaluationRecord = {
      attemptNumber: 4,
      observedState: "PASSED",
      state: "PASSED",
      cause: "NONE",
      retryPolicyProvenance: provenance("evaluation.passed"),
      reasonCodes: [],
      retryOfAttemptNumber: 3,
    };

    assert.throws(
      () => appendAttemptRecord([first, corruptedThird], recovery),
      /corrupted history: attemptNumber must be contiguous/,
    );
  });

  it("rejects a permission-denied record forged as TRANSIENT_TOOL", () => {
    const forged: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "INVALID_TRACE",
      state: "INFRA_RETRYING",
      cause: "TRANSIENT_TOOL",
      retryPolicyProvenance: provenance("tool.billing.permission-denied", [
        "tool.billing.permission-denied",
      ]),
      reasonCodes: ["tool.billing.permission-denied"],
      retryOfAttemptNumber: null,
    };

    assert.throws(
      () => appendAttemptRecord([], forged),
      /inconsistent retry policy provenance/,
    );
  });

  it("returns a deeply immutable decision with a snapshotted policy", () => {
    const declaredReasons = ["tool.billing.rate-limited"];
    const decision = decideAutomaticRetry({
      observedState: "INVALID_TRACE",
      reasonCode: "tool.billing.rate-limited",
      declaredTransientToolReasonCodes: declaredReasons,
      attemptNumber: 1,
      maxAttempts: 2,
    });
    declaredReasons.push("tool.billing.server-error");

    assert.deepEqual(
      decision.retryPolicyProvenance.declaredTransientToolReasonCodes,
      ["tool.billing.rate-limited"],
    );
    assert.ok(Object.isFrozen(decision));
    assert.ok(Object.isFrozen(decision.retryPolicyProvenance));
    assert.ok(
      Object.isFrozen(
        decision.retryPolicyProvenance.declaredTransientToolReasonCodes,
      ),
    );
    assert.throws(
      () =>
        (decision as unknown as { state: string }).state = "PASSED",
      TypeError,
    );

    if (false) {
      // @ts-expect-error retry decisions are recursively readonly
      decision.state = "PASSED";
      // @ts-expect-error nested provenance is readonly
      decision.retryPolicyProvenance.reasonCode = "forged.reason";
      // @ts-expect-error nested provenance arrays are readonly
      decision.retryPolicyProvenance.declaredTransientToolReasonCodes.push(
        "tool.billing.server-error",
      );
    }
  });

  it("exposes appended history and all records as recursively readonly", () => {
    const first: AttemptEvaluationRecord = {
      attemptNumber: 1,
      observedState: "INVALID_TRACE",
      state: "INFRA_RETRYING",
      cause: "TRACE_COMPLETENESS",
      retryPolicyProvenance: provenance("trace.truncated"),
      reasonCodes: ["trace.truncated"],
      retryOfAttemptNumber: null,
    };
    const history = appendAttemptRecord([], first);

    if (false) {
      // @ts-expect-error attempt history is readonly
      history.push(first);
      // @ts-expect-error attempt records are readonly
      history[0].state = "PASSED";
      // @ts-expect-error record reason arrays are readonly
      history[0].reasonCodes.push("forged.reason");
      // @ts-expect-error record provenance is recursively readonly
      history[0].retryPolicyProvenance.reasonCode = "forged.reason";
    }

    assert.ok(Object.isFrozen(history));
    assert.ok(Object.isFrozen(history[0]));
    assert.ok(Object.isFrozen(history[0].retryPolicyProvenance));
  });
});
