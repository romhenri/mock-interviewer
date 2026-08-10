import assert from "node:assert/strict";
import { test } from "node:test";
import { pickQuestions, topicOf, type Bookmark } from "./bookmarks.ts";

const saved = (question: string): Bookmark => ({
  question,
  role: "Software Engineer",
  topic: topicOf(question),
});

/** Feeds pickQuestions a scripted sequence so the outcome is deterministic. */
function scripted(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 1;
}

test("topicOf reads the generator's label prefix", () => {
  assert.equal(topicOf("Caching: what is a cache stampede?"), "Caching");
  assert.equal(topicOf("Reverse Proxy: what does it do?"), "Reverse Proxy");
});

test("topicOf ignores a colon that is punctuation rather than a label", () => {
  const prose = "Explain what happens when a cache key expires and many requests: all miss at once";
  assert.equal(topicOf(prose), "General");
  assert.equal(topicOf("no colon here"), "General");
});

test("pickQuestions returns the generated set untouched when chance is zero", () => {
  const generated = ["q1", "q2", "q3"];
  assert.deepEqual(pickQuestions(generated, [saved("old")], 0, scripted([0, 0, 0])), generated);
});

test("pickQuestions substitutes a saved question when the draw succeeds", () => {
  // First draw 0.1 < chance so it swaps; second draw 0 selects the first candidate.
  const result = pickQuestions(["q1", "q2"], [saved("old")], 0.5, scripted([0.1, 0, 0.9]));
  assert.deepEqual(result, ["old", "q2"]);
});

test("pickQuestions never repeats the same saved question twice", () => {
  // Every draw wants a swap, but only one bookmark exists.
  const result = pickQuestions(["q1", "q2"], [saved("old")], 1, scripted([0, 0, 0, 0]));
  assert.deepEqual(result, ["old", "q2"]);
});

test("pickQuestions will not reuse a question already generated this round", () => {
  // "q1" is both generated and bookmarked — swapping it in would duplicate it.
  const result = pickQuestions(["q1", "q2"], [saved("q1")], 1, scripted([0, 0, 0, 0]));
  assert.deepEqual(result, ["q1", "q2"]);
});

test("pickQuestions leaves the set alone when there is nothing saved", () => {
  assert.deepEqual(pickQuestions(["q1", "q2"], [], 1, scripted([0, 0])), ["q1", "q2"]);
});
