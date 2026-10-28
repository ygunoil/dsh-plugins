import {
  currentUser,
  getUpload,
  listUploads,
  login,
  logout,
  register,
  removeUpload,
  saveUpload,
  wipeLocal,
} from "./auth.js?v=20261027";
import {
  boot,
  catLabel,
  ensureAll,
  filterPlugins,
  getById,
  getItems,
  getManifest,
  isLoaded,
  onProgress,
  replaceItems,
  catalogListKey,
} from "./catalog.js?v=20261029w";
import { readPackageJson } from "./zip.js?v=20261027";

const app = document.querySelector("#app");
const state = { q: "", cat: "", src: 0, level: 0, sort: "stars", order: "desc", page: 1 };
const pageSize = 24;
let token = 0;
let unsub = null;
let flash = "";
let localRows = [];
let renderedListKey = "";
let fittedSize = pageSize;
let settleFrame = 0;
let resizeTimer = 0;
let syncing = false;
let queryTimer = 0;
let composing = false;
let seekPick = -1;
let remoteToken = 0;
let catQuery = "";
let hotOpen = true;

const HEALTH = { 1: "源仓库已删除", 2: "源仓库已改名", 3: "源仓库已合并", 4: "topic 已移除" };
const RISK = { 1: "低", 2: "中", 3: "高", 4: "严重", 5: "待核验" };
const SOURCE_LABEL = [
  [1, "topic"],
  [2, "market"],
  [4, "awesome"],
  [8, "工坊"],
  [16, "dsh.so"],
];

function day(value) {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

const num = (value) => Number(value || 0).toLocaleString("zh-CN");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 10000) {
    const wan = n / 10000;
    const text = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, "");
    return `${text}万`;
  }
  return n.toLocaleString("zh-CN");
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch {
    return "";
  }
  return "";
}

function githubUrl(repo) {
  if (!repo || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)) return "";
  const [owner, name] = repo.split("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function npmUrl(name) {
  if (!name || !/^(@[a-z0-9-._]+\/)?[a-z0-9-._]+$/i.test(name)) return "";
  return `https://www.npmjs.com/package/${name}`;
}

function npmTgz(name, version) {
  if (!npmUrl(name) || !/^\d+\.\d+\.\d+/.test(version || "")) return "";
  const base = name.startsWith("@") ? name.split("/")[1] : name;
  const pathName = name.startsWith("@") ? name.replace("/", "%2f") : name;
  return `https://registry.npmjs.org/${pathName}/-/${base}-${version}.tgz`;
}

function readRoute() {
  const raw = (location.hash || "#/market").slice(1);
  const cut = raw.indexOf("?");
  const path = cut === -1 ? raw || "/" : raw.slice(0, cut) || "/";
  const params = new URLSearchParams(cut === -1 ? "" : raw.slice(cut + 1));
  return { path, params };
}

function isCatalog(path) {
  return path === "/" || path === "/market";
}

function marketHash() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.cat) params.set("cat", state.cat);
  if (state.src) params.set("src", String(state.src));
  if (state.level) params.set("lv", String(state.level));
  if (state.sort && state.sort !== "stars") params.set("sort", state.sort);
  if (state.order === "asc") params.set("ord", "asc");
  if (state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return query ? `#/market?${query}` : "#/market";
}

function applyMarketParams(params) {
  state.q = params.get("q") || "";
  state.cat = params.get("cat") || "";
  state.src = Number(params.get("src") || 0);
  state.level = Number(params.get("lv") || 0);
  state.sort = ["level", "downloads", "name"].includes(params.get("sort")) ? params.get("sort") : "stars";
  state.order = params.get("ord") === "asc" ? "asc" : "desc";
  state.page = Math.max(1, Number(params.get("page") || 1) || 1);
}

function navKey(path) {
  if (path.startsWith("/plugin") || isCatalog(path)) return "/market";
  if (path === "/insights" || path === "/guide" || path === "/about") return "/about";
  if (path === "/publish" || path === "/local") return "/local";
  return path || "/market";
}

function syncSearch() {
  const input = document.getElementById("seek-q");
  if (input && input.value !== state.q) input.value = state.q;
}

function renderSession() {
  const slot = document.querySelector("#session");
  const user = currentUser();
  slot.innerHTML = user
    ? `<a class="who" href="#/account"><i>${esc(user.name.slice(0, 1))}</i>${esc(user.name)}</a>`
    : `<a class="btn btn-ghost" href="#/account">登录</a>`;
}

