import type {
  AttemptObservedState,
  BClassEvaluationState,
} from "./evaluation-status.ts";

export const OBSERVABLE_SKILL_EVIDENCE = [
  "skill_file_read",
  "reference_file_read",
  "tool_order",
  "pagination",
  "artifact_created",
  "retry_behavior",
  "final_output_structure",
] as const;

export type ObservableSkillEvidenceKind =
  (typeof OBSERVABLE_SKILL_EVIDENCE)[number];
export type JsonScalar = string | number | boolean | null;
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
export type AssertionOutcome =
  | "pass"
  | "fail"
  | "not_applicable";

export interface EventMatcher {
  eventType: string;
  attributes?: Readonly<Record<string, JsonScalar>>;
}

export type SerializableRubricExpectation =
  | { kind: "event_present"; event: EventMatcher }
  | { kind: "count_at_least"; event: EventMatcher; minimum: number }
  | {
      kind: "ordered_events";
      before: EventMatcher;
      after: EventMatcher;
    };

/** A rubric is data, not executable code, and contains no caller-supplied result. */
export interface SkillRubricAssertion {
  id: string;
  tier: "A";
  observable: ObservableSkillEvidenceKind;
  explanation: string;
  expectation: SerializableRubricExpectation;
  applicable?: boolean;
}

export interface ValidatedPayloadIndexEntry {
  reference: string;
  digest: string;
}

export interface ValidatedObservableEvent {
  sequence: number;
  eventType: string;
  observable: ObservableSkillEvidenceKind;
  payloadReference: string;
  payloadDigest: string;
  attributes: Readonly<Record<string, JsonScalar>>;
}

export interface ValidatedSearchWindow {
  startSequence: number;
  endSequence: number;
  eventType: string;
  payloadReference: string;
  payloadDigest: string;
}

/** Pure, serializable projection built only after native bundle validation. */
export interface ValidatedObservableEvidenceIndex {
  payloads: readonly ValidatedPayloadIndexEntry[];
  events: readonly ValidatedObservableEvent[];
  searchWindow: ValidatedSearchWindow;
}

export interface SkillEvaluationEvidence {
  bundleId: string;
  /** Runner-bound provenance. Native bundle content cannot self-assert this field. */
  sourceTrust: "diagnostic_full_access" | "runtime_isolated";
  valid: boolean;
  completeness: "incomplete" | "turn_complete" | "rollout_complete";
  /** False for unknown event types or any other evidence the evaluator cannot score safely. */
  hardScoreEligible: boolean;
  reasonCodes: readonly string[];
  index: ValidatedObservableEvidenceIndex;
}

export type BClassAssessment =
  | { kind: "unscored" }
  | {
      kind: "scored";
      oracleId: string;
      score: number;
      passed: boolean;
    };

export interface CodexSkillEvaluationInput {
  evidence: SkillEvaluationEvidence;
  /** Untrusted boundary input; validated before any assertion field is read. */
  rubric: unknown;
  bClassAssessment: BClassAssessment;
  cancelled?: boolean;
}

interface SequenceIntervalShape {
  start: number;
  end: number;
}
export type SequenceInterval = DeepReadonly<SequenceIntervalShape>;

/** Locator values are copied from the validated event/payload index, never from the rubric. */
interface EvidenceLocatorShape {
  bundleId: string;
  sequence: number | SequenceInterval;
  eventType: string;
  payloadDigest: string;
  payloadReference: string;
}
export type EvidenceLocator = DeepReadonly<EvidenceLocatorShape>;

interface EvaluatedSkillAssertionShape extends SkillRubricAssertion {
  outcome: AssertionOutcome;
  evidence: readonly EvidenceLocator[];
}
export type EvaluatedSkillAssertion =
  DeepReadonly<EvaluatedSkillAssertionShape>;

type BClassResultShape =
  | {
      state: BClassEvaluationState;
      reasonCode: "b.oracle-not-configured" | "b.invalid-assessment";
    }
  | {
      scored: true;
      outcome: "pass" | "fail";
      oracleId: string;
      score: number;
    };
export type BClassResult = DeepReadonly<BClassResultShape>;

