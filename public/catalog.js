export const FIELDS = ["id", "name", "desc", "stars", "cat", "repo", "npm", "ver", "install", "src", "level", "risk", "health", "downloads", "lang", "dsh", "page"];

export const SOURCE = {
  topic: 1,
  market: 2,
  awesome: 4,
  workshop: 8,
  dshso: 16,
};

export const CAT_LABEL = {
  agi: "AGI 架构",
  ui: "界面",
  usage: "用量",
  theme: "主题",
  model: "模型",
  identity: "身份",
  session: "会话",
  memory: "记忆",
  tools: "工具",
  wsl: "WSL",
  browser: "浏览器",
  vision: "视觉",
  voice: "语音",
  docs: "文档",
  skill: "技能",
  workflow: "工作流",
  git: "Git",
  notify: "通知",
  dev: "运行时",
  security: "安全",
  remote: "远程",
  market: "市场",
  fun: "娱乐",
  desktop: "桌面",
  knowledge: "知识",
  developer: "开发",
  storage: "存储",
  ai: "智能",
  network: "网络",
  automation: "自动化",
  terminal: "终端",
  data: "数据",
  media: "媒体",
  productivity: "效率",
  content: "内容",
  finance: "金融",
  launcher: "启动器",
  game: "游戏",
  other: "其他",
  local: "本机",
};

export const SOURCES = [
  { bit: 1, id: "topic", name: "GitHub topic", short: "T" },
  { bit: 2, id: "market", name: "dshmarket", short: "M" },
  { bit: 4, id: "awesome", name: "awesome", short: "A" },
  { bit: 8, id: "workshop", name: "创意工坊", short: "坊" },
  { bit: 16, id: "dshso", name: "dsh.so", short: "D" },
];

let manifest = null;
let items = [];
let loaded = false;
let loading = null;
let revision = 0;
const byId = new Map();
const listeners = new Set();

export function onProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getManifest() {
  return manifest;
}

export function getItems() {
  return items;
}

export function isLoaded() {
  return loaded;
}

export function hydrate(row) {
  const plugin = { local: false };
  FIELDS.forEach((key, index) => {
    plugin[key] = row[index];
  });
  plugin.q = [plugin.name, plugin.desc, plugin.repo, plugin.npm, plugin.id, catLabel(plugin.cat)].filter(Boolean).join("\n").toLowerCase();
  return plugin;
}