function markNav(path) {
  const key = navKey(path);
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const on = link.dataset.nav === key;
    link.classList.toggle("is-on", on);
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function sourcePills(src) {
  return SOURCE_LABEL.filter(([bit]) => src & bit).map(([, label]) => `<span class="pill">${label}</span>`).join("");
}

function levelChip(plugin) {
  if (!plugin.level) return "";
  return `<span class="pill pill-level" title="dsh.so 的标注，本站没有复验">L${plugin.level}</span>`;
}

function riskChip(plugin) {
  if (plugin.risk < 3 || plugin.risk === 5) return "";
  return `<span class="pill pill-risk">${plugin.risk === 4 ? "严重" : "高风险"}</span>`;
}

function queryTokens() {
  return state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function hi(value) {
  const text = String(value ?? "");
  const tokens = queryTokens();
  if (!tokens.length || !text) return esc(text);
  const pattern = new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  let html = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    html += esc(text.slice(last, match.index));
    html += `<mark>${esc(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  html += esc(text.slice(last));
  return html;
}

function pluginHref(id) {
  const params = new URLSearchParams();
  params.set("id", id);
  if (state.q) params.set("q", state.q);
  if (state.cat) params.set("cat", state.cat);
  if (state.src) params.set("src", String(state.src));
  if (state.level) params.set("lv", String(state.level));
  if (state.sort && state.sort !== "stars") params.set("sort", state.sort);
  if (state.order === "asc") params.set("ord", "asc");
  if (state.page > 1) params.set("page", String(state.page));
  return `#/plugin?${params}`;
}

function addTarget(install) {
  const text = String(install || "");
  const mark = " add ";
  const at = text.lastIndexOf(mark);
  return at === -1 ? text : text.slice(at + mark.length);
}

function withProfile(install, profile) {
  const text = String(install || "");
  return profile === "desktop" ? text.replace("--profile web", "--profile desktop") : text;
}

function isRelativeInstall(target) {
  return target.startsWith("./") || target.startsWith("../");
}

function desktopSpec(install) {
  const target = addTarget(install);
  return isRelativeInstall(target) ? "" : target;
}

function installRows(install) {
  if (!install) return `<p class="muted">这条没有安装命令。</p>`;
  const target = addTarget(install);
  const desktop = isRelativeInstall(target)
    ? ["Desktop", "解压目录的绝对路径", "在 Desktop 侧栏「插件 → 添加插件」粘贴绝对路径，不要粘贴 ./目录名", ""]
    : ["Desktop", target, "粘贴到 Desktop 侧栏「插件 → 添加插件」。应用保持打开，装完点「立即启用」", target];
  const rows = [
    ["Web", withProfile(install, "web"), "复制后在终端执行，然后重新运行 dsh web", withProfile(install, "web")],
    desktop,
  ];
  return `<div class="install-pair">${rows.map(([label, command, title, copy]) => {
    const button = copy ? `<button class="btn" type="button" data-act="copy" data-copy="${esc(copy)}" title="${esc(title)}">复制</button>` : "";
    return `<div class="install"><span class="install-tag">${label}</span><code title="${esc(title)}">${esc(command)}</code>${button}</div>`;
  }).join("")}</div>`;
}

function card(plugin) {
  const repo = plugin.repo || plugin.npm || "";
  const cat = plugin.cat && plugin.cat !== "other" ? `<span class="pill">${hi(catLabel(plugin.cat))}</span>` : "";
  const health = plugin.health ? `<span class="pill pill-risk">${esc(HEALTH[plugin.health] || "异常")}</span>` : "";
  const sources = plugin.local ? `<span class="pill">本机</span>` : sourcePills(plugin.src);
  const command = plugin.install
    ? `<div class="card-add"><code title="${esc(plugin.install)}">${esc(addTarget(plugin.install))}</code><span class="add-btns"><button class="btn" type="button" data-act="copy" data-copy="${esc(withProfile(plugin.install, "web"))}" title="复制 Web 命令">Web</button>${desktopSpec(plugin.install) ? `<button class="btn btn-ghost" type="button" data-act="copy" data-copy="${esc(desktopSpec(plugin.install))}" title="粘贴到 Desktop 侧栏「插件 → 添加插件」，装完点「立即启用」">Desktop</button>` : ""}</span></div>`
    : "";
  return `<article class="card${plugin.health === 1 ? " is-dead" : ""}">
    <a class="card-main" href="${esc(pluginHref(plugin.id))}">
      <header><h3>${hi(plugin.name)}</h3>${plugin.stars ? `<em class="stars">${esc(compact(plugin.stars))}</em>` : ""}</header>
      ${repo ? `<p class="repo">${hi(repo)}</p>` : ""}
      <p class="desc">${hi(plugin.desc || "暂无简介")}</p>
      <footer>${cat}${levelChip(plugin)}${riskChip(plugin)}${health}${sources}<span class="view">查看</span></footer>
    </a>
    ${command}
  </article>`;
}

function pager(page, pages) {
  if (pages <= 1) return "";
  const prev = page <= 1 ? " disabled" : "";
  const next = page >= pages ? " disabled" : "";
  return `<nav class="pager" aria-label="分页">
    <button type="button" data-act="page" data-page="1"${prev}>首页</button>
    <button type="button" data-act="page" data-page="${page - 1}"${prev}>上一页</button>
    <form class="jump" data-form="jump">
      <span>第</span>
      <input name="page" inputmode="numeric" value="${page}" aria-label="页码">
      <span>/ ${num(pages)}</span>
    </form>
    <button type="button" data-act="page" data-page="${page + 1}"${next}>下一页</button>
    <button type="button" data-act="page" data-page="${pages}"${next}>末页</button>
  </nav>`;
}

function fitPageSize() {
  if (!document.body.classList.contains("is-market")) return pageSize;
  const results = document.getElementById("results");
  if (!results || results.clientWidth < 240 || results.clientHeight < 140) return fittedSize;
  const gap = 16;
  const maxCard = 228;
  const minCard = 184;
  const grid = results.querySelector(".grid");
  const bar = results.querySelector(".result-bar");
  const pagerEl = results.querySelector(".pager");
  const chrome = (bar ? bar.offsetHeight + 8 : 28) + (pagerEl ? pagerEl.offsetHeight + 12 : 48);
  const gridH = grid && grid.clientHeight > 120 ? grid.clientHeight : Math.max(0, results.clientHeight - chrome);
  const width = grid && grid.clientWidth > 240 ? grid.clientWidth : results.clientWidth;
  let rows = Math.max(1, Math.floor((gridH + gap) / (minCard + gap)));
  let cardH = Math.floor((gridH - gap * (rows - 1)) / rows);
  if (cardH > maxCard) {
    rows = Math.max(1, Math.floor((gridH + gap) / (maxCard + gap)));
    cardH = Math.min(maxCard, Math.floor((gridH - gap * (rows - 1)) / rows));
  }
  results.style.setProperty("--card-h", `${Math.max(minCard, cardH)}px`);
  const cols = Math.max(1, Math.floor((width + gap) / (360 + gap)));
  return Math.min(pageSize, rows * cols);
}

function activePageSize() {
  if (!document.body.classList.contains("is-market")) return pageSize;
  fittedSize = fitPageSize();
  return fittedSize;
}

function currentPage(filtered) {
  const size = activePageSize();
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const ready = isLoaded() || state.src === 32;
  let page = state.page;
  if (ready && page > pages) {
    page = pages;
    state.page = page;
    const next = marketHash();
    if (location.hash !== next) history.replaceState(null, "", next);
  }
  const shown = Math.min(page, pages);
  const start = (shown - 1) * size;
  return { page: shown, pages, slice: filtered.slice(start, start + size) };
}

function categoryGroups() {
  const rows = getManifest()?.categories || [];
  return {
    named: rows.filter(([id]) => id && id !== "other"),
    other: rows.find(([id]) => id === "other"),
    total: getManifest()?.total || 0,
  };
}

const CAT_LANES = [
  ["界面", ["ui", "theme", "vision", "media", "voice", "content", "desktop"]],
  ["开发", ["developer", "dev", "terminal", "git", "wsl", "tools", "launcher"]],
  ["智能", ["ai", "model", "agi", "skill", "usage"]],
  ["知识", ["knowledge", "docs", "data", "storage", "memory"]],
  ["流程", ["automation", "workflow", "session", "productivity", "notify"]],
  ["连接", ["browser", "network", "remote", "security", "identity"]],
  ["场景", ["finance", "fun", "game", "market"]],
];

function catButton(id, label, count, feature, max) {
  const on = state.cat === id;
  const share = id ? Math.max(8, Math.round((count / max) * 100)) : 100;
  const figure = feature ? `<strong>${num(count)}</strong>` : `<small>${num(count)}</small>`;
  return `<button type="button" class="cat-chip${feature ? " is-feature" : ""}${on ? " is-on" : ""}" data-act="cat" data-cat="${esc(id)}" data-cat-item data-label="${esc(`${label} ${id}`)}" style="--share:${share}%" aria-pressed="${on ? "true" : "false"}"><b>${esc(label)}</b>${figure}<i></i></button>`;
}

function catLane(name, chips, extra = "") {
  if (!chips) return "";
  return `<div class="cat-lane${extra}" data-cat-lane><h3>${esc(name)}</h3><div class="cat-row">${chips}</div></div>`;
}

function paintCats() {
  const body = document.getElementById("cat-body");
  if (!body) return;
  const { named, other, total } = categoryGroups();
  const counts = new Map(named.map(([id, count]) => [id, count]));
  if (other) counts.set("other", other[1]);
  const max = Math.max(...named.map(([, count]) => count), 1);
  const featuredIds = named.slice(0, 6).map(([id]) => id);
  const featured = new Set(featuredIds);
  const used = new Set(featuredIds);
  const lanes = CAT_LANES.map(([name, ids]) => {
    const visible = ids.filter((id) => counts.has(id) && !featured.has(id));
    visible.forEach((id) => used.add(id));
    return catLane(name, visible.map((id) => catButton(id, catLabel(id), counts.get(id), false, max)).join(""));
  }).join("");
  const stray = named.filter(([id]) => !used.has(id));
  const strayHtml = catLane("更多", stray.map(([id, count]) => catButton(id, catLabel(id), count, false, max)).join(""));
  const otherHtml = other ? catLane("未归类", catButton("other", "其他", other[1], false, max)) : "";
  const hot = `${catButton("", "全部", total, true, max)}${featuredIds.map((id) => catButton(id, catLabel(id), counts.get(id), true, max)).join("")}`;
  body.innerHTML = `${catLane("常用", hot, " is-hot")}<div class="cat-lanes">${lanes}${strayHtml}${otherHtml}</div>`;
  applyCatFilter();
}

function applyCatFilter() {
  const needle = catQuery.trim().toLowerCase();
  const items = [...document.querySelectorAll("#cat-body [data-cat-item]")];
  for (const item of items) {
    const hay = (item.dataset.label || "").toLowerCase();
    item.hidden = Boolean(needle) && !hay.includes(needle);
  }
  for (const lane of document.querySelectorAll("#cat-body [data-cat-lane]")) {
    lane.hidden = ![...lane.querySelectorAll("[data-cat-item]")].some((item) => !item.hidden);
  }
  const visible = items.filter((item) => !item.hidden && item.dataset.cat).length;
  const empty = document.getElementById("cat-empty");
  if (empty) empty.hidden = !needle || visible > 0;
  const status = document.getElementById("cat-status");
  if (!status) return;
  if (needle) status.textContent = visible ? `匹配 ${visible} 个分类，回车直接看` : "没有这个分类";
  else if (state.cat) status.textContent = `${catLabel(state.cat)} · 再点一次取消`;
  else status.textContent = "点选分类，也可以和顶部搜索一起用";
}

function segButton(act, value, label, on, title = "") {
  const tip = title ? ` title="${esc(title)}"` : "";
  return `<button type="button" class="seg${on ? " is-on" : ""}" data-act="${act}" data-value="${esc(value)}" aria-pressed="${on ? "true" : "false"}"${tip}>${esc(label)}</button>`;
}

function paintFilters() {
  const root = document.getElementById("filters");
  if (!root) return;
  const sources = [[0, "全部"], [1, "topic"], [2, "market"], [4, "awesome"], [8, "工坊"], [16, "dsh.so"], [32, "本机"]];
  const levels = [[0, "全部"], [5, "L5"], [4, "L4"], [3, "L3"], [2, "L2"], [1, "L1"]];
  const sorts = [["stars", "Star"], ["level", "等级"], ["downloads", "下载"], ["name", "名称"]];
  const orders = [["desc", "降序", "从高到低，名称从 Z 到 A"], ["asc", "升序", "从低到高，名称从 A 到 Z"]];
  const group = (label, html) => `<div class="seg-group"><span>${label}</span><div>${html}</div></div>`;
  const sortButtons = sorts.map(([value, label]) => segButton("sort", value, label, (state.sort || "stars") === value)).join("");
  const orderButtons = orders.map(([value, label, title]) => segButton("order", value, label, (state.order || "desc") === value, title)).join("");
  root.innerHTML = [
    group("来源", sources.map(([value, label]) => segButton("src", value, label, state.src === value)).join("")),
    group("等级", levels.map(([value, label]) => segButton("level", value, label, state.level === value)).join("")),
    group("排序", `${sortButtons}<span class="seg-gap"></span>${orderButtons}`),
  ].join("");
}

function fillCategories() {
  paintCats();
}

function categoryHit() {
  const needle = state.q.trim().toLowerCase();
  if (!needle || needle.includes(" ")) return null;
  return (getManifest()?.categories || []).find(([id]) => id !== "other" && (id === needle || catLabel(id).toLowerCase() === needle)) || null;
}

function paintHot() {
  const root = document.getElementById("hot-tags");
  const panel = document.getElementById("popular");
  if (!root || !panel) return;
  panel.classList.toggle("is-folded", !hotOpen);
  const fold = panel.querySelector("[data-act='hot-fold']");
  if (fold) fold.textContent = hotOpen ? "收起" : "展开";
  const q = state.q.trim().toLowerCase();
  const tags = (getManifest()?.categories || []).filter(([id]) => id && id !== "other").slice(0, 10);
  root.innerHTML = tags.map(([id], index) => {
    const label = catLabel(id);
    const on = q === label.toLowerCase() || q === String(id).toLowerCase();
    const rank = index + 1;
    const tone = rank <= 3 ? ` is-${rank}` : "";
    return `<button type="button" class="pop${on ? " is-on" : ""}" data-act="hot" data-q="${esc(label)}" aria-pressed="${on ? "true" : "false"}"><i class="rank${tone}">${rank}</i><span>${esc(label)}</span></button>`;
  }).join("");
}

function paintResults() {
  const root = document.getElementById("results");
  if (!root) return;
  const manifest = getManifest();
  const base = state.src === 32 ? localRows : getItems();
  const filtered = filterPlugins(base, state);
  const { page, pages, slice } = currentPage(filtered);
  const loading = !isLoaded() && state.src !== 32;
  const queryLabel = state.q.trim();
  const extra = Boolean(state.cat || state.src || state.level || (state.sort && state.sort !== "stars") || state.order === "asc");
  const filtering = Boolean(queryLabel || extra);
  const catName = state.cat ? catLabel(state.cat) : "";
  const hit = categoryHit();
  const suggest = hit && hit[0] !== state.cat
    ? `<button type="button" class="text-btn" data-act="use-cat" data-cat="${esc(hit[0])}">改看「${esc(catLabel(hit[0]))}」分类</button>`
    : "";
  const progress = loading
    ? `已载入 ${num(getItems().length)} / ${num(manifest?.total)}`
    : queryLabel
      ? `搜索：${esc(queryLabel)}${catName ? ` · ${esc(catName)}` : ""}　共 ${num(filtered.length)} 条结果`
      : `${catName ? `${esc(catName)} · ` : ""}${num(filtered.length)} 条`;
  const empty = loading ? "正在载入目录…" : `没有匹配的插件。${filtering ? "可以清除条件后再找。" : ""}`;
  const cancelQ = queryLabel ? `<button type="button" class="text-btn" data-act="clear-q">取消</button>` : "";
  const clear = extra ? `<button type="button" class="text-btn" data-act="reset">清除条件</button>` : "";
  root.innerHTML = `<div class="result-bar"><span>${progress}</span><span class="result-actions">${suggest}${cancelQ}${clear}<span>第 ${num(page)} / ${num(pages)} 页</span></span></div>
    <div class="grid">${slice.map(card).join("") || `<p class="empty">${empty}</p>`}</div>
    ${pager(page, pages)}`;
  renderedListKey = stateListKey();
  paintHot();
  if (settleFrame) cancelAnimationFrame(settleFrame);
  settleFrame = requestAnimationFrame(() => {
    settleFrame = 0;
    if (!document.body.classList.contains("is-market") || !document.getElementById("results")) return;
    const next = fitPageSize();
    if (next === fittedSize) return;
    fittedSize = next;
    paintResults();
  });
}

async function loadLocalRows() {
  localRows = [];
  const user = currentUser();
  if (!user || !globalThis.indexedDB) return;
  try {
    localRows = (await listUploads(user.id)).map(uploadToPlugin);
  } catch {
    localRows = [];
  }
}


function mountStage(stage) {
  if (!stage) return;
  const move = (event) => {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width * 2 - 1;
    const py = (event.clientY - rect.top) / rect.height * 2 - 1;
    stage.style.setProperty("--px", px.toFixed(3));
    stage.style.setProperty("--py", py.toFixed(3));
  };
  stage.addEventListener("pointermove", move);
}

async function renderMarket(my) {
  const manifest = await boot();
  await loadLocalRows();
  if (my !== token) return;
  app.innerHTML = `<section class="page">
    <section class="stage" id="stage">
      <div class="stage-scene" aria-hidden="true">
        <div class="stage-glow"></div>
        <i class="orb orb-a"></i>
        <i class="orb orb-b"></i>
        <div class="stage-floor"></div>
      </div>
      <p class="stage-news" id="catalog-note">${catalogNote(manifest)}</p>
    </section>
    <div class="market">
    <aside class="market-side">
    <form class="composer" id="seek-form">
      <input id="seek-q" type="search" placeholder="快速找到插件" autocomplete="off" aria-label="快速找到插件" aria-controls="seek-hits" aria-autocomplete="list" enterkeyhint="search">
      <button class="composer-go" type="submit" aria-label="搜索">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div id="seek-hits" class="seek-hits" role="listbox" hidden></div>
    </form>
    <section class="cat-board" id="cats" aria-label="分类">
      <div class="cat-head"><span>分类</span><span id="cat-status"></span></div>
      <label class="cat-find">
        <input id="cat-q" type="search" placeholder="找分类，如 浏览器、金融、Git" autocomplete="off" aria-label="找分类" enterkeyhint="search">
      </label>
      <div id="cat-body"></div>
      <p class="cat-empty" id="cat-empty" hidden>没有这个分类</p>
    </section>
    </aside>
    <div class="market-main">
    <div class="filter-strip" id="filters" aria-label="来源、等级和排序"></div>
    <div id="results"></div>
    </div>
    </div>
  </section>`;
  mountStage(document.getElementById("stage"));
  const catInput = document.getElementById("cat-q");
  catInput.value = catQuery;
  catInput.addEventListener("input", (event) => {
    catQuery = event.target.value;
    applyCatFilter();
  });
  catInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!catQuery) return;
      event.preventDefault();
      catQuery = "";
      event.target.value = "";
      applyCatFilter();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = [...document.querySelectorAll("#cat-body [data-cat-item]:not([hidden])")].find((item) => item.dataset.cat);
    if (first) first.click();
  });
  const seek = document.getElementById("seek-q");
  seek.value = state.q;
  seek.addEventListener("compositionstart", () => { composing = true; });
  seek.addEventListener("compositionend", (event) => {
    composing = false;
    applyQuery(event.target.value);
  });
  seek.addEventListener("input", (event) => {
    if (composing) return;
    seekPick = -1;
    applyQuery(event.target.value);
    paintSeekHits();
  });
  seek.addEventListener("focus", () => paintSeekHits());
  seek.addEventListener("keydown", (event) => {
    const hits = [...document.querySelectorAll("#seek-hits [data-seek-hit]")];
    if (event.key === "ArrowDown" && hits.length) {
      event.preventDefault();
      seekPick = Math.min(hits.length - 1, seekPick + 1);
      paintSeekHits();
      return;
    }
    if (event.key === "ArrowUp" && hits.length) {
      event.preventDefault();
      seekPick = Math.max(0, seekPick - 1);
      paintSeekHits();
      return;
    }
    if (event.key === "Enter" && seekPick >= 0 && hits[seekPick]) {
      event.preventDefault();
      hits[seekPick].click();
      return;
    }
    if (event.key === "Escape") {
      const box = document.getElementById("seek-hits");
      if (!box || box.hidden) return;
      event.preventDefault();
      box.hidden = true;
      seekPick = -1;
    }
  });
  document.getElementById("seek-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const picked = document.querySelector("#seek-hits [data-seek-hit].is-on");
    if (picked) {
      picked.click();
      return;
    }
    applyQuery(seek.value.trim(), true);
    paintSeekHits();
  });
  paintCats();
  paintFilters();
  paintResults();
  if (unsub) unsub();
  unsub = onProgress(() => paintResults());
  scrollList();
  ensureAll().then(() => {
    if (my === token) paintResults();
  }).catch((error) => {
    const root = document.getElementById("results");
    if (root && my === token) root.insertAdjacentHTML("afterbegin", `<p class="err">${esc(error.message)}</p>`);
  });
}

