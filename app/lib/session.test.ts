import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "./session.ts";

const session = {
  role: "AI Engineer",
  questions: ["q1"],
  answers: [],
  scores: [],
};

test("parse accepts a well-formed session", () => {
  assert.deepEqual(parse(JSON.stringify(session)), session);
});

test("parse treats absent or unparseable storage as no session", () => {
  assert.equal(parse(null), null);
  assert.equal(parse(""), null);
  assert.equal(parse("not json"), null);
  assert.equal(parse("null"), null);
});

test("parse rejects a session missing the arrays the pages index into", () => {
  // Without this the pages throw on `.length` instead of redirecting home.
  assert.equal(parse(JSON.stringify({ ...session, answers: undefined })), null);
  assert.equal(parse(JSON.stringify({ ...session, scores: "nope" })), null);
  assert.equal(parse(JSON.stringify({})), null);
});

test("parse rejects an unknown role", () => {
  assert.equal(parse(JSON.stringify({ ...session, role: "Chef" })), null);
});
