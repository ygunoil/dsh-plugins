import {
  SOURCE,
  cleanText,
  clip,
  npmFromInstall,
  npmKey,
  repoKey,
  semverish,
} from "./merge.js";

export function pathKeyFromUrl(url) {
  if (!url) return null;
  const match = String(url).match(/github\.com\/([^/]+)\/([^/]+)\/(?:tree|blob)\/[^/]+\/(.+?)\/?$/i);
  if (!match) return null;
  const repo = repoKey(url);
  const sub = decodeURIComponent(match[3]).replace(/\/+$/, "").toLowerCase();
  if (!repo || !sub || sub.includes("..")) return null;
  return `${repo}/${sub}`;
}

function prettyName(name) {
  const raw = cleanText(name);
  if (!raw.includes("#")) return clip(raw, 80);
  const tail = raw.split("#").slice(1).join("#").replace(/^\/+/, "");
  return clip(tail || raw, 80);
}

export function normCat(value) {
  const cat = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(cat) ? cat : "";
}

function starsOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), Number.MAX_SAFE_INTEGER);
}

function downloadsOf(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), Number.MAX_SAFE_INTEGER);
}

export function riskCode(security) {
  if (!security || typeof security !== "object") return 0;
  const level = String(security.riskLevel || "").toLowerCase();
  if (level === "low") return 1;
  if (level === "medium") return 2;
  if (level === "high") return 3;
  if (level === "critical") return 4;
  if (security.status === "pending" || level === "unknown") return 5;
  return 0;
}

export function healthCode(health) {
  const status = String(health?.status || "");
  if (status === "deleted") return 1;
  if (status === "renamed") return 2;
  if (status === "merged") return 3;
  if (status === "topic-removed") return 4;
  return 0;
}

export function levelCode(verification) {
  const level = Number(verification?.level);
  return level >= 1 && level <= 5 ? level : 0;
}

function descriptionOf(value) {
  return clip(cleanText(value), 200);
}