function uploadToPlugin(row) {
  const plugin = {
    id: row.id,
    name: row.name,
    desc: row.description || "",
    stars: 0,
    cat: "local",
    repo: null,
    npm: row.name,
    ver: row.version,
    install: `dsh plugin --profile web add ./${row.name}`,
    src: 32,
    level: 0,
    risk: 0,
    health: 0,
    downloads: null,
    lang: null,
    dsh: null,
    page: null,
    local: true,
    filename: row.filename,
    size: row.size,
  };
  plugin.q = [plugin.name, plugin.desc, plugin.npm, plugin.id].join("\n").toLowerCase();
  return plugin;
}

function factRow(plugin) {
  const cat = plugin.cat && plugin.cat !== "other" ? catLabel(plugin.cat) : "未分类";
  const items = [
    ["分类", cat],
    ["等级", plugin.level ? `L${plugin.level}` : "—", plugin.level ? "dsh.so 的标注，本站没有复验" : ""],
    ["风险", plugin.risk ? (RISK[plugin.risk] || "—") : "—"],
    ["语言", plugin.lang || "—"],
    ["版本", shownVersion(plugin) || "—"],
    ["Star", plugin.stars ? compact(plugin.stars) : "—", plugin.stars ? num(plugin.stars) : "", "fact-star"],
    ["下载", plugin.downloads ? compact(plugin.downloads) : "—", plugin.downloads ? num(plugin.downloads) : ""],
    ["状态", plugin.health ? (HEALTH[plugin.health] || "异常") : (plugin.repo ? "未见异常" : "—"), "", "", Boolean(plugin.health)],
  ];
  return `<dl class="fact-row">${items.map(([label, value, title, id, bad]) => `<div><dt>${esc(label)}</dt><dd${id ? ` id="${id}"` : ""}${title ? ` title="${esc(title)}"` : ""}${bad ? ` class="is-bad"` : ""}>${esc(value)}</dd></div>`).join("")}</dl>`;
}

