import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { FIELDS as mergeFields, SOURCE, mergeRecords, npmFromInstall, repoKey } from "../lib/merge.js";
import { fromAwesome, fromDsh, fromMarket, fromWorkshop } from "../lib/sources.js";
import { login, register, resetStoreForTests } from "../public/auth.js";
import { FIELDS as catalogFields, SOURCE as catalogSource } from "../public/catalog.js";
import { readPackageJson } from "../public/zip.js";

test("repo and npm keys normalize", () => {
  assert.equal(repoKey("https://github.com/Foo/Bar.git"), "foo/bar");
  assert.equal(repoKey("https://github.com/Foo/Bar/tree/main"), "foo/bar");
  assert.equal(repoKey("github:Foo/Bar#v1.2.0"), "foo/bar");
  assert.equal(repoKey("git@github.com:Foo/Bar.git"), "foo/bar");
  assert.equal(repoKey("https://github.com/topics/dsh-plugin"), null);
  assert.equal(npmFromInstall("dsh plugin --profile web add deeptide@0.11.8"), "deeptide");
  assert.equal(npmFromInstall("dsh plugin --profile web add @liustack/modlens"), "@liustack/modlens");
  assert.equal(npmFromInstall("dsh plugin --profile web add @scope/name@1.2.3"), "@scope/name");
  assert.equal(npmFromInstall("dsh plugin --profile web add github:Foo/Bar"), null);
});

