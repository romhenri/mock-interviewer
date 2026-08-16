import assert from "node:assert/strict";
import { test } from "node:test";
import { averageScores, isScore, parseScore } from "./score.ts";

const valid = {
  correctness: 80,
  english: 60,
  depth: 40,
  feedback: {
    correctness: "Named the right mechanism.",
    english: "You said 'devluper'; the word is 'developer'.",
    depth: "Did not say why it matters under load.",
  },
  suggestedAnswer: "A reverse proxy terminates client connections on behalf of backend servers.",
};

test("parseScore accepts a well-formed judge response", () => {
  assert.deepEqual(parseScore(valid), valid);
});

test("parseScore rejects out-of-range scores rather than clamping them", () => {
  assert.throws(() => parseScore({ ...valid, correctness: 101 }), /correctness/);
  assert.throws(() => parseScore({ ...valid, english: -1 }), /english/);
});

test("parseScore rejects missing or non-numeric criteria", () => {
  assert.throws(() => parseScore({ ...valid, depth: "high" }), /depth/);
  assert.throws(() => parseScore({ correctness: 1, english: 1, depth: 1 }), /feedback/);
  // Feedback is per criterion: a missing line is as invalid as a missing score.
  assert.throws(
    () => parseScore({ ...valid, feedback: { ...valid.feedback, english: "" } }),
    /english feedback/,
  );
  assert.throws(() => parseScore(null), /score object/);
});

test("parseScore requires a suggested answer when the judge had no reference", () => {
  assert.throws(() => parseScore({ ...valid, suggestedAnswer: "" }), /suggested answer/);
  assert.throws(() => parseScore({ ...valid, suggestedAnswer: undefined }), /suggested answer/);
});

test("parseScore shows the reference answer the judge scored against", () => {
  // With a reference the judge is not asked to write one, so the field is absent.
  const withReference = { ...valid, suggestedAnswer: undefined };
  const reference = "It terminates client connections on behalf of the backends.";
  assert.deepEqual(parseScore(withReference, reference), { ...valid, suggestedAnswer: reference });
});

test("averageScores means each criterion independently", () => {
  const scores = [valid, { ...valid, correctness: 100, english: 100, depth: 100 }];
  assert.deepEqual(averageScores(scores), { correctness: 90, english: 80, depth: 70 });
});

test("averageScores does not divide by zero on an empty interview", () => {
  assert.deepEqual(averageScores([]), { correctness: 0, english: 0, depth: 0 });
});

test("averageScores ignores skipped questions instead of scoring them zero", () => {
  const perfect = { ...valid, correctness: 100, english: 100, depth: 100 };
  // One answered, two skipped: the average is the answered one, not a third of it.
  assert.deepEqual(averageScores([null, perfect, null]), {
    correctness: 100,
    english: 100,
    depth: 100,
  });
});

test("averageScores ignores answers whose scoring failed", () => {
  // A network error must not read as a zero-scoring answer.
  const perfect = { ...valid, correctness: 100, english: 100, depth: 100 };
  assert.deepEqual(averageScores([{ error: "OpenRouter returned 429" }, perfect]), {
    correctness: 100,
    english: 100,
    depth: 100,
  });
});

test("averageScores returns zeroes when every question was skipped", () => {
  assert.deepEqual(averageScores([null, null]), { correctness: 0, english: 0, depth: 0 });
});

test("isScore separates real scores from skipped, pending and failed slots", () => {
  assert.equal(isScore(valid), true);
  assert.equal(isScore(null), false);
  assert.equal(isScore({ error: "timed out" }), false);
});