function originSheet(plugin) {
  const repoUrl = githubUrl(plugin.repo);
  const page = safeUrl(plugin.page);
  const dsh = safeUrl(plugin.dsh);
  const npm = npmUrl(plugin.npm);
  const rows = [];
  const push = (label, html) => {
    if (html) rows.push(`<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`);
  };
  push("仓库", repoUrl ? `<a href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(plugin.repo)}</a>` : "");
  push("npm", npm ? `<a href="${esc(npm)}" target="_blank" rel="noopener noreferrer">${esc(plugin.npm)}</a>` : "");
  push("dsh.so", dsh ? `<a href="${esc(dsh)}" target="_blank" rel="noopener noreferrer">制品页</a>` : "");
  push("上游", page ? `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer">收录页</a>` : "");
  push("安装目标", plugin.install ? esc(addTarget(plugin.install)) : "");
  push("编号", plugin.id ? `<code>${esc(plugin.id)}</code>` : "");
  if (!rows.length) return "";
  return `<h2 class="install-title">原文和标识</h2><dl class="sheet">${rows.join("")}</dl>`;
}

const SOURCE_NOTE = {
  1: "GitHub 上带 dsh-plugin topic",
  2: "dshmarket.com 收录",
  4: "awesome-dsh-plugin 收录",
  8: "创意工坊收录",
  16: "dsh.so 制品页",
};

function sourceLines(plugin) {
  if (plugin.local) return `<li><b>本机</b><span>登录后上传的 zip，只存在这台浏览器。</span></li>`;
  const rows = SOURCE_LABEL
    .filter(([bit]) => plugin.src & bit)
    .map(([bit, label]) => `<li><b>${esc(label)}</b><span>${esc(SOURCE_NOTE[bit] || "")}</span></li>`);
  return rows.join("") || `<li><span>目录里没有来源标记。</span></li>`;
}

function shownDesc(text) {
  return String(text || "").replace(/:[a-z0-9_+-]+:/gi, " ").replace(/\s+/g, " ").trim();
}

function relatedHtml(plugin) {
  if (!plugin.cat || plugin.cat === "other" || plugin.cat === "local" || !getItems().length) return "";
  const related = getItems()
    .filter((item) => item.cat === plugin.cat && item.id !== plugin.id && item.health !== 1)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 4);
  if (!related.length) return "";
  const cards = related.map((item) => `<a class="relate" href="${esc(pluginHref(item.id))}">
      <header><strong>${esc(item.name)}</strong>${item.stars ? `<em>${esc(compact(item.stars))}</em>` : ""}</header>
      <p>${esc(shownDesc(item.desc) || item.repo || item.npm || "暂无简介")}</p>
    </a>`).join("");
  return `<h2 class="install-title">同分类</h2>
    <div class="relate-grid">${cards}</div>
    <p class="more-cat"><a href="#/market?cat=${esc(plugin.cat)}">查看全部${esc(catLabel(plugin.cat))}</a></p>`;
}