test("five sources collapse to one plugin", () => {
  const merged = mergeRecords([
    fromDsh({
      id: "bar",
      name: "Bar",
      description: "你好世界",
      stars: 3,
      topics: ["memory"],
      install: "dsh plugin --profile web add github:Foo/Bar#v1.2.0",
      verification: { level: 4 },
      security: { riskLevel: "pending", status: "pending" },
      source: null,
    }),
    fromDsh({
      id: "bar-2",
      name: "Bar risk",
      description: "风险更高的重复记录",
      stars: 1,
      topics: ["memory"],
      install: "dsh plugin --profile web add github:foo/bar",
      verification: { level: 2 },
      security: { riskLevel: "critical", status: "audited" },
      repoHealth: { status: "deleted" },
    }),
    fromAwesome({
      name: "Pretty Bar",
      url: "https://github.com/Foo/Bar.git",
      category: "tools",
      description: { zh: "更长的中文简介用于展示这条目录", en: "english description that is also fairly long" },
      npm: "@foo/bar",
      version: "1.2.3",
      stars: 9,
      install: "dsh plugin --profile web add @foo/bar",
      page: "https://awesome-dsh-plugin.com/p/Foo/Bar/",
      downloads: 15,
    }),
    fromMarket({
      name: "@foo/bar",
      description: { zh: "市场简介", en: "market" },
      repository: { url: "https://github.com/foo/bar" },
      metadata: { category: "memory" },
      versions: [{ version: "1.4.0" }],
    }),
    fromWorkshop({ n: "Bar", o: "Foo", d: "workshop desc", s: 8, l: "TypeScript" }),
  ]);
  assert.equal(merged.length, 1);
  const plugin = merged[0];
  assert.equal(plugin.src, SOURCE.topic | SOURCE.market | SOURCE.awesome | SOURCE.workshop | SOURCE.dshso);
  assert.equal(plugin.stars, 9);
  assert.equal(plugin.ver, "1.4.0");
  assert.equal(plugin.cat, "tools");
  assert.equal(plugin.npm, "@foo/bar");
  assert.equal(plugin.name, "Pretty Bar");
  assert.equal(plugin.lang, "TypeScript");
  assert.match(plugin.install, /github:Foo\/Bar#v1\.2\.0/);
  assert.equal(plugin.level, 4);
  assert.equal(plugin.risk, 4);
  assert.equal(plugin.health, 1);
  assert.equal(plugin.downloads, 15);
  assert.match(plugin.desc, /更长的中文简介/);
  assert.equal(plugin.dsh, "https://www.dsh.so/artifact/bar/");
  assert.equal(plugin.id, "r~foo~bar");
});

test("unrelated plugins stay separate and chinese description wins", () => {
  const merged = mergeRecords([
    fromDsh({
      id: "deeptide",
      name: "deeptide",
      description: "短中文",
      install: "dsh plugin --profile web add deeptide@0.11.8",
    }),
    fromAwesome({
      name: "Other",
      url: "https://github.com/someone/other",
      description: { en: "a much longer english description that should not beat a chinese one when they are different plugins" },
      category: "fun",
      stars: 2,
    }),
    {
      name: "Mix",
      namePriority: 1,
      desc: "plain english description with extra words",
      stars: 1,
      cat: "fun",
      catPriority: 1,
      repo: null,
      npm: "deeptide",
      npmPriority: 2,
      ver: null,
      install: null,
      src: SOURCE.awesome,
      level: 0,
      risk: 0,
      health: 0,
      downloads: null,
      lang: null,
      dshId: null,
      page: null,
    },
  ]);
  assert.equal(merged.length, 2);
  const deeptide = merged.find((plugin) => plugin.npm === "deeptide");
  assert.equal(deeptide.desc, "短中文");
  assert.equal(deeptide.repo, null);
});

test("repo subpaths stay separate from the root plugin", () => {
  const merged = mergeRecords([
    fromWorkshop({ n: "archify", o: "tt-a1i", d: "diagrams", s: 89000, l: "TypeScript" }),
    fromAwesome({
      name: "archify#integrations/deepseek-harness",
      url: "https://github.com/tt-a1i/archify/tree/main/integrations/deepseek-harness",
      description: { zh: "仓库里的一个集成", en: "integration" },
      npm: "@tt-a1i/archify-dsh",
      version: "1.0.0",
      stars: 89000,
      category: "dev",
    }),
  ]);
  assert.equal(merged.length, 2);
  const root = merged.find((plugin) => plugin.repo === "tt-a1i/archify" && plugin.npm == null);
  const child = merged.find((plugin) => plugin.npm === "@tt-a1i/archify-dsh");
  assert.equal(root.name, "archify");
  assert.equal(child.name, "integrations/deepseek-harness");
  assert.match(child.install, /@tt-a1i\/archify-dsh/);
});

test("catalog fields stay aligned", () => {
  assert.deepEqual(catalogFields, mergeFields);
  assert.deepEqual(catalogSource, SOURCE);
});

function zipWith(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const compressed = file.store ? file.data : deflateRawSync(file.data);
    const method = file.store ? 0 : 8;
    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

test("zip reader prefers the plugin package.json", async () => {
  const sample = await readPackageJson(new Uint8Array(readFileSync("examples/dsh-hello-community-0.1.0.zip")));
  assert.equal(sample.name, "dsh-hello-community");
  assert.equal(sample.version, "0.1.0");
  const nested = zipWith([
    { name: "pkg/node_modules/leftpad/package.json", data: Buffer.from(JSON.stringify({ name: "leftpad", version: "1.0.0" })) },
    { name: "pkg/package.json", data: Buffer.from(JSON.stringify({ name: "real-plugin", version: "2.0.0", description: "hi" })) },
  ]);
  const meta = await readPackageJson(new Uint8Array(nested));
  assert.equal(meta.name, "real-plugin");
  assert.equal(meta.version, "2.0.0");
});

test("register stores a hash, not the password", async () => {
  resetStoreForTests();
  const password = "correct-horse";
  const user = await register({ name: "海马", email: "Whale@Example.com", password, confirm: password });
  assert.equal(user.email, "whale@example.com");
  const saved = JSON.parse(globalThis.localStorage?.getItem("dsh.accounts.v1") || "null");
  const raw = saved ? JSON.stringify(saved) : "";
  if (raw) assert.equal(raw.includes(password), false);
  await assert.rejects(() => login("whale@example.com", "wrong-password"), /不对/);
  const again = await login("Whale@Example.com", password);
  assert.equal(again.name, "海马");
  resetStoreForTests();
});

test("plugin icon stays when it is an https image", () => {
  const merged = mergeRecords([
    fromAwesome({
      name: "Icon",
      url: "https://github.com/Foo/Icon",
      icon: "https://raw.githubusercontent.com/Foo/Icon/main/assets/icon.png",
    }),
    fromAwesome({
      name: "Bad",
      url: "https://github.com/Foo/Bad",
      icon: "javascript:alert(1)",
    }),
  ]);
  const icon = merged.find((item) => item.repo === "foo/icon");
  const bad = merged.find((item) => item.repo === "foo/bad");
  assert.equal(icon.icon, "https://raw.githubusercontent.com/Foo/Icon/main/assets/icon.png");
  assert.equal(bad.icon, null);
});