interface CodexSkillEvaluationResultShape {
  state: AttemptObservedState;
  hardGate: {
    state: AttemptObservedState;
    failedAssertionIds: readonly string[];
  };
  bClass: BClassResult;
  assertions: readonly EvaluatedSkillAssertion[];
  reasonCodes: readonly string[];
}
export type CodexSkillEvaluationResult =
  DeepReadonly<CodexSkillEvaluationResultShape>;

const ASSERTION_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OBSERVABLE_SET: ReadonlySet<string> = new Set(
  OBSERVABLE_SKILL_EVIDENCE,
);
const MAX_RUBRIC_ASSERTIONS = 256;
const MAX_MATCHER_ATTRIBUTES = 64;
const MAX_MATCHER_ATTRIBUTE_BYTES = 16_384;
const ASSERTION_KEYS = new Set([
  "id",
  "tier",
  "observable",
  "explanation",
  "expectation",
  "applicable",
]);
const EVENT_MATCHER_KEYS = new Set(["eventType", "attributes"]);
const EVENT_PRESENT_EXPECTATION_KEYS = new Set(["kind", "event"]);
const COUNT_EXPECTATION_KEYS = new Set(["kind", "event", "minimum"]);
const ORDERED_EXPECTATION_KEYS = new Set(["kind", "before", "after"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

function isJsonScalar(value: unknown): value is JsonScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowed.has(key),
  );
}

function isAttributeRecord(value: unknown): value is Record<string, JsonScalar> {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_MATCHER_ATTRIBUTES) return false;

  let utf8Bytes = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !isBoundedString(key, 256)) return false;
    const attribute = value[key];
    if (!isJsonScalar(attribute)) return false;
    utf8Bytes += Buffer.byteLength(key, "utf8");
    utf8Bytes += Buffer.byteLength(JSON.stringify(attribute), "utf8");
    if (utf8Bytes > MAX_MATCHER_ATTRIBUTE_BYTES) return false;
  }
  return true;
}

function isEventMatcher(value: unknown): value is EventMatcher {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, EVENT_MATCHER_KEYS) ||
    !isBoundedString(value.eventType, 256)
  ) {
    return false;
  }
  return value.attributes === undefined || isAttributeRecord(value.attributes);
}

function isExpectation(value: unknown): value is SerializableRubricExpectation {
  if (!isRecord(value)) return false;
  if (value.kind === "event_present") {
    return (
      hasOnlyKeys(value, EVENT_PRESENT_EXPECTATION_KEYS) &&
      isEventMatcher(value.event)
    );
  }
  if (value.kind === "count_at_least") {
    return (
      hasOnlyKeys(value, COUNT_EXPECTATION_KEYS) &&
      isEventMatcher(value.event) &&
      isPositiveSequence(value.minimum)
    );
  }
  if (value.kind === "ordered_events") {
    return (
      hasOnlyKeys(value, ORDERED_EXPECTATION_KEYS) &&
      isEventMatcher(value.before) &&
      isEventMatcher(value.after)
    );
  }
  return false;
}

type RubricValidation =
  | { valid: true; rubric: readonly SkillRubricAssertion[]; reasonCodes: [] }
  | { valid: false; rubric: readonly []; reasonCodes: readonly string[] };