function pluginHtml(plugin) {
  const repoUrl = githubUrl(plugin.repo);
  const zip = repoUrl && ![1, 2, 3].includes(plugin.health) ? `${repoUrl}/archive/HEAD.zip` : "";
  const tgz = npmTgz(plugin.npm, plugin.ver);
  const cat = plugin.cat && plugin.cat !== "other" ? catLabel(plugin.cat) : "未分类";
  const warn = plugin.health ? `<p class="callout">${esc(HEALTH[plugin.health] || "源仓库异常")}</p>` : "";
  const links = [
    zip ? `<a class="btn btn-ghost" href="${esc(zip)}">仓库 zip</a>` : "",
    tgz ? `<a class="btn btn-ghost" href="${esc(tgz)}">npm 包</a>` : "",
    plugin.local ? `<button class="btn" type="button" data-act="dl-upload" data-id="${esc(plugin.id)}">下载 zip</button>` : "",
    repoUrl ? `<a class="btn btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : "",
    plugin.dsh ? `<a class="btn btn-ghost" href="${esc(safeUrl(plugin.dsh))}" target="_blank" rel="noopener noreferrer">dsh.so</a>` : "",
    plugin.page ? `<a class="btn btn-ghost" href="${esc(safeUrl(plugin.page))}" target="_blank" rel="noopener noreferrer">awesome</a>` : "",
    npmUrl(plugin.npm) ? `<a class="btn btn-ghost" href="${esc(npmUrl(plugin.npm))}" target="_blank" rel="noopener noreferrer">npm</a>` : "",
  ].join("");
  const repoLine = repoUrl
    ? `<a href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(plugin.repo)}</a>`
    : esc(plugin.npm || "没有公开仓库");
  const clipped = repoUrl && plugin.desc && plugin.desc.length >= 180 && /…$/.test(plugin.desc)
    ? `<p class="meta-line">目录简介被截短了，完整说明在下方仓库 README。</p>`
    : "";
  const readmeSlot = repoUrl
    ? `<p class="muted">正在读取仓库说明…</p>`
    : `<p class="muted">这条没有 GitHub 仓库。上面的简介、安装命令和原文链接就是目录里的全部信息。</p>`;
  return `<section class="page detail-page">
    <p class="crumb"><a href="${esc(marketHash())}">返回目录</a> / ${esc(cat)}</p>
    <header class="panel detail-hero">
      <h1>${esc(plugin.name)}</h1>
      <p class="lede">${esc(plugin.desc || "暂无简介")}</p>
      <p class="meta-line">${repoLine}</p>
      ${clipped}
      ${factRow(plugin)}
    </header>
    <div class="detail-grid">
      <article class="panel">
        <h2 class="install-title">装进 Web 或 Desktop</h2>
        ${installRows(plugin.install)}
        ${installGuide(plugin)}
        ${originSheet(plugin)}
        <h2 class="install-title">仓库说明</h2>
        <div id="repo-live" class="repo-live" data-repo="${esc(repoUrl)}" data-desc="${esc(plugin.desc || "")}">${readmeSlot}</div>
        ${relatedHtml(plugin)}
      </article>
      <aside class="side">
        ${warn}
        <div class="stats">
          <div class="stat"><b id="live-star">${plugin.stars ? esc(compact(plugin.stars)) : "—"}</b><span>Star</span></div>
          <div class="stat"><b>${plugin.downloads ? esc(compact(plugin.downloads)) : "—"}</b><span>下载</span></div>
          <div class="stat"><b>${esc(shownVersion(plugin) || "—")}</b><span>版本</span></div>
          <div class="stat"><b>${esc(plugin.lang || "—")}</b><span>语言</span></div>
        </div>
        <h2 class="side-title">收录来源</h2>
        <ul class="source-list">${sourceLines(plugin)}</ul>
        <div class="actions">${links}</div>
        <p class="drawer-note muted">${plugin.local ? "Web 在终端安装。Desktop 把解压目录的绝对路径粘进侧栏「插件 → 添加插件」。网页不会安装。" : `Web 用终端命令。Desktop 在侧栏「插件 → 添加插件」粘贴上面那一段，装完点「立即启用」。${zip ? "仓库 zip 只是源码。" : ""}${plugin.dsh ? "等级和风险来自 dsh.so，本站没有复验。" : ""}`}</p>
      </aside>
    </div>
  </section>`;
}

async function renderPlugin(my, id) {
  if (!id) {
    app.innerHTML = `<section class="page panel"><h1>没有这个插件</h1><p><a href="#/market">返回目录</a></p></section>`;
    return;
  }
  await boot();
  let plugin = getById(id);
  if (!plugin && currentUser() && globalThis.indexedDB) {
    await loadLocalRows();
    plugin = localRows.find((item) => item.id === id) || null;
  }
  if (!plugin) {
    await ensureAll();
    if (my !== token) return;
    plugin = getById(id);
  }
  if (my !== token) return;
  if (!plugin) {
    app.innerHTML = `<section class="page panel"><h1>没有这个插件</h1><p><a href="#/market">返回目录</a></p></section>`;
    return;
  }
  document.title = `${plugin.name} · DSH Plugins`;
  app.innerHTML = pluginHtml(plugin);
  scrollList();
  loadRemote(plugin);
}

function sourceRows(manifest) {
  const up = manifest.upstream || {};
  const rows = [
    ["GitHub topic", manifest.withBit?.topic, manifest.input?.topic, "搜索窗口最多 1000 条"],
    ["dshmarket", manifest.withBit?.market, manifest.input?.market, "format 1"],
    ["awesome", manifest.withBit?.awesome, manifest.input?.awesome, `${up.awesome?.license || "CC0"} · ${up.awesome?.updated || ""}`],
    ["创意工坊", manifest.withBit?.workshop, manifest.input?.workshop, day(up.workshop?.fetchedAt)],
    ["dsh.so", manifest.withBit?.dshso, manifest.input?.dshso, `${up.dshso?.license || "CC BY 4.0"} · ${day(up.dshso?.generatedAt)}`],
  ];
  return rows.map(([name, kept, raw, note]) => `<tr><td>${esc(name)}</td><td>${num(kept)}</td><td>${num(raw)}</td><td>${esc(note)}</td></tr>`).join("");
}

async function renderAbout(my) {
  const manifest = await boot();
  if (my !== token) return;
  const up = manifest.upstream || {};
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>关于这个目录</h1>
      <p class="lede">把 GitHub topic、dshmarket、awesome-dsh-plugin、创意工坊和 dsh.so 收成一份目录。同一个仓库只留一条。页面会核对源站指纹，有变化可以马上同步；站点每小时也会重新构建。当前快照 ${esc(day(manifest.builtAt))}。</p>
    </div>
    <article class="panel">
      <h2>来源</h2>
      <table class="table">
        <thead><tr><th>来源</th><th>去重后收录</th><th>原始记录</th><th>说明</th></tr></thead>
        <tbody>${sourceRows(manifest)}</tbody>
      </table>
      <p class="muted">只出现在 dsh.so 的有 ${num(manifest.only?.dshso)} 条。dsh.so 署名：${esc(up.dshso?.attribution || "dsh.so — DSH Developer Hub (https://www.dsh.so)")}。整库再分发请先联系 hello@dsh.so。</p>
    </article>
    <div class="cols" style="margin-top:14px">
      <article class="panel">
        <h2>安装</h2>
        <p>Web 在终端装。Desktop 在应用侧栏「插件」里装，应用保持打开。这个网站不会安装，两边也不互通。</p>
        <div class="install"><span class="install-tag">Web</span><code>dsh plugin --profile web add github:owner/repo</code></div>
        <div class="install"><span class="install-tag">Desktop</span><code>侧栏「插件」→ 添加插件，粘贴 github:owner/repo</code></div>
        <p class="muted">npm 包把地址换成包名。装完点「立即启用」。页面若提示要重启，再完全退出后重新打开；关窗口只是隐藏。设置里的插件列表不能安装。npm 的 dsh 和 npx 改不了 desktop。只有应用菜单「管理 dsh 命令…」装上的 dsh，才能在完全退出后执行 dsh plugin --profile desktop add。仓库 zip 只是源码。</p>
      </article>
      <article class="panel">
        <h2>本机账号</h2>
        <p>登录只保存在这台浏览器里，用来存放自己上传的 zip。密码以 PBKDF2 哈希保存，不会同步到其他设备，也不会进入公开目录。</p>
        <p><a class="btn" href="#/account">登录或注册</a></p>
      </article>
    </div>
  </section>`;
}

function renderAccount() {
  const user = currentUser();
  if (user) {
    app.innerHTML = `<section class="page">
      <div class="page-head"><h1>账号</h1></div>
      <article class="panel">
        <p>${esc(user.name)} · ${esc(user.email)}</p>
        <div class="actions">
          <a class="btn" href="#/local">本机插件</a>
          <button class="btn btn-ghost" type="button" data-act="logout">退出</button>
          <button class="btn btn-ghost" type="button" data-act="wipe">清除本机数据</button>
        </div>
        <p class="muted">退出只结束这次会话。清除会删掉这台浏览器里的账号和上传的包，不能找回。</p>
      </article>
    </section>`;
    return;
  }
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>登录</h1>
      <p class="lede">账号只存在这台浏览器。换浏览器或清除站点数据后需要重新注册。</p>
    </div>
    <div class="auth-grid">
      <form class="panel stack" data-form="login">
        <h2>登录</h2>
        <input name="email" type="email" autocomplete="email" placeholder="邮箱" required aria-label="邮箱">
        <input name="password" type="password" autocomplete="current-password" placeholder="密码" required aria-label="密码">
        <button class="btn" type="submit">登录</button>
        <p data-note class="err"></p>
      </form>
      <form class="panel stack" data-form="register">
        <h2>注册</h2>
        <input name="name" autocomplete="nickname" placeholder="显示名" required aria-label="显示名">
        <input name="email" type="email" autocomplete="email" placeholder="邮箱" required aria-label="邮箱">
        <input name="password" type="password" autocomplete="new-password" placeholder="密码，至少 8 位" required minlength="8" aria-label="密码">
        <input name="confirm" type="password" autocomplete="new-password" placeholder="再输入一次密码" required aria-label="确认密码">
        <button class="btn" type="submit">注册</button>
        <p data-note class="err"></p>
      </form>
    </div>
  </section>`;
}

async function renderLocal(my) {
  const user = currentUser();
  if (!user) {
    app.innerHTML = `<section class="page panel">
      <h1>本机插件</h1>
      <p>上传的 zip 只保存在这台浏览器，不会进入公开目录。</p>
      <p><a class="btn" href="#/account">登录后上传</a></p>
    </section>`;
    return;
  }
  let rows = [];
  if (globalThis.indexedDB) {
    try { rows = await listUploads(user.id); } catch { rows = []; }
  }
  if (my !== token) return;
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>本机插件</h1>
      <p class="lede">zip 存在这台浏览器里，可以再下载。公开目录不会出现这些包。</p>
    </div>
    <label class="drop">
      <input data-act="upload" type="file" accept=".zip,application/zip">
      <strong>放下 zip，或点这里选择</strong>
      <span class="muted">根目录或第一层要有 package.json，最大 20MB</span>
    </label>
    <p id="upload-note" class="err">${esc(flash)}</p>
    <div class="list">${rows.map((row) => `<article>
      <div><strong>${esc(row.name)}@${esc(row.version)}</strong><p class="muted">${esc(row.description || "暂无简介")} · ${num(Math.ceil((row.size || 0) / 1024))} KB</p></div>
      <div class="actions">
        <a class="btn btn-ghost" href="#/plugin?id=${encodeURIComponent(row.id)}">查看</a>
        <button class="btn" type="button" data-act="dl-upload" data-id="${esc(row.id)}">下载</button>
        <button class="btn btn-ghost" type="button" data-act="del-upload" data-id="${esc(row.id)}">删除</button>
      </div>
    </article>`).join("") || `<p class="empty">还没有上传。</p>`}</div>
  </section>`;
  flash = "";
}

