import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_MODELS } from "./models.ts";
import { DEFAULT_SETTINGS, parse } from "./settings.ts";

test("parse accepts a stored setting", () => {
  const stored = { model: FREE_MODELS[1], source: "cache" };
  assert.deepEqual(parse(JSON.stringify(stored)), stored);
});

test("parse falls back to the defaults on absent or unparseable storage", () => {
  assert.deepEqual(parse(null), DEFAULT_SETTINGS);
  assert.deepEqual(parse("not json"), DEFAULT_SETTINGS);
  assert.deepEqual(parse("null"), DEFAULT_SETTINGS);
  assert.deepEqual(parse("{}"), DEFAULT_SETTINGS);
});

test("parse drops a model the fallback chain does not know", () => {
  // localStorage is hand-editable and this value is sent on to OpenRouter.
  assert.equal(parse(JSON.stringify({ model: "openai/gpt-9:paid" })).model, null);
});

test("parse drops an unknown source rather than generating nothing", () => {
  assert.equal(parse(JSON.stringify({ source: "ground-truth" })).source, DEFAULT_SETTINGS.source);
});