function validateRubric(value: unknown): RubricValidation {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    return {
      valid: false,
      rubric: [],
      reasonCodes: ["evaluator.invalid-assertion"],
    };
  }
  if (value.length > MAX_RUBRIC_ASSERTIONS) {
    return {
      valid: false,
      rubric: [],
      reasonCodes: ["evaluator.rubric-limit-exceeded"],
    };
  }

  try {
    const reasons: string[] = [];
    const ids = new Set<string>();

    for (const assertion of value) {
      if (!hasOnlyKeys(assertion, ASSERTION_KEYS)) {
        reasons.push("evaluator.invalid-assertion");
        continue;
      }
      if (
        typeof assertion.id !== "string" ||
        !ASSERTION_ID_RE.test(assertion.id)
      ) {
        reasons.push("evaluator.invalid-assertion-id");
      } else if (ids.has(assertion.id)) {
        reasons.push("evaluator.duplicate-assertion-id");
      }
      if (typeof assertion.id === "string") ids.add(assertion.id);
      if (assertion.tier !== "A") reasons.push("evaluator.unsupported-tier");
      if (
        typeof assertion.observable !== "string" ||
        !OBSERVABLE_SET.has(assertion.observable)
      ) {
        reasons.push("evaluator.unsupported-observable");
      }
      if (!isBoundedString(assertion.explanation, 2_000)) {
        reasons.push("evaluator.invalid-assertion-explanation");
      }
      if (!isExpectation(assertion.expectation)) {
        reasons.push("evaluator.invalid-expectation");
      }
      if (
        assertion.applicable !== undefined &&
        typeof assertion.applicable !== "boolean"
      ) {
        reasons.push("evaluator.invalid-applicability");
      }
    }
    const reasonCodes = [...new Set(reasons)];
    if (reasonCodes.length > 0) {
      return { valid: false, rubric: [], reasonCodes };
    }
    return {
      valid: true,
      rubric: value as unknown as readonly SkillRubricAssertion[],
      reasonCodes: [],
    };
  } catch {
    return {
      valid: false,
      rubric: [],
      reasonCodes: ["evaluator.invalid-assertion"],
    };
  }
}

function pairMatchesPayloadIndex(
  reference: unknown,
  digest: unknown,
  payloads: ReadonlyMap<string, string>,
): boolean {
  return (
    isBoundedString(reference, 1_024) &&
    isBoundedString(digest, 512) &&
    payloads.get(reference) === digest
  );
}

function isValidEvidenceIndex(index: ValidatedObservableEvidenceIndex): boolean {
  if (
    !isRecord(index) ||
    !Array.isArray(index.payloads) ||
    !Array.isArray(index.events) ||
    !isRecord(index.searchWindow)
  ) {
    return false;
  }

  const payloads = new Map<string, string>();
  for (const payload of index.payloads) {
    if (
      !isRecord(payload) ||
      !isBoundedString(payload.reference, 1_024) ||
      !isBoundedString(payload.digest, 512) ||
      payloads.has(payload.reference)
    ) {
      return false;
    }
    payloads.set(payload.reference, payload.digest);
  }

  const window = index.searchWindow;
  if (
    !isPositiveSequence(window.startSequence) ||
    !isPositiveSequence(window.endSequence) ||
    window.startSequence > window.endSequence ||
    !isBoundedString(window.eventType, 256) ||
    !pairMatchesPayloadIndex(
      window.payloadReference,
      window.payloadDigest,
      payloads,
    )
  ) {
    return false;
  }

  let previousSequence = 0;
  for (const event of index.events) {
    if (
      !isRecord(event) ||
      !isPositiveSequence(event.sequence) ||
      event.sequence <= previousSequence ||
      event.sequence < window.startSequence ||
      event.sequence > window.endSequence ||
      !isBoundedString(event.eventType, 256) ||
      typeof event.observable !== "string" ||
      !OBSERVABLE_SET.has(event.observable) ||
      !isAttributeRecord(event.attributes) ||
      !pairMatchesPayloadIndex(
        event.payloadReference,
        event.payloadDigest,
        payloads,
      )
    ) {
      return false;
    }
    previousSequence = event.sequence;
  }
  return true;
}

function bClassResult(assessment: BClassAssessment): BClassResult {
  if (assessment.kind === "unscored") {
    return {
      state: "B_UNSCORED",
      reasonCode: "b.oracle-not-configured",
    };
  }
  if (
    !isBoundedString(assessment.oracleId, 256) ||
    !Number.isFinite(assessment.score) ||
    assessment.score < 0 ||
    assessment.score > 1 ||
    typeof assessment.passed !== "boolean"
  ) {
    return { state: "B_UNSCORED", reasonCode: "b.invalid-assessment" };
  }
  return {
    scored: true,
    outcome: assessment.passed ? "pass" : "fail",
    oracleId: assessment.oracleId,
    score: assessment.score,
  };
}

function invalidResult(
  input: CodexSkillEvaluationInput,
  reasonCodes: readonly string[],
): CodexSkillEvaluationResult {
  return finalizedResult({
    state: "INVALID_TRACE",
    hardGate: { state: "INVALID_TRACE", failedAssertionIds: [] },
    bClass: bClassResult(input.bClassAssessment),
    assertions: [],
    reasonCodes,
  });
}