function renderNotFound() {
  app.innerHTML = `<section class="page panel"><h1>没有这一页</h1><p><a href="#/market">返回目录</a></p></section>`;
}

function stateListKey() {
  const hash = marketHash();
  const cut = hash.indexOf("?");
  return catalogListKey(new URLSearchParams(cut === -1 ? "" : hash.slice(cut + 1)));
}

function scrollList() {
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const results = document.getElementById("results");
  if (document.body.classList.contains("is-market") && results) {
    results.scrollTo({ top: 0, behavior });
    return;
  }
  window.scrollTo({ top: 0, behavior });
}

function paintCatalogShell(params) {
  applyMarketParams(params);
  syncSearch();
  markNav("/market");
  renderSession();
  paintCats();
  paintFilters();
  paintResults();
  document.title = "目录 · DSH Plugins";
}

async function draw() {
  const route = readRoute();
  const path = route.path;
  const params = route.params;
  document.body.classList.toggle("is-market", isCatalog(path));
  const top = document.querySelector(".top");
  if (top) document.documentElement.style.setProperty("--top-h", `${Math.ceil(top.getBoundingClientRect().height)}px`);
  if (isCatalog(path) && params.get("id")) {
    const id = params.get("id");
    const next = new URLSearchParams(params);
    next.delete("id");
    const query = next.toString();
    location.replace(`#/plugin?id=${encodeURIComponent(id)}${query ? `&${query}` : ""}`);
    return;
  }
  if (isCatalog(path) && document.getElementById("results")) {
    if (catalogListKey(params) === renderedListKey) {
      syncSearch();
      markNav(path);
      renderSession();
      document.title = "目录 · DSH Plugins";
      return;
    }
    paintCatalogShell(params);
    scrollList();
    return;
  }
  const my = ++token;
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (isCatalog(path) || path.startsWith("/plugin")) applyMarketParams(params);
  syncSearch();
  markNav(path);
  renderSession();
  const titles = { "/market": "目录", "/about": "关于", "/local": "本机", "/account": "账号" };
  document.title = `${titles[navKey(path)] || "目录"} · DSH Plugins`;
  try {
    if (isCatalog(path)) await renderMarket(my);
    else if (navKey(path) === "/about") await renderAbout(my);
    else if (navKey(path) === "/local") await renderLocal(my);
    else if (path === "/account") renderAccount();
    else if (path.startsWith("/plugin")) await renderPlugin(my, params.get("id"));
    else renderNotFound();
  } catch (error) {
    if (my !== token) return;
    document.body.classList.remove("is-market");
    app.innerHTML = `<section class="page panel"><h1>页面没有打开</h1><p class="err">${esc(error.message || "未知错误")}</p></section>`;
  }
}


function catalogNote(manifest) {
  const when = day(manifest?.builtAt);
  if (manifest?.live) return `${num(manifest.total)} 条插件，刚刚与源站同步。Star 是 GitHub 星标，不是安装量。`;
  return `${num(manifest?.total)} 条插件，构建于 ${when || "未知"}。Star 是 GitHub 星标，不是安装量。`;
}

function shownVersion(plugin) {
  if (plugin.ver) return String(plugin.ver);
  const match = String(plugin.install || "").match(/@(\d+\.\d+\.\d+[0-9A-Za-z.-]*)$/);
  return match ? match[1] : "";
}

function installGuide(plugin) {
  const github = String(plugin.install || "").includes(" github:");
  const web = plugin.local
    ? [
        "先下载 zip 并解压。这个网页不会把它装进 DSH。",
        "在解压目录的上一级执行上面的 Web 命令。",
        "重新运行 dsh web。终端里没有 dsh 时，在命令前加 npx @deepseek-ai/dsh。",
      ]
    : [
        "复制上面的 Web 命令，到终端执行。",
        "执行完重新运行 dsh web。",
        "终端里没有 dsh 时，在命令前加 npx @deepseek-ai/dsh。这条不能用来装 Desktop。",
      ];
  const desktop = plugin.local
    ? [
        "应用保持打开。左侧「插件」点「添加插件」。",
        "把解压目录的绝对路径粘进去，再点「安装」。不要粘贴 ./目录名。",
        "装完点「立即启用」。若提示需要重启，再完全退出后重新打开。关窗口只是隐藏。",
      ]
    : [
        "应用保持打开。左侧「插件」点「添加插件」，不要去「设置」里装。",
        "把上面 Desktop 那一行粘进去，再点「安装」。",
        "装完点「立即启用」。若提示需要重启，再完全退出后重新打开。不要用 npm 或 npx 的 dsh 执行 --profile desktop。",
      ];
  const notes = ["Desktop 的命令行只认应用菜单「管理 dsh 命令…」装上的 dsh，而且要先完全退出，关窗口不算。Web 和 Desktop 各有一份，不互通。"];
  if (github) notes.unshift("这是从 GitHub 安装源码。如果提示要允许构建，只在信任这个仓库时允许，然后把命令再执行一次。");
  if (!plugin.local && plugin.repo) notes.push("「仓库 zip」只是源码压缩包，不能代替上面的安装命令。");
  const column = (title, steps) => `<section class="install-board"><h3>${title}</h3><ol class="how">${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol></section>`;
  return `<div class="install-boards">${column("Web", web)}${column("Desktop", desktop)}</div>
    <p class="drawer-note muted">${notes.map(esc).join("<br>")}</p>`;
}


