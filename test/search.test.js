import assert from "node:assert/strict";
import test from "node:test";
import { catLabel, catalogListKey, filterPlugins } from "../public/catalog.js";

function row(name, extra = {}) {
  const plugin = {
    name,
    desc: extra.desc || "",
    repo: extra.repo || "",
    npm: extra.npm || "",
    stars: extra.stars || 0,
    cat: extra.cat || "other",
    src: 1,
    level: 0,
    downloads: 0,
    id: name,
  };
  plugin.q = [plugin.name, plugin.desc, plugin.repo, plugin.npm, plugin.id, catLabel(plugin.cat)].join("\n").toLowerCase();
  return plugin;
}

test("search ranks the name match ahead of a popular description match", () => {
  const items = [
    row("unrelated-huge", { desc: "archify is mentioned here", stars: 900000 }),
    row("archify", { desc: "diagrams", stars: 10, repo: "tt-a1i/archify" }),
  ];
  const found = filterPlugins(items, { q: "archify" });
  assert.equal(found[0].name, "archify");
});

test("search still finds the repository when the name differs", () => {
  const items = [row("Hindsight", { repo: "vectorize-io/hindsight", stars: 5 })];
  const found = filterPlugins(items, { q: "vectorize-io/hindsight" });
  assert.equal(found.length, 1);
});

test("search requires every word", () => {
  const items = [
    row("archify", { desc: "diagrams for systems", stars: 3, repo: "tt-a1i/archify" }),
    row("diagrams-only", { desc: "diagrams", stars: 999 }),
    row("archify-notes", { desc: "notes", stars: 50 }),
  ];
  const found = filterPlugins(items, { q: "archify diagrams" });
  assert.deepEqual(found.map((item) => item.name), ["archify"]);
});

test("search can find a plugin by its category", () => {
  const items = [
    row("alpha", { stars: 1, cat: "finance" }),
    row("beta", { stars: 100, cat: "game" }),
  ];
  const found = filterPlugins(items, { q: "金融" });
  assert.deepEqual(found.map((item) => item.name), ["alpha"]);
});

test("list key ignores the open plugin and default sort", () => {
  const open = new URLSearchParams("q=archify&sort=stars&page=1&id=r~a~b");
  const plain = new URLSearchParams("q=archify");
  assert.equal(catalogListKey(open), catalogListKey(plain));
});