function unixTime(value) {
  if (value == null || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  let sec = 0;
  if (Number.isFinite(numeric) && String(value).trim() !== "") {
    sec = numeric > 1e12 ? Math.round(numeric / 1000) : Math.round(numeric);
  } else {
    const ms = Date.parse(String(value));
    if (Number.isFinite(ms)) sec = Math.floor(ms / 1000);
  }
  if (sec < 1_000_000_000 || sec > 2_200_000_000) return 0;
  return sec;
}

function versionTimes(versions) {
  let updated = 0;
  let published = 0;
  if (!Array.isArray(versions)) return { updated, published };
  for (const version of versions) {
    const stamp = unixTime(version?.publishTimestamp);
    if (!stamp) continue;
    updated = Math.max(updated, stamp);
    published = published ? Math.min(published, stamp) : stamp;
  }
  return { updated, published };
}


export function fromDsh(plugin) {
  const repo = repoKey(plugin.source) || repoKey(plugin.install) || repoKey(plugin.download);
  const npm = npmFromInstall(plugin.install);
  const topic = Array.isArray(plugin.topics) ? plugin.topics.find((item) => typeof item === "string") : "";
  return {
    name: clip(cleanText(plugin.name || plugin.id || ""), 80),
    namePriority: plugin.name ? 2 : 0,
    desc: descriptionOf(plugin.description),
    stars: starsOf(plugin.stars),
    cat: normCat(topic),
    catPriority: normCat(topic) ? 1 : 0,
    repo,
    repoKey: repo,
    npm,
    npmPriority: npm ? 1 : 0,
    ver: null,
    install: cleanText(plugin.install).slice(0, 180) || null,
    src: SOURCE.dshso,
    level: levelCode(plugin.verification),
    risk: riskCode(plugin.security),
    health: healthCode(plugin.repoHealth),
    downloads: null,
    lang: null,
    dshId: plugin.id ? String(plugin.id) : null,
    page: null,
  };
}

export function safeIcon(value) {
  const raw = String(value || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(raw) || raw.length > 400) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

const SHOT_EXT = /\.(png|jpe?g|webp|gif)$/i;

export function safeShot(value) {
  const raw = String(value || "").trim();
  if (!/^https:\/\/[^\s<>"]+$/i.test(raw) || raw.length > 400) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.protocol !== "https:") return null;
    const blob = url.hostname === "github.com"
      ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/i)
      : null;
    if (blob && SHOT_EXT.test(blob[3])) {
      return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}${url.search}`;
    }
    const attachment = url.hostname === "github.com" && /^\/user-attachments\/assets\/[A-Za-z0-9-]+\/?$/i.test(url.pathname);
    if (!SHOT_EXT.test(url.pathname) && !attachment) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeShots(value) {
  if (!Array.isArray(value)) return [];
  const shots = [];
  const seen = new Set();
  for (const item of value) {
    const shot = safeShot(item);
    if (!shot || seen.has(shot)) continue;
    seen.add(shot);
    shots.push(shot);
    if (shots.length >= 8) break;
  }
  return shots;
}

export function fromAwesome(plugin) {
  const repo = repoKey(plugin.url);
  const pathKey = pathKeyFromUrl(plugin.url);
  const npm = npmKey(plugin.npm);
  const cat = normCat(plugin.category);
  const hashed = String(plugin.name || "").includes("#");
  return {
    name: prettyName(plugin.name || ""),
    namePriority: plugin.name ? (hashed ? 2 : 3) : 0,
    desc: descriptionOf(plugin.description),
    stars: starsOf(plugin.stars),
    cat,
    catPriority: cat ? 3 : 0,
    repo,
    repoKey: pathKey ? null : repo,
    pathKey,
    sub: Boolean(pathKey),
    npm,
    npmPriority: npm ? 2 : 0,
    ver: semverish(plugin.version),
    install: cleanText(plugin.install).slice(0, 180) || null,
    src: SOURCE.awesome,
    level: 0,
    risk: 0,
    health: 0,
    downloads: downloadsOf(plugin.downloads),
    lang: null,
    dshId: null,
    page: typeof plugin.page === "string" ? plugin.page : null,
    icon: safeIcon(plugin.icon),
    shots: safeShots(plugin.screenshots),
  };
}

export function fromMarket(plugin) {
  const repo = repoKey(plugin.repository?.url || "");
  const npm = npmKey(plugin.name);
  const cat = normCat(plugin.metadata?.category);
  const short = npm ? npm.split("/").pop() : "";
  const times = versionTimes(plugin.versions);
  const version = Array.isArray(plugin.versions) ? plugin.versions[0]?.version : null;
  return {
    name: clip(cleanText(short), 80),
    namePriority: short ? 1 : 0,
    desc: descriptionOf(plugin.description),
    stars: 0,
    cat,
    catPriority: cat ? 2 : 0,
    repo,
    repoKey: repo,
    npm,
    npmPriority: npm ? 3 : 0,
    ver: semverish(version),
    install: null,
    src: SOURCE.market,
    level: 0,
    risk: 0,
    health: 0,
    downloads: null,
    lang: null,
    dshId: null,
    page: null,
    updated: times.updated,
    published: times.published,
  };
}

export function fromWorkshop(plugin) {
  if (!plugin?.o || !plugin?.n) return null;
  const repo = repoKey(`https://github.com/${plugin.o}/${plugin.n}`);
  if (!repo) return null;
  return {
    name: clip(cleanText(plugin.n), 80),
    namePriority: 1,
    desc: descriptionOf(plugin.d),
    stars: starsOf(plugin.s),
    cat: "",
    catPriority: 0,
    repo,
    repoKey: repo,
    npm: null,
    npmPriority: 0,
    ver: null,
    install: null,
    src: SOURCE.workshop | SOURCE.topic,
    level: 0,
    risk: 0,
    health: 0,
    downloads: null,
    lang: plugin.l ? cleanText(plugin.l).slice(0, 40) : null,
    dshId: null,
    page: null,
    updated: unixTime(plugin.u),
    published: unixTime(plugin.c),
  };
}