function readmeHref(url, repoUrl) {
  const raw = String(url || "").trim();
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return safeUrl(raw);
  if (!repoUrl || raw.includes("..")) return "";
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  const path = (hashAt === -1 ? raw : raw.slice(0, hashAt)).replace(/^\.\//, "").replace(/^\/+/, "");
  if (!path) return "";
  return safeUrl(`${repoUrl}/blob/HEAD/${path}${hash}`);
}

function inlineReadme(text, repoUrl) {
  const re = /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let html = "";
  let last = 0;
  for (const match of text.matchAll(re)) {
    html += esc(text.slice(last, match.index));
    if (match[1]) html += `<code>${esc(match[1].slice(1, -1))}</code>`;
    else if (match[3] && match[2] != null && !match[4]) html += "";
    else if (match[5]) {
      const url = readmeHref(match[5], repoUrl);
      html += url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(match[4])}</a>` : esc(match[4]);
    } else if (match[6]) html += `<strong>${inlineReadme(match[6], repoUrl)}</strong>`;
    last = match.index + match[0].length;
  }
  html += esc(text.slice(last));
  return html;
}

function readableSource(raw) {
  let text = String(raw || "").replace(/\r\n/g, "\n");
  if (!/<\/?[a-z][\s\S]*?>/i.test(text)) return text;
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a\s+[^>]*href="https?:\/\/[^"]+"[^>]*>\s*<img\b[\s\S]*?<\/a>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-3])[^>]*>/gi, (_, level) => `\n${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const name = label.replace(/<[^>]+>/g, "").trim();
      return name ? `[${name}](${href})` : "";
    })
    .replace(/<\/?code[^>]*>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text;
}

function stripBadges(text) {
  let out = text;
  let prev = "";
  const badge = /\[!\[[^\]]*\]\([^)\n]*\)\]\([^)\n]*\)|!\[[^\]]*\]\([^)\n]*\)/g;
  while (out !== prev) {
    prev = out;
    badge.lastIndex = 0;
    out = out.replace(badge, "");
  }
  return out.replace(/\[\]\([^)\n]*\)/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function isLinkDump(lines) {
  const raw = lines.join("\n");
  const links = raw.match(/\]\(/g) || [];
  if (links.length < 4) return false;
  const rest = raw.replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/[\s·|*#\-_*]/g, "");
  return rest.length < 16;
}

function linkDumpTitle(lines) {
  const hrefs = [...lines.join("\n").matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
  return hrefs.length && hrefs.every((href) => href.startsWith("#")) ? "本页目录" : "更多链接";
}

function renderReadme(raw, repoUrl) {
  const text = stripBadges(readableSource(raw)).slice(0, 14000);
  const blocks = text.split("```");
  return blocks.map((block, index) => {
    if (index % 2 === 1) {
      const nl = block.indexOf("\n");
      const code = nl === -1 ? block : block.slice(nl + 1);
      return `<pre class="readme-code">${esc(code.replace(/\n$/, ""))}</pre>`;
    }
    return block.split(/\n{2,}/).map((para) => {
      const lines = para.split("\n").filter((line) => line.trim());
      if (!lines.length) return "";
      if (isLinkDump(lines)) {
        return `<details class="readme-more"><summary>${linkDumpTitle(lines)}</summary><p>${inlineReadme(lines.join(" "), repoUrl)}</p></details>`;
      }
      if (lines.every((line) => /^>\s?/.test(line))) {
        const body = lines
          .map((line) => line.replace(/^>\s?/, "").replace(/^\[!(IMPORTANT|NOTE|WARNING|TIP)\]\s*/, ""))
          .filter(Boolean);
        return `<div class="readme-note">${body.map((line) => `<p>${inlineReadme(line, repoUrl)}</p>`).join("")}</div>`;
      }
      const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
      if (heading) return `<h${heading[1].length + 2}>${inlineReadme(heading[2], repoUrl)}</h${heading[1].length + 2}>`;
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inlineReadme(line.replace(/^\s*[-*]\s+/, ""), repoUrl)}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map((line) => inlineReadme(line, repoUrl)).join("<br>")}</p>`;
    }).join("");
  }).join("");
}

function remoteFacts(slot, data) {
  const catalog = slot.dataset.desc || "";
  const about = data.about && !catalog.includes(String(data.about).slice(0, 48))
    ? `<p class="repo-about">${esc(data.about)}</p>`
    : "";
  const pills = [];
  if (data.forks != null) pills.push(`<span class="pill">Fork ${esc(compact(data.forks))}</span>`);
  if (data.issues != null) pills.push(`<span class="pill">${esc(num(data.issues))} 个开放 issue</span>`);
  if (data.license) pills.push(`<span class="pill">${esc(data.license)}</span>`);
  if (data.branch) pills.push(`<span class="pill">${esc(data.branch)}</span>`);
  if (data.created) pills.push(`<span class="pill">创建于 ${esc(day(data.created))}</span>`);
  if (data.homepage) pills.push(`<a class="pill" href="${esc(data.homepage)}" target="_blank" rel="noopener noreferrer">项目主页</a>`);
  for (const topic of data.topics || []) pills.push(`<span class="pill">${esc(topic)}</span>`);
  const row = pills.length ? `<div class="repo-facts">${pills.join("")}</div>` : "";
  return `${about}${row}`;
}

function paintRemote(slot, data) {
  const star = document.getElementById("live-star");
  const factStar = document.getElementById("fact-star");
  if (data.stars != null) {
    const text = compact(data.stars);
    if (star) star.textContent = text;
    if (factStar) {
      factStar.textContent = text;
      factStar.title = num(data.stars);
    }
  }
  const when = data.pushed ? `仓库更新于 ${esc(day(data.pushed))}` : "说明来自 GitHub";
  const facts = remoteFacts(slot, data);
  const body = data.readme
    ? `<div class="readme"><p class="muted">${when}</p>${renderReadme(data.readme, slot.dataset.repo || "")}</div>`
    : `<p class="muted">${when}。仓库没有可读取的 README。</p>`;
  slot.innerHTML = `${facts}${body}`;
  const readme = slot.querySelector(".readme");
  if (readme && readme.scrollHeight > 760) {
    readme.classList.add("is-clipped");
    slot.insertAdjacentHTML("beforeend", `<button type="button" class="btn btn-ghost readme-toggle" data-act="readme-more">展开全文</button>`);
  }
}

async function loadRemote(plugin) {
  const slot = document.getElementById("repo-live");
  const repoUrl = githubUrl(plugin.repo);
  if (!slot || !repoUrl) return;
  const mine = ++remoteToken;
  const cacheKey = `dsh-repo:5:${plugin.repo}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      if (mine === remoteToken && slot.isConnected) paintRemote(slot, cached);
      return;
    }
  } catch {
    // Ignore a broken cache.
  }
  const [owner, name] = plugin.repo.split("/");
  try {
    const [repoResponse, readmeResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
        headers: { accept: "application/vnd.github+json" },
      }),
      fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`, {
        headers: { accept: "application/vnd.github.raw" },
      }),
    ]);
    if (mine !== remoteToken || !slot.isConnected) return;
    if (repoResponse.status === 403 || repoResponse.status === 429) {
      slot.innerHTML = `<p class="muted">GitHub 暂时限制读取。可以打开仓库查看最新说明。</p>`;
      return;
    }
    const repo = repoResponse.ok ? await repoResponse.json() : null;
    const readme = readmeResponse.ok ? readableSource(await readmeResponse.text()).slice(0, 14000) : "";
    const license = repo?.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION"
      ? repo.license.spdx_id
      : (repo?.license?.name || "");
    const data = {
      pushed: repo?.pushed_at || "",
      created: repo?.created_at || "",
      stars: repo?.stargazers_count ?? null,
      forks: repo?.forks_count ?? null,
      issues: repo?.open_issues_count ?? null,
      license,
      homepage: safeUrl(repo?.homepage || ""),
      topics: Array.isArray(repo?.topics) ? repo.topics.slice(0, 8) : [],
      about: String(repo?.description || "").slice(0, 280),
      branch: repo?.default_branch || "",
      readme,
      at: Date.now(),
    };
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
    if (mine === remoteToken && slot.isConnected) paintRemote(slot, data);
  } catch {
    if (mine === remoteToken && slot.isConnected) slot.innerHTML = `<p class="muted">仓库说明暂时没有读到。</p>`;
  }
}

function setFresh(message, action) {
  const bar = document.getElementById("fresh");
  if (!bar) return;
  bar.hidden = !message;
  bar.innerHTML = message
    ? `<span>${esc(message)}</span>${action || ""}`
    : "";
}

function syncButton(label = "同步最新") {
  return `<button type="button" class="btn" data-act="sync">${label}</button>`;
}

function cancelButton() {
  return `<button type="button" class="btn btn-ghost" data-act="cancel-sync">取消</button>`;
}

async function syncNow() {
  if (syncing) return;
  syncing = true;
  setFresh("正在从四个源站同步…", cancelButton());
  try {
    const { pullLive } = await import("./live.js?v=20261029t");
    const { items, stamps } = await pullLive((message) => setFresh(message, cancelButton()));
    const builtAt = new Date().toISOString();
    replaceItems(items, builtAt);
    const manifest = getManifest();
    if (manifest?.upstream) {
      for (const [key, stamp] of Object.entries(stamps)) {
        manifest.upstream[key] = { ...(manifest.upstream[key] || {}), ...stamp };
      }
    }
    fillCategories();
    const note = document.getElementById("catalog-note");
    if (note && manifest) note.textContent = catalogNote(manifest);
    const route = readRoute();
    if (route.path.startsWith("/plugin")) {
      const current = getById(route.params.get("id") || "");
      if (current && document.querySelector(".detail-page")) {
        document.title = `${current.name} · DSH Plugins`;
        app.innerHTML = pluginHtml(current);
        loadRemote(current);
      }
    } else paintResults();
    setFresh(`已同步 ${num(items.length)} 条，更新于 ${day(builtAt)}。`, syncButton("再次同步"));
  } catch (error) {
    if (error?.name === "AbortError") setFresh("同步已取消。", syncButton());
    else setFresh(error.message || "同步没有完成。", syncButton("重试"));
  } finally {
    syncing = false;
  }
}

async function watchSources() {
  if (syncing) return;
  const manifest = await boot();
  const button = syncButton();
  const age = Date.now() - Date.parse(manifest.builtAt || "");
  const stale = !manifest.live && Number.isFinite(age) && age > 2 * 60 * 60 * 1000;
  if (!manifest.live) {
    setFresh(stale
      ? `构建于 ${day(manifest.builtAt) || "未知"}，已经不是最新。`
      : `构建于 ${day(manifest.builtAt) || "未知"}。源站有变化时可以马上同步。`, button);
  }
  const { probeSources } = await import("./live.js?v=20261029t");
  const changed = await probeSources(manifest.upstream);
  if (syncing) return;
  if (changed.length) setFresh(`源站有更新：${changed.join("、")}。`, syncButton("立即同步"));
  else if (manifest.live) setFresh(`已与源站一致，${num(manifest.total)} 条。`, button);
}

async function copyText(text) {

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

async function ingest(file) {
  const note = document.getElementById("upload-note");
  const user = currentUser();
  if (!user) throw new Error("请先登录");
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) throw new Error("zip 超过 20MB");
  if (note) note.textContent = "正在读取包…";
  const meta = await readPackageJson(file);
  await saveUpload(user.id, meta, file);
  flash = `已保存 ${meta.name}@${meta.version}`;
  await draw();
}

function paintSeekHits() {
  const box = document.getElementById("seek-hits");
  const input = document.getElementById("seek-q");
  if (!box || !input) return;
  const query = input.value.trim();
  input.setAttribute("aria-expanded", query && document.activeElement === input ? "true" : "false");
  if (!query || document.activeElement !== input) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const base = state.src === 32 ? localRows : getItems();
  const hits = filterPlugins(base, { q: query, sort: "stars" }).slice(0, 6);
  if (seekPick >= hits.length) seekPick = hits.length - 1;
  if (!hits.length) {
    box.hidden = false;
    box.innerHTML = `<p class="seek-empty">没有直接匹配，换个名字或仓库再试。</p>`;
    return;
  }
  box.hidden = false;
  box.innerHTML = hits.map((plugin, index) => `<a class="seek-hit${index === seekPick ? " is-on" : ""}" role="option" aria-selected="${index === seekPick ? "true" : "false"}" data-seek-hit="${index}" href="${esc(pluginHref(plugin.id))}"><span><strong>${hi(plugin.name)}</strong><small>${esc(plugin.repo || plugin.npm || catLabel(plugin.cat) || "")}</small></span><em>${plugin.stars ? esc(compact(plugin.stars)) : ""}</em></a>`).join("");
}

function applyQuery(value, immediate = false) {
  state.q = value;
  state.page = 1;
  syncSearch();
  const run = () => {
    if (!isCatalog(readRoute().path)) return;
    const next = marketHash();
    if (location.hash !== next) history.replaceState(null, "", next);
    paintResults();
  };
  clearTimeout(queryTimer);
  if (immediate) run();
  else queryTimer = setTimeout(run, 160);
}

document.getElementById("quick-find")?.addEventListener("click", () => {
  const input = document.getElementById("seek-q");
  if (!input) return;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
});

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#seek-form")) return;
  const box = document.getElementById("seek-hits");
  if (!box || box.hidden) return;
  box.hidden = true;
  seekPick = -1;
  const input = document.getElementById("seek-q");
  if (input) input.setAttribute("aria-expanded", "false");
});

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || button.disabled) return;
  const act = button.dataset.act;
  if (act === "readme-more") {
    event.preventDefault();
    document.querySelector(".readme")?.classList.remove("is-clipped");
    button.remove();
  }
  if (act === "hot-fold") {
    event.preventDefault();
    hotOpen = !hotOpen;
    paintHot();
  }
  if (act === "hot") {
    event.preventDefault();
    const next = button.dataset.q || "";
    const same = state.q.trim().toLowerCase() === next.toLowerCase();
    applyQuery(same ? "" : next, true);
  }
  if (act === "clear-q") {
    event.preventDefault();
    if (isCatalog(readRoute().path)) applyQuery("", true);
    else {
      state.q = "";
      syncSearch();
    }
  }
  if (act === "cat" || act === "src" || act === "level" || act === "sort" || act === "order") {
    event.preventDefault();
    if (act === "cat") {
      const nextCat = button.dataset.cat || "";
      state.cat = state.cat === nextCat ? "" : nextCat;
      catQuery = "";
      const input = document.getElementById("cat-q");
      if (input) input.value = "";
    }
    if (act === "src") state.src = Number(button.dataset.value);
    if (act === "level") state.level = Number(button.dataset.value);
    if (act === "sort") state.sort = ["level", "downloads", "name"].includes(button.dataset.value) ? button.dataset.value : "stars";
    if (act === "order") state.order = button.dataset.value === "asc" ? "asc" : "desc";
    state.page = 1;
    const next = marketHash();
    if (location.hash !== next) location.hash = next;
    else {
      if (act === "cat") paintCats();
      else paintFilters();
      paintResults();
    }
  }
  if (act === "use-cat") {
    event.preventDefault();
    state.cat = button.dataset.cat || "";
    state.q = "";
    state.page = 1;
    syncSearch();
    const next = marketHash();
    if (location.hash !== next) location.hash = next;
    else paintCatalogShell(readRoute().params);
  }
  if (act === "reset") {
    event.preventDefault();
    state.q = "";
    state.cat = "";
    state.src = 0;
    state.level = 0;
    state.sort = "stars";
    state.order = "desc";
    state.page = 1;
    syncSearch();
    const next = marketHash();
    if (location.hash !== next) location.hash = next;
    else paintCatalogShell(readRoute().params);
  }
  if (act === "sync") {
    event.preventDefault();
    await syncNow();
  }
  if (act === "cancel-sync") {
    event.preventDefault();
    const { cancelPull } = await import("./live.js?v=20261029t");
    cancelPull();
  }
  if (act === "copy") {
    event.preventDefault();
    await copyText(button.dataset.copy || "");
    const old = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => { button.textContent = old; }, 1200);
  }
  if (act === "page") {
    state.page = Number(button.dataset.page);
    const next = marketHash();
    if (location.hash !== next) location.hash = next;
    else {
      paintResults();
      scrollList();
    }
  }
  if (act === "logout") {
    event.preventDefault();
    logout();
    location.hash = "#/account";
    await draw();
  }
  if (act === "wipe") {
    event.preventDefault();
    if (confirm("会删掉这台浏览器里的账号和上传的包。")) {
      wipeLocal();
      await draw();
    }
  }
  if (act === "del-upload") {
    event.preventDefault();
    const user = currentUser();
    if (!user) return;
    await removeUpload(button.dataset.id, user.id);
    await draw();
  }
  if (act === "dl-upload") {
    event.preventDefault();
    const user = currentUser();
    if (!user) return;
    const row = await getUpload(button.dataset.id, user.id);
    if (!row?.blob) return;
    const url = URL.createObjectURL(row.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = row.filename || `${row.name}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
});

document.body.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "market-filters") return;
  if (kind === "jump") {
    const raw = Number(new FormData(form).get("page"));
    if (!Number.isFinite(raw) || raw < 1) return;
    state.page = Math.floor(raw);
    const next = marketHash();
    if (location.hash !== next) location.hash = next;
    else paintResults();
    return;
  }
  const note = form.querySelector("[data-note]");
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const data = new FormData(form);
    if (kind === "login") await login(data.get("email"), data.get("password"));
    if (kind === "register") {
      await register({
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        confirm: data.get("confirm"),
      });
    }
    location.hash = kind === "register" ? "#/local" : "#/market";
    await draw();
  } catch (error) {
    if (note) note.textContent = error.message || "没有完成";
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});

