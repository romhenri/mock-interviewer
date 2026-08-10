import assert from "node:assert/strict";
import { test } from "node:test";
import { averageScores, parseScore } from "./score.ts";

const valid = { correctness: 80, clarity: 60, depth: 40, feedback: "Solid." };

test("parseScore accepts a well-formed judge response", () => {
  assert.deepEqual(parseScore(valid), valid);
});

test("parseScore rejects out-of-range scores rather than clamping them", () => {
  assert.throws(() => parseScore({ ...valid, correctness: 101 }), /correctness/);
  assert.throws(() => parseScore({ ...valid, clarity: -1 }), /clarity/);
});

test("parseScore rejects missing or non-numeric criteria", () => {
  assert.throws(() => parseScore({ ...valid, depth: "high" }), /depth/);
  assert.throws(() => parseScore({ correctness: 1, clarity: 1, depth: 1 }), /feedback/);
  assert.throws(() => parseScore(null), /score object/);
});

test("averageScores means each criterion independently", () => {
  const scores = [valid, { correctness: 100, clarity: 100, depth: 100, feedback: "x" }];
  assert.deepEqual(averageScores(scores), { correctness: 90, clarity: 80, depth: 70 });
});

test("averageScores does not divide by zero on an empty interview", () => {
  assert.deepEqual(averageScores([]), { correctness: 0, clarity: 0, depth: 0 });
});

test("averageScores ignores skipped questions instead of scoring them zero", () => {
  const perfect = { correctness: 100, clarity: 100, depth: 100, feedback: "x" };
  // One answered, two skipped: the average is the answered one, not a third of it.
  assert.deepEqual(averageScores([null, perfect, null]), {
    correctness: 100,
    clarity: 100,
    depth: 100,
  });
});

test("averageScores returns zeroes when every question was skipped", () => {
  assert.deepEqual(averageScores([null, null]), { correctness: 0, clarity: 0, depth: 0 });
});
