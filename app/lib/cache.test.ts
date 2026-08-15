import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCache, pickCached, topicOf, type CachedQuestion } from "./cache.ts";

const saved = (question: string, suggestedAnswer?: string): CachedQuestion => ({
  question,
  role: "Software Engineer",
  topic: topicOf(question),
  suggestedAnswer,
});

/** Feeds pickCached a scripted sequence so the draw is deterministic. */
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

test("pickCached draws the asked-for count without repeating a question", () => {
  const cached = [saved("q1", "a1"), saved("q2", "a2"), saved("q3", "a3")];
  // Always drawing index 0 would repeat q1 if the pool were not consumed.
  assert.deepEqual(pickCached(cached, 2, scripted([0, 0])), [
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

test("mergeCache keeps every generated question, with its answer", () => {
  const merged = mergeCache([], [{ question: "Caching: what is a stampede?", answer: "a1" }], "DevOps");
  assert.deepEqual(merged, [
    {
      question: "Caching: what is a stampede?",
      role: "DevOps",
      topic: "Caching",
      suggestedAnswer: "a1",
    },
  ]);
});

test("mergeCache does not re-add a question already cached", () => {
  // A question discarded on the summary stays gone until it is generated again,
  // but one still cached must not be duplicated when it comes back.
  const current = [saved("q1", "a1")];
  assert.deepEqual(mergeCache(current, [{ question: "q1", answer: "a1" }], "Software Engineer"), current);
});