document.body.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.dataset.act !== "upload") return;
  const file = input.files?.[0];
  input.value = "";
  try {
    await ingest(file);
  } catch (error) {
    const note = document.getElementById("upload-note");
    if (note) note.textContent = error.message || "没有读成";
  }
});

document.body.addEventListener("dragover", (event) => {
  if (event.target.closest(".drop")) event.preventDefault();
});

document.body.addEventListener("drop", async (event) => {
  if (!event.target.closest(".drop")) return;
  event.preventDefault();
  try {
    await ingest(event.dataTransfer?.files?.[0]);
  } catch (error) {
    const note = document.getElementById("upload-note");
    if (note) note.textContent = error.message || "没有读成";
  }
});

window.addEventListener("hashchange", () => { draw(); });
window.addEventListener("resize", () => {
  if (!document.body.classList.contains("is-market") || !document.getElementById("results")) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const next = fitPageSize();
    if (next === fittedSize) return;
    paintResults();
  }, 140);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && readRoute().path.startsWith("/plugin")) {
    if (/input|textarea|select/i.test(event.target.tagName)) return;
    event.preventDefault();
    location.hash = marketHash();
    return;
  }
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (/input|textarea|select/i.test(event.target.tagName)) return;
  const input = document.getElementById("seek-q");
  if (!input) return;
  event.preventDefault();
  input.focus();
});

if (!location.hash || location.hash === "#/") location.replace("#/market");
draw();
syncNow().catch(() => {});
setInterval(() => { watchSources().catch(() => {}); }, 3 * 60 * 1000);