function deepCloneAndFreeze<T>(value: T, ancestors = new WeakSet<object>()): T {
  if (isRecord(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("cyclic audit result");
    }
    ancestors.add(value);
  }
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item) => deepCloneAndFreeze(item, ancestors)),
      ) as T;
    }
    if (isRecord(value)) {
      const clone = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          deepCloneAndFreeze(item, ancestors),
        ]),
      );
      return Object.freeze(clone) as T;
    }
    return value;
  } finally {
    if (isRecord(value)) ancestors.delete(value);
  }
}

function cloneFailureResult(): CodexSkillEvaluationResult {
  const failedAssertionIds = Object.freeze([]) as readonly string[];
  const assertions = Object.freeze([]) as readonly EvaluatedSkillAssertion[];
  const reasonCodes = Object.freeze([
    "evaluator.result-not-serializable",
  ]) as readonly string[];
  return Object.freeze({
    state: "INVALID_TRACE",
    hardGate: Object.freeze({ state: "INVALID_TRACE", failedAssertionIds }),
    bClass: Object.freeze({
      state: "B_UNSCORED",
      reasonCode: "b.invalid-assessment",
    }),
    assertions,
    reasonCodes,
  });
}

function finalizedResult(
  result: CodexSkillEvaluationResult,
): CodexSkillEvaluationResult {
  try {
    return deepCloneAndFreeze(result);
  } catch {
    return cloneFailureResult();
  }
}

function eventMatches(
  event: ValidatedObservableEvent,
  matcher: EventMatcher,
): boolean {
  if (event.eventType !== matcher.eventType) return false;
  return Object.entries(matcher.attributes ?? {}).every(
    ([key, expected]) => Object.is(event.attributes[key], expected),
  );
}

function locatorForEvent(
  bundleId: string,
  event: ValidatedObservableEvent,
): EvidenceLocator {
  return {
    bundleId,
    sequence: event.sequence,
    eventType: event.eventType,
    payloadDigest: event.payloadDigest,
    payloadReference: event.payloadReference,
  };
}

function locatorForWindow(
  bundleId: string,
  window: ValidatedSearchWindow,
): EvidenceLocator {
  return {
    bundleId,
    sequence: { start: window.startSequence, end: window.endSequence },
    eventType: window.eventType,
    payloadDigest: window.payloadDigest,
    payloadReference: window.payloadReference,
  };
}

function matchingEvents(
  index: ValidatedObservableEvidenceIndex,
  observable: ObservableSkillEvidenceKind,
  matcher: EventMatcher,
): ValidatedObservableEvent[] {
  return index.events.filter(
    (event) =>
      event.observable === observable && eventMatches(event, matcher),
  );
}

function evaluatedAssertion(
  assertion: SkillRubricAssertion,
  outcome: "pass" | "fail" | "not_applicable",
  evidence: readonly EvidenceLocator[],
): EvaluatedSkillAssertion {
  return {
    id: assertion.id,
    tier: assertion.tier,
    observable: assertion.observable,
    explanation: assertion.explanation,
    expectation: assertion.expectation,
    ...(assertion.applicable === undefined
      ? {}
      : { applicable: assertion.applicable }),
    outcome,
    evidence,
  };
}