export async function boot() {
  if (manifest) return manifest;
  const response = await fetch("./data/manifest.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("还没有目录数据。先在项目里运行 npm run build。");
  manifest = await response.json();
  if (!Array.isArray(manifest.fields) || manifest.fields.join() !== FIELDS.join()) {
    throw new Error("目录字段和页面不一致，请重新构建。");
  }
  return manifest;
}

export function ensureAll() {
  if (loaded) return Promise.resolve(items);
  if (loading) return loading;
  const rev = revision;
  loading = (async () => {
    const data = await boot();
    if (rev !== revision) return items;
    const shards = data.shards || [];
    if (!shards.length) {
      items = [];
      loaded = true;
      return items;
    }
    const version = encodeURIComponent(data.builtAt || "0");
    const loadShard = async (shard) => {
      const response = await fetch(`./${shard}?v=${version}`, { cache: "force-cache" });
      if (!response.ok) throw new Error("分片加载失败");
      return response.json();
    };
    const publish = (rows) => {
      if (rev !== revision) return;
      items = rows.map(hydrate);
      byId.clear();
      for (const plugin of items) byId.set(plugin.id, plugin);
      for (const fn of listeners) fn(items.length, data.total);
    };
    const first = await loadShard(shards[0]);
    publish(first);
    if (shards.length > 1) {
      const rest = await Promise.all(shards.slice(1).map(loadShard));
      if (rev !== revision) return items;
      publish(first.concat(...rest));
    }
    if (rev !== revision) return items;
    loaded = true;
    return items;
  })().catch((error) => {
    if (rev === revision) loading = null;
    throw error;
  });
  return loading;
}

export function getById(id) {
  return byId.get(id) || items.find((plugin) => plugin.id === id) || null;
}

function comparePlugins(sort, order) {
  const dir = order === "asc" ? 1 : -1;
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh");
  const stars = (plugin) => plugin.stars || 0;
  if (sort === "name") return (a, b) => byName(a, b) * dir || (stars(b) - stars(a));
  if (sort === "level") return (a, b) => ((a.level || 0) - (b.level || 0)) * dir || (stars(b) - stars(a)) || byName(a, b);
  if (sort === "downloads") return (a, b) => ((a.downloads || 0) - (b.downloads || 0)) * dir || (stars(b) - stars(a)) || byName(a, b);
  return (a, b) => (stars(a) - stars(b)) * dir || byName(a, b);
}

function scoreToken(plugin, token) {
  const name = plugin.name.toLowerCase();
  const repo = (plugin.repo || "").toLowerCase();
  const npm = (plugin.npm || "").toLowerCase();
  const cat = catLabel(plugin.cat).toLowerCase();
  let score = 0;
  if (name === token) score += 1000;
  else if (name.startsWith(token)) score += 700;
  else if (name.includes(token)) score += 400;
  if (repo === token || repo.endsWith(`/${token}`)) score += 650;
  else if (repo.includes(token)) score += 250;
  if (npm === token || npm.endsWith(`/${token}`)) score += 650;
  else if (npm.includes(token)) score += 220;
  if (cat === token) score += 120;
  else if (cat.includes(token)) score += 60;
  if ((plugin.desc || "").toLowerCase().includes(token)) score += 40;
  return score;
}

function matchScore(plugin, needle) {
  const tokens = needle.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return scoreToken(plugin, needle);
  return tokens.reduce((sum, token) => sum + scoreToken(plugin, token), 0);
}

export function catalogListKey(params) {
  const get = (key) => params.get(key) || "";
  const src = get("src");
  const level = get("lv");
  const sort = get("sort");
  const order = get("ord");
  const page = get("page");
  return [
    get("q"),
    get("cat"),
    src === "0" ? "" : src,
    level === "0" ? "" : level,
    !sort || sort === "stars" ? "" : sort,
    order === "asc" ? "asc" : "",
    !page || page === "1" ? "" : page,
  ].join("|");
}

export function filterPlugins(list, { q = "", cat = "", src = 0, level = 0, sort = "stars", order = "desc" } = {}) {
  const needle = q.trim().toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  const direction = order === "asc" ? "asc" : "desc";
  const field = ["name", "level", "downloads"].includes(sort) ? sort : "stars";
  let out = list;
  if (tokens.length) out = out.filter((plugin) => tokens.every((token) => plugin.q.includes(token)));
  if (cat) out = out.filter((plugin) => plugin.cat === cat);
  if (src) out = out.filter((plugin) => plugin.src & src);
  if (level) out = out.filter((plugin) => plugin.level === Number(level));
  const relevance = tokens.length && field === "stars" && direction === "desc";
  if (relevance) {
    const tie = comparePlugins("stars", "desc");
    out = out.slice().sort((a, b) => matchScore(b, needle) - matchScore(a, needle) || tie(a, b));
  } else if (field !== "stars" || direction === "asc") {
    out = out.slice().sort(comparePlugins(field, direction));
  }
  return out;
}

export function replaceItems(plugins, builtAt = new Date().toISOString()) {
  revision += 1;
  items = plugins.map((plugin) => {
    const next = { ...plugin, local: false };
    next.q = [next.name, next.desc, next.repo, next.npm, next.id, catLabel(next.cat)].filter(Boolean).join("\n").toLowerCase();
    return next;
  });
  byId.clear();
  for (const plugin of items) byId.set(plugin.id, plugin);
  loaded = true;
  loading = null;
  if (manifest) {
    const counts = new Map();
    for (const plugin of items) {
      const cat = plugin.cat || "other";
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    manifest.categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    manifest.total = items.length;
    manifest.builtAt = builtAt;
    manifest.live = true;
  }
  for (const fn of listeners) fn(items.length, items.length);
  return items;
}

export function catLabel(id) {
  return CAT_LABEL[id] || id || "其他";
}
