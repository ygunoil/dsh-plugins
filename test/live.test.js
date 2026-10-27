import assert from "node:assert/strict";
import test from "node:test";
import { changedStamp } from "../public/live.js";

test("last-modified is the update signal the browser can read", () => {
  const local = { modified: "Mon, 26 Oct 2026 00:36:27 GMT", etag: "abc" };
  assert.equal(changedStamp(local, { modified: "Mon, 26 Oct 2026 00:36:27 GMT" }), false);
  assert.equal(changedStamp(local, { modified: "Tue, 27 Oct 2026 00:36:27 GMT" }), true);
});

test("etag is used when modification time is hidden", () => {
  assert.equal(changedStamp({ etag: 'W/"abc"' }, { etag: '"abc"' }), false);
  assert.equal(changedStamp({ etag: '"abc"' }, { etag: '"def"' }), true);
});

test("missing remote headers are not an update", () => {
  assert.equal(changedStamp({ etag: "abc", bytes: 10 }, {}), false);
  assert.equal(changedStamp(null, { modified: "Tue, 27 Oct 2026 00:36:27 GMT" }), false);
});

test("browser engine modules load", async () => {
  const merge = await import("../public/engine/merge.js");
  const sources = await import("../public/engine/sources.js");
  assert.equal(typeof merge.mergeRecords, "function");
  assert.equal(typeof sources.fromDsh, "function");
  assert.equal(typeof sources.fromAwesome, "function");
  assert.equal(typeof sources.fromMarket, "function");
  assert.equal(typeof sources.fromWorkshop, "function");
});
