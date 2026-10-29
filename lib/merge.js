export const FIELDS = [
  "id",
  "name",
  "desc",
  "stars",
  "cat",
  "repo",
  "npm",
  "ver",
  "install",
  "src",
  "level",
  "risk",
  "health",
  "downloads",
  "lang",
  "dsh",
  "page",
  "updated",
  "published",
];

export const SOURCE = {
  topic: 1,
  market: 2,
  awesome: 4,
  workshop: 8,
  dshso: 16,
};

export function cleanText(value) {
  if (value == null) return "";
  if (typeof value === "object") value = value.zh || value.en || "";
  return String(value).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

export function clip(text, max) {
  const chars = Array.from(text || "");
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, Math.max(0, max - 1)).join("") + "…";
}

export function semverish(value) {
  if (!value) return null;
  const match = String(value).match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

export function repoKey(text) {
  if (!text) return null;
  const match = String(text).match(/github(?:\.com)?[:/]+([^/\s#]+)\/([^/\s#?]+)/i);
  if (!match) return null;
  const owner = match[1];
  const name = match[2].replace(/\.git$/i, "");
  if (!owner || !name || owner === "." || name === "." || owner === ".." || name === "..") return null;
  if (["topics", "orgs", "features", "settings", "marketplace"].includes(owner.toLowerCase())) return null;
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

export function npmKey(name) {
  if (!name) return null;
  const normalized = String(name).trim().toLowerCase();
  if (!normalized || normalized.includes("..") || normalized === "." || normalized === "..") return null;
  if (!/^(@[a-z0-9-._]+\/)?[a-z0-9-._]+$/.test(normalized)) return null;
  return normalized;
}

export function npmFromInstall(install) {
  if (!install || /github:/i.test(install)) return null;
  const match = String(install).match(/\badd\s+(\S+)/);
  if (!match) return null;
  let token = match[1].replace(/[>,);]+$/, "");
  if (/^(https?:|git\+|file:|\.|\/)/i.test(token)) return null;
  if (token.startsWith("@")) {
    const parts = token.split("@");
    token = `@${parts[1] || ""}`;
  } else if (token.includes("@")) {
    token = token.slice(0, token.indexOf("@"));
  }
  return npmKey(token);
}

function descScore(text) {
  if (!text) return 0;
  return (/[\u4e00-\u9fff]/.test(text) ? 1000 : 0) + text.length;
}

function installScore(text) {
  if (!text) return 0;
  let score = Math.min(text.length, 180) / 1000;
  if (text.includes("dsh plugin")) score += 2;
  if (text.includes("github:")) score += 2;
  return score;
}

function cmpVer(left, right) {
  const a = String(left || "").split(/[.-]/).map((part) => parseInt(part, 10));
  const b = String(right || "").split(/[.-]/).map((part) => parseInt(part, 10));
  const length = Math.max(a.length, b.length, 3);
  for (let i = 0; i < length; i += 1) {
    const diff = (Number.isFinite(a[i]) ? a[i] : 0) - (Number.isFinite(b[i]) ? b[i] : 0);
    if (diff) return diff;
  }
  return 0;
}

function worseRisk(left, right) {
  const rank = { 0: 0, 5: 1, 1: 2, 2: 3, 3: 4, 4: 5 };
  return (rank[left] || 0) >= (rank[right] || 0) ? left : right;
}

function worseHealth(left, right) {
  const rank = { 0: 0, 4: 1, 3: 2, 2: 3, 1: 4 };
  return (rank[left] || 0) >= (rank[right] || 0) ? left : right;
}

function blank() {
  return {
    name: "",
    namePriority: 0,
    desc: "",
    stars: 0,
    cat: "",
    catPriority: 0,
    repo: null,
    npm: null,
    npmPriority: 0,
    ver: null,
    install: null,
    src: 0,
    level: 0,
    risk: 0,
    health: 0,
    downloads: null,
    lang: null,
    dshId: null,
    page: null,
    icon: null,
    sub: false,
    updated: 0,
    published: 0,
  };
}

function absorb(base, extra) {
  if (extra.name && (extra.namePriority || 0) > (base.namePriority || 0)) {
    base.name = extra.name;
    base.namePriority = extra.namePriority || 0;
  } else if (!base.name && extra.name) {
    base.name = extra.name;
  }
  if (descScore(extra.desc) > descScore(base.desc)) base.desc = extra.desc;
  base.stars = Math.max(base.stars || 0, extra.stars || 0);
  if (extra.cat && (extra.catPriority || 0) > (base.catPriority || 0)) {
    base.cat = extra.cat;
    base.catPriority = extra.catPriority || 0;
  }
  if (!base.repo && extra.repo) base.repo = extra.repo;
  if (extra.npm && (extra.npmPriority || 0) > (base.npmPriority || 0)) {
    base.npm = extra.npm;
    base.npmPriority = extra.npmPriority || 0;
  }
  if (extra.ver && (!base.ver || cmpVer(extra.ver, base.ver) > 0)) base.ver = extra.ver;
  if (installScore(extra.install) > installScore(base.install)) base.install = extra.install;
  base.src |= extra.src || 0;
  base.level = Math.max(base.level || 0, extra.level || 0);
  base.risk = worseRisk(base.risk || 0, extra.risk || 0);
  base.health = worseHealth(base.health || 0, extra.health || 0);
  if (extra.downloads != null) {
    base.downloads = base.downloads == null ? extra.downloads : Math.max(base.downloads, extra.downloads);
  }
  if (!base.lang && extra.lang) base.lang = extra.lang;
  if (!base.dshId && extra.dshId) base.dshId = extra.dshId;
  if (!base.page && extra.page) base.page = extra.page;
  if (!base.icon && extra.icon) base.icon = extra.icon;
  if (extra.sub) base.sub = true;
  if (extra.updated) base.updated = Math.max(base.updated || 0, extra.updated);
  if (extra.published) base.published = base.published ? Math.min(base.published, extra.published) : extra.published;
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }

  find(value) {
    if (!this.parent.has(value)) this.parent.set(value, value);
    let root = value;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let current = value;
    while (current !== root) {
      const next = this.parent.get(current);
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(left, right) {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(b, a);
  }
}

function safePage(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function finalize(record, index) {
  const repo = record.repo || null;
  const npm = record.npm || null;
  let install = record.install || null;
  if (!install && record.sub && npm) install = `dsh plugin --profile web add ${npm}`;
  else if (!install && repo) install = `dsh plugin --profile web add github:${repo}`;
  else if (!install && npm) install = `dsh plugin --profile web add ${npm}`;
  const name = clip(record.name || (repo ? repo.split("/")[1] : "") || npm || "未命名", 80);
  let id = repo
    ? `r~${repo.replaceAll("/", "~")}`
    : npm
      ? `n~${npm.replaceAll("/", "~")}`
      : record.dshId
        ? `d~${String(record.dshId).replaceAll("~", "-")}`
        : `x~${index}`;
  return {
    id,
    name,
    desc: clip(record.desc || "", 200),
    stars: record.stars || 0,
    cat: record.cat || "other",
    repo,
    npm,
    ver: record.ver || null,
    install,
    src: record.src || 0,
    level: record.level || 0,
    risk: record.risk || 0,
    health: record.health || 0,
    downloads: record.downloads ?? null,
    lang: record.lang || null,
    dsh: record.dshId ? `https://www.dsh.so/artifact/${encodeURIComponent(record.dshId)}/` : null,
    page: safePage(record.page),
    icon: record.icon || null,
    updated: record.updated || null,
    published: record.published || null,
  };
}

export function mergeRecords(records) {
  const sets = new UnionFind();
  records.forEach((record, index) => {
    const keys = [];
    if (record.pathKey) keys.push(`path:${record.pathKey}`);
    else if (record.repoKey || record.repo) keys.push(`repo:${record.repoKey || record.repo}`);
    if (record.npm) keys.push(`npm:${record.npm}`);
    if (keys.length === 0) keys.push(`solo:${index}`);
    const node = `n${index}`;
    for (const key of keys) sets.union(node, key);
  });

  const groups = new Map();
  records.forEach((record, index) => {
    const root = sets.find(`n${index}`);
    if (!groups.has(root)) groups.set(root, blank());
    absorb(groups.get(root), record);
  });

  const merged = [...groups.values()]
    .map((record, index) => finalize(record, index))
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name, "zh"));

  const used = new Set();
  for (const record of merged) {
    let id = record.id;
    let n = 2;
    while (used.has(id)) {
      id = `${record.id}~${n}`;
      n += 1;
    }
    used.add(id);
    record.id = id;
  }
  return merged;
}

export function toRow(record) {
  return FIELDS.map((key) => record[key]);
}