function evaluateAssertion(
  assertion: SkillRubricAssertion,
  evidence: SkillEvaluationEvidence,
): EvaluatedSkillAssertion {
  if (assertion.applicable === false) {
    return evaluatedAssertion(assertion, "not_applicable", []);
  }

  const { expectation } = assertion;
  const window = locatorForWindow(
    evidence.bundleId,
    evidence.index.searchWindow,
  );
  if (expectation.kind === "event_present") {
    const matches = matchingEvents(
      evidence.index,
      assertion.observable,
      expectation.event,
    );
    return matches.length > 0
      ? evaluatedAssertion(assertion, "pass", [
          locatorForEvent(evidence.bundleId, matches[0]),
        ])
      : evaluatedAssertion(assertion, "fail", [window]);
  }

  if (expectation.kind === "count_at_least") {
    const matches = matchingEvents(
      evidence.index,
      assertion.observable,
      expectation.event,
    );
    if (matches.length >= expectation.minimum) {
      return evaluatedAssertion(
        assertion,
        "pass",
        matches
          .slice(0, expectation.minimum)
          .map((event) => locatorForEvent(evidence.bundleId, event)),
      );
    }
    return evaluatedAssertion(assertion, "fail", [
      ...matches.map((event) => locatorForEvent(evidence.bundleId, event)),
      window,
    ]);
  }

  const beforeEvents = matchingEvents(
    evidence.index,
    assertion.observable,
    expectation.before,
  );
  const afterEvents = matchingEvents(
    evidence.index,
    assertion.observable,
    expectation.after,
  );
  const earliestBefore = beforeEvents[0];
  if (earliestBefore) {
    let afterIndex = 0;
    while (
      afterIndex < afterEvents.length &&
      afterEvents[afterIndex].sequence <= earliestBefore.sequence
    ) {
      afterIndex += 1;
    }
    const orderedAfter = afterEvents[afterIndex];
    if (orderedAfter) {
      return evaluatedAssertion(assertion, "pass", [
        locatorForEvent(evidence.bundleId, earliestBefore),
        locatorForEvent(evidence.bundleId, orderedAfter),
      ]);
    }
  }

  let invertedAfter: ValidatedObservableEvent | undefined;
  if (earliestBefore) {
    for (let index = afterEvents.length - 1; index >= 0; index -= 1) {
      if (afterEvents[index].sequence !== earliestBefore.sequence) {
        invertedAfter = afterEvents[index];
        break;
      }
    }
  }
  if (earliestBefore && invertedAfter) {
    return evaluatedAssertion(assertion, "fail", [
      locatorForEvent(evidence.bundleId, earliestBefore),
      locatorForEvent(evidence.bundleId, invertedAfter),
    ]);
  }
  return evaluatedAssertion(assertion, "fail", [window]);
}

/** Derive observable A results from the validated index; never trust a prefilled outcome. */
export function evaluateCodexSkillCompliance(
  input: CodexSkillEvaluationInput,
): CodexSkillEvaluationResult {
  if (input.cancelled) {
    return finalizedResult({
      state: "CANCELLED",
      hardGate: { state: "CANCELLED", failedAssertionIds: [] },
      bClass: bClassResult(input.bClassAssessment),
      assertions: [],
      reasonCodes: ["run.cancelled"],
    });
  }
  if (input.evidence.sourceTrust !== "runtime_isolated") {
    return invalidResult(input, ["trace.writer-not-isolated"]);
  }
  if (!input.evidence.valid) {
    return invalidResult(
      input,
      input.evidence.reasonCodes.length > 0
        ? [...input.evidence.reasonCodes]
        : ["trace.invalid"],
    );
  }
  if (input.evidence.completeness !== "rollout_complete") {
    return invalidResult(
      input,
      input.evidence.reasonCodes.length > 0
        ? [...input.evidence.reasonCodes]
        : ["trace.rollout-incomplete"],
    );
  }
  if (!input.evidence.hardScoreEligible) {
    return invalidResult(
      input,
      input.evidence.reasonCodes.length > 0
        ? [...input.evidence.reasonCodes]
        : ["trace.hard-score-ineligible"],
    );
  }
  if (
    !isBoundedString(input.evidence.bundleId, 512) ||
    !isValidEvidenceIndex(input.evidence.index)
  ) {
    return invalidResult(input, ["evaluator.invalid-evidence-index"]);
  }

  const rubric = validateRubric(input.rubric);
  if (!rubric.valid) return invalidResult(input, rubric.reasonCodes);

  const assertions = rubric.rubric.map((assertion) =>
    evaluateAssertion(assertion, input.evidence),
  );
  const failedAssertionIds = assertions
    .filter(({ outcome }) => outcome === "fail")
    .map(({ id }) => id);
  const state =
    failedAssertionIds.length > 0 ? "BEHAVIOR_FAILED" : "PASSED";

  return finalizedResult({
    state,
    hardGate: { state, failedAssertionIds },
    bClass: bClassResult(input.bClassAssessment),
    assertions,
    reasonCodes: [],
  });
}
