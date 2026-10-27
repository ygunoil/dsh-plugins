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
  plugin.q = [plugin.name, plugin.desc, plugin.repo, plugin.npm, plugin.id].filter(Boolean).join("\n").toLowerCase();
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
  loading = (async () => {
    const data = await boot();
    const next = [];
    for (let i = 0; i < data.shards.length; i += 4) {
      const group = data.shards.slice(i, i + 4);
      const parts = await Promise.all(group.map(async (shard) => {
        const response = await fetch(`./${shard}`, { cache: "no-cache" });
        if (!response.ok) throw new Error("分片加载失败");
        return response.json();
      }));
      for (const rows of parts) {
        for (const row of rows) next.push(hydrate(row));
      }
      items = next.slice();
      byId.clear();
      for (const fn of listeners) fn(items.length, data.total);
    }
    for (const plugin of items) byId.set(plugin.id, plugin);
    loaded = true;
    return items;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function getById(id) {
  return byId.get(id) || items.find((plugin) => plugin.id === id) || null;
}

export function filterPlugins(list, { q = "", cat = "", src = 0, level = 0, sort = "stars" } = {}) {
  const needle = q.trim().toLowerCase();
  let out = list;
  if (needle) out = out.filter((plugin) => plugin.q.includes(needle));
  if (cat) out = out.filter((plugin) => plugin.cat === cat);
  if (src) out = out.filter((plugin) => plugin.src & src);
  if (level) out = out.filter((plugin) => plugin.level === Number(level));
  if (sort === "name") out = out.slice().sort((a, b) => a.name.localeCompare(b.name, "zh"));
  else if (sort === "level") out = out.slice().sort((a, b) => b.level - a.level || b.stars - a.stars);
  else if (sort === "downloads") out = out.slice().sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || b.stars - a.stars);
  return out;
}

export function catLabel(id) {
  return CAT_LABEL[id] || id || "其他";
}
