import assert from "node:assert/strict";
import { test } from "node:test";
import { pickCached, pickQuestions, topicOf, type Bookmark } from "./bookmarks.ts";

const saved = (question: string, suggestedAnswer?: string): Bookmark => ({
  question,
  role: "Software Engineer",
  topic: topicOf(question),
  suggestedAnswer,
});

/** The generator's output shape: every question comes with its full-credit answer. */
const generated = (...questions: string[]) =>
  questions.map((question) => ({ question, answer: `${question} answer` }));

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
  const set = generated("q1", "q2", "q3");
  assert.deepEqual(pickQuestions(set, [saved("old", "a")], 0, scripted([0, 0, 0])), set);
});

test("pickQuestions substitutes a saved question, carrying its saved answer", () => {
  // First draw 0.1 < chance so it swaps; second draw 0 selects the first candidate.
  const set = generated("q1", "q2");
  const result = pickQuestions(set, [saved("old", "old answer")], 0.5, scripted([0.1, 0, 0.9]));
  assert.deepEqual(result, [{ question: "old", answer: "old answer" }, set[1]]);
});

test("pickQuestions substitutes a bookmark saved before answers existed", () => {
  // No answer to score against — the judge writes one instead of getting a bar.
  const set = generated("q1");
  const result = pickQuestions(set, [saved("old")], 1, scripted([0, 0]));
  assert.deepEqual(result, [{ question: "old", answer: undefined }]);
});

test("pickQuestions never repeats the same saved question twice", () => {
  // Every draw wants a swap, but only one bookmark exists.
  const set = generated("q1", "q2");
  const result = pickQuestions(set, [saved("old", "a")], 1, scripted([0, 0, 0, 0]));
  assert.deepEqual(result, [{ question: "old", answer: "a" }, set[1]]);
});

test("pickQuestions will not reuse a question already generated this round", () => {
  // "q1" is both generated and bookmarked — swapping it in would duplicate it.
  const set = generated("q1", "q2");
  assert.deepEqual(pickQuestions(set, [saved("q1", "a")], 1, scripted([0, 0, 0, 0])), set);
});

test("pickQuestions leaves the set alone when there is nothing saved", () => {
  const set = generated("q1", "q2");
  assert.deepEqual(pickQuestions(set, [], 1, scripted([0, 0])), set);
});

test("pickCached draws the asked-for count without repeating a question", () => {
  const bookmarks = [saved("q1", "a1"), saved("q2", "a2"), saved("q3", "a3")];
  // Always drawing index 0 would repeat q1 if the pool were not consumed.
  assert.deepEqual(pickCached(bookmarks, 2, scripted([0, 0])), [
    { question: "q1", answer: "a1" },
    { question: "q2", answer: "a2" },
  ]);
});

test("pickCached returns what it has when the cache is thin", () => {
  // The interview runs short rather than failing — no request is spent either way.
  assert.deepEqual(pickCached([saved("q1", "a1")], 3, scripted([0, 0, 0])), [
    { question: "q1", answer: "a1" },
  ]);
  assert.deepEqual(pickCached([], 3), []);
});
