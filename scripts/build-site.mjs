import { cp, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIELDS, SOURCE, mergeRecords, toRow } from "../lib/merge.js";
import { fromAwesome, fromDsh, fromMarket, fromWorkshop } from "../lib/sources.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(root, "data", "raw");
const dataDir = path.join(root, "public", "data");
const SHARD = 2000;

const SOURCES = [
  {
    file: "dshso.json",
    url: "https://cdn.dsh.so/plugins-index.json",
  },
  {
    file: "awesome.json",
    url: "https://awesome-dsh-plugin.com/plugins.json",
  },
  {
    file: "market.json",
    url: "https://dshmarket.com/index.json",
  },
  {
    file: "workshop.json",
    url: "https://dsh-plugin.github.io/data/plugins.json",
  },
];

const sourceMeta = {};

async function noteSource(name, response) {
  sourceMeta[name] = {
    etag: response.headers.get("etag"),
    bytes: Number(response.headers.get("content-length") || 0) || null,
    modified: response.headers.get("last-modified"),
  };
}

async function loadRaw(name) {
  const file = path.join(rawDir, name);
  const source = SOURCES.find((item) => item.file === name);
  const refresh = process.argv.includes("--refresh");
  try {
    const text = await readFile(file, "utf8");
    if (text.length > 1000 && !refresh) {
      const head = await fetch(source.url, { method: "HEAD", headers: { "user-agent": "dsh-plugins-builder" } });
      if (head.ok) await noteSource(name, head);
      return JSON.parse(text);
    }
  } catch {
    // fetch below
  }
  console.log("fetch", source.url);
  const response = await fetch(source.url, { headers: { "user-agent": "dsh-plugins-builder" } });
  if (!response.ok) throw new Error(`${source.url} ${response.status}`);
  await noteSource(name, response);
  const text = await response.text();
  await mkdir(rawDir, { recursive: true });
  await writeFile(file, text);
  return JSON.parse(text);
}

function countBits(records) {
  const names = Object.keys(SOURCE);
  const withBit = Object.fromEntries(names.map((name) => [name, 0]));
  for (const record of records) {
    for (const name of names) {
      if (record.src & SOURCE[name]) withBit[name] += 1;
    }
  }
  const only = {
    dshso: records.filter((record) => record.src === SOURCE.dshso).length,
    market: records.filter((record) => record.src === SOURCE.market).length,
    awesome: records.filter((record) => (record.src & ~SOURCE.market) === SOURCE.awesome).length,
    snapshot: records.filter((record) => (record.src & ~(SOURCE.topic | SOURCE.workshop)) === 0 && (record.src & SOURCE.topic)).length,
  };
  return { withBit, only };
}

const dsh = await loadRaw("dshso.json");
const awesome = await loadRaw("awesome.json");
const market = await loadRaw("market.json");
const workshop = await loadRaw("workshop.json");

const records = [];
for (const plugin of dsh.plugins || []) records.push(fromDsh(plugin));
for (const plugin of awesome.plugins || []) records.push(fromAwesome(plugin));
for (const plugin of market.plugins || []) records.push(fromMarket(plugin));
for (const plugin of workshop.plugins || []) {
  const record = fromWorkshop(plugin);
  if (record) records.push(record);
}

const merged = mergeRecords(records);
const rows = merged.map(toRow);
const { withBit, only } = countBits(merged);
const categories = new Map();
const levels = [0, 0, 0, 0, 0, 0];
const risks = [0, 0, 0, 0, 0, 0];
const health = { ok: 0, deleted: 0, renamed: 0, merged: 0, topicRemoved: 0 };
const healthKey = ["ok", "deleted", "renamed", "merged", "topicRemoved"];
for (const record of merged) {
  categories.set(record.cat, (categories.get(record.cat) || 0) + 1);
  levels[record.level] += 1;
  risks[record.risk] += 1;
  health[healthKey[record.health] || "ok"] += 1;
}

await mkdir(dataDir, { recursive: true });
for (const name of await readdir(dataDir)) {
  if (name.endsWith(".json")) await unlink(path.join(dataDir, name));
}

const shards = [];
for (let index = 0; index < rows.length; index += SHARD) {
  const name = `shard-${String(shards.length).padStart(2, "0")}.json`;
  shards.push(`data/${name}`);
  await writeFile(path.join(dataDir, name), JSON.stringify(rows.slice(index, index + SHARD)));
}

const manifest = {
  builtAt: new Date().toISOString(),
  total: merged.length,
  fields: FIELDS,
  shards,
  featured: merged.filter((record) => record.health !== 1 && record.desc && record.name).slice(0, 8).map(toRow),
  categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
  levels,
  risks,
  health,
  input: {
    topic: workshop.plugins?.length || 0,
    market: market.plugins?.length || 0,
    awesome: awesome.plugins?.length || 0,
    workshop: workshop.plugins?.length || 0,
    dshso: dsh.plugins?.length || 0,
  },
  withBit,
  only,
  upstream: {
    dshso: {
      etag: sourceMeta["dshso.json"]?.etag || null,
      bytes: sourceMeta["dshso.json"]?.bytes || null,
      modified: sourceMeta["dshso.json"]?.modified || null,
      generatedAt: dsh.generatedAt || dsh.generated || null,
      license: "CC-BY-4.0",
      attribution: dsh.license?.attribution || "dsh.so — DSH Developer Hub (https://www.dsh.so)",
      docs: dsh.docs || "https://www.dsh.so/zh/data/",
      source: dsh.source || "https://www.dsh.so/zh/artifacts/",
    },
    awesome: {
      etag: sourceMeta["awesome.json"]?.etag || null,
      bytes: sourceMeta["awesome.json"]?.bytes || null,
      modified: sourceMeta["awesome.json"]?.modified || null,
      updated: awesome.updated || null,
      license: "CC0-1.0",
      url: awesome.url || "https://awesome-dsh-plugin.com/",
      source: awesome.source || "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin",
    },
    market: {
      etag: sourceMeta["market.json"]?.etag || null,
      bytes: sourceMeta["market.json"]?.bytes || null,
      modified: sourceMeta["market.json"]?.modified || null,
      format: market.format || 1,
      url: "https://dshmarket.com/",
    },
    workshop: {
      etag: sourceMeta["workshop.json"]?.etag || null,
      bytes: sourceMeta["workshop.json"]?.bytes || null,
      modified: sourceMeta["workshop.json"]?.modified || null,
      fetchedAt: workshop.fetched_at || null,
      total: workshop.total || workshop.plugins?.length || 0,
      source: workshop.source || "https://github.com/topics/dsh-plugin",
      url: "https://dsh-plugin.github.io/",
    },
    topic: {
      retrieved: workshop.plugins?.length || 0,
      cap: 1000,
      url: "https://github.com/topics/dsh-plugin",
    },
  },
};

await writeFile(path.join(dataDir, "manifest.json"), JSON.stringify(manifest, null, 2));
const icons = {};
for (const record of merged) {
  if (record.icon) icons[record.id] = record.icon;
}
await writeFile(path.join(dataDir, "icons.json"), JSON.stringify(icons));
const engineDir = path.join(root, "public", "engine");
await mkdir(engineDir, { recursive: true });
await cp(path.join(root, "lib", "merge.js"), path.join(engineDir, "merge.js"));
await cp(path.join(root, "lib", "sources.js"), path.join(engineDir, "sources.js"));
console.log(JSON.stringify({
  raw: records.length,
  unique: merged.length,
  shards: shards.length,
  withBit,
  only,
  deleted: health.deleted,
}, null, 2));
