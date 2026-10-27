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
} from "./catalog.js?v=20261028d";
import { readPackageJson } from "./zip.js?v=20261027";

const app = document.querySelector("#app");
const state = { q: "", cat: "", src: 0, level: 0, sort: "stars", page: 1, open: "" };
const pageSize = 24;
let token = 0;
let unsub = null;
let flash = "";
let localRows = [];
let renderedListKey = "";
let syncing = false;
let queryTimer = 0;
let composing = false;
let remoteToken = 0;
let catQuery = "";

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
  if (state.page > 1) params.set("page", String(state.page));
  if (state.open) params.set("id", state.open);
  const query = params.toString();
  return query ? `#/market?${query}` : "#/market";
}

function applyMarketParams(params) {
  state.q = params.get("q") || "";
  state.cat = params.get("cat") || "";
  state.src = Number(params.get("src") || 0);
  state.level = Number(params.get("lv") || 0);
  state.sort = params.get("sort") || "stars";
  state.page = Math.max(1, Number(params.get("page") || 1) || 1);
  state.open = params.get("id") || "";
}

function navKey(path) {
  if (path.startsWith("/plugin") || isCatalog(path)) return "/market";
  if (path === "/insights" || path === "/guide" || path === "/about") return "/about";
  if (path === "/publish" || path === "/local") return "/local";
  return path || "/market";
}

function syncSearch() {
  const input = document.getElementById("top-q");
  if (input && input.value !== state.q) input.value = state.q;
  const clear = document.getElementById("top-clear");
  if (clear) clear.hidden = !state.q;
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

function openHref(id) {
  const previous = state.open;
  state.open = id;
  const href = marketHash();
  state.open = previous;
  return href;
}

function card(plugin) {
  const repo = plugin.repo || plugin.npm || "";
  const cat = plugin.cat && plugin.cat !== "other" ? `<span class="pill">${hi(catLabel(plugin.cat))}</span>` : "";
  const health = plugin.health ? `<span class="pill pill-risk">${esc(HEALTH[plugin.health] || "异常")}</span>` : "";
  const sources = plugin.local ? `<span class="pill">本机</span>` : sourcePills(plugin.src);
  const open = state.open === plugin.id ? " is-open" : "";
  return `<a class="card${plugin.health === 1 ? " is-dead" : ""}${open}" href="${esc(openHref(plugin.id))}">
    <header><h3>${hi(plugin.name)}</h3>${plugin.stars ? `<em class="stars">${esc(compact(plugin.stars))}</em>` : ""}</header>
    ${repo ? `<p class="repo">${hi(repo)}</p>` : ""}
    <p class="desc">${hi(plugin.desc || "暂无简介")}</p>
    <footer>${cat}${levelChip(plugin)}${riskChip(plugin)}${health}${sources}</footer>
  </a>`;
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

function currentPage(filtered) {
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const ready = isLoaded() || state.src === 32;
  let page = state.page;
  if (ready && page > pages) {
    page = pages;
    state.page = page;
    const next = marketHash();
    if (location.hash !== next) history.replaceState(null, "", next);
  }
  const shown = Math.min(page, pages);
  const start = (shown - 1) * pageSize;
  return { page: shown, pages, slice: filtered.slice(start, start + pageSize) };
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

function segButton(act, value, label, on) {
  return `<button type="button" class="seg${on ? " is-on" : ""}" data-act="${act}" data-value="${esc(value)}" aria-pressed="${on ? "true" : "false"}">${esc(label)}</button>`;
}

function paintFilters() {
  const root = document.getElementById("filters");
  if (!root) return;
  const sources = [[0, "全部"], [1, "topic"], [2, "market"], [4, "awesome"], [8, "工坊"], [16, "dsh.so"], [32, "本机"]];
  const levels = [[0, "全部"], [5, "L5"], [4, "L4"], [3, "L3"], [2, "L2"], [1, "L1"]];
  const sorts = [["stars", "Star"], ["level", "等级"], ["downloads", "下载"], ["name", "名称"]];
  const group = (label, html) => `<div class="seg-group"><span>${label}</span><div>${html}</div></div>`;
  root.innerHTML = [
    group("来源", sources.map(([value, label]) => segButton("src", value, label, state.src === value)).join("")),
    group("等级", levels.map(([value, label]) => segButton("level", value, label, state.level === value)).join("")),
    group("排序", sorts.map(([value, label]) => segButton("sort", value, label, (state.sort || "stars") === value)).join("")),
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

function paintResults() {
  const root = document.getElementById("results");
  if (!root) return;
  const manifest = getManifest();
  const base = state.src === 32 ? localRows : getItems();
  const filtered = filterPlugins(base, state);
  const { page, pages, slice } = currentPage(filtered);
  const loading = !isLoaded() && state.src !== 32;
  const filtering = Boolean(state.q.trim() || state.cat || state.src || state.level || (state.sort && state.sort !== "stars"));
  const catName = state.cat ? catLabel(state.cat) : "";
  const hit = categoryHit();
  const suggest = hit && hit[0] !== state.cat
    ? `<button type="button" class="text-btn" data-act="use-cat" data-cat="${esc(hit[0])}">改看「${esc(catLabel(hit[0]))}」分类</button>`
    : "";
  const progress = loading
    ? `已载入 ${num(getItems().length)} / ${num(manifest?.total)}`
    : `${catName ? `${catName} · ` : ""}${num(filtered.length)} 条${state.q.trim() ? " · 相关的排在前面" : ""}`;
  const empty = loading ? "正在载入目录…" : `没有匹配的插件。${filtering ? "可以清除条件后再找。" : ""}`;
  const clear = filtering ? `<button type="button" class="text-btn" data-act="reset">清除条件</button>` : "";
  root.innerHTML = `<div class="result-bar"><span>${progress}</span><span>${suggest}${clear}第 ${num(page)} / ${num(pages)} 页</span></div>
    <div class="grid">${slice.map(card).join("") || `<p class="empty">${empty}</p>`}</div>
    ${pager(page, pages)}`;
  renderedListKey = stateListKey();
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

async function renderMarket(my) {
  const manifest = await boot();
  await loadLocalRows();
  if (my !== token) return;
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>插件目录</h1>
      <p class="muted" id="catalog-note">${catalogNote(manifest)}</p>
    </div>
    <section class="cat-board" id="cats" aria-label="分类">
      <div class="cat-head"><span>分类</span><span id="cat-status"></span></div>
      <label class="cat-find">
        <input id="cat-q" type="search" placeholder="找分类，如 浏览器、金融、Git" autocomplete="off" aria-label="找分类" enterkeyhint="search">
      </label>
      <div id="cat-body"></div>
      <p class="cat-empty" id="cat-empty" hidden>没有这个分类</p>
    </section>
    <div class="filter-strip" id="filters" aria-label="来源、等级和排序"></div>
    <div id="results"></div>
  </section>`;
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
  paintCats();
  paintFilters();
  paintResults();
  renderDrawer();
  if (unsub) unsub();
  unsub = onProgress(() => paintResults());
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

function pluginHtml(plugin) {
  const repoUrl = githubUrl(plugin.repo);
  const zip = repoUrl && plugin.health !== 1 ? `${repoUrl}/archive/HEAD.zip` : "";
  const tgz = npmTgz(plugin.npm, plugin.ver);
  const links = [
    repoUrl ? `<a class="btn btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : "",
    plugin.dsh ? `<a class="btn btn-ghost" href="${esc(safeUrl(plugin.dsh))}" target="_blank" rel="noopener noreferrer">dsh.so</a>` : "",
    plugin.page ? `<a class="btn btn-ghost" href="${esc(safeUrl(plugin.page))}" target="_blank" rel="noopener noreferrer">awesome</a>` : "",
    npmUrl(plugin.npm) ? `<a class="btn btn-ghost" href="${esc(npmUrl(plugin.npm))}" target="_blank" rel="noopener noreferrer">npm</a>` : "",
  ].join("");
  const downloads = [
    zip ? `<a class="btn" href="${esc(zip)}">下载源码</a>` : "",
    tgz ? `<a class="btn btn-ghost" href="${esc(tgz)}">下载 npm 包</a>` : "",
    plugin.local ? `<button class="btn" type="button" data-act="dl-upload" data-id="${esc(plugin.id)}">下载 zip</button>` : "",
  ].join("");
  const cat = plugin.cat && plugin.cat !== "other" ? catLabel(plugin.cat) : "未分类";
  return `<section class="page detail">
    <article class="panel">
      <p class="crumb"><a href="${esc(marketHash())}">目录</a> / ${esc(cat)}</p>
      <h1>${esc(plugin.name)}</h1>
      <p class="lede">${esc(plugin.desc || "暂无简介")}</p>
      <div class="split">${levelChip(plugin)}${riskChip(plugin)}${plugin.health ? `<span class="pill pill-risk">${esc(HEALTH[plugin.health])}</span>` : ""}${plugin.local ? `<span class="pill">本机</span>` : sourcePills(plugin.src)}</div>
      ${plugin.install ? `<div class="install"><code>${esc(plugin.install)}</code><button class="btn" type="button" data-act="copy" data-copy="${esc(plugin.install)}">复制</button></div>` : `<p class="muted">这条没有安装命令。</p>`}
      <div class="actions">${downloads}${links}</div>
      <p class="muted">${plugin.dsh ? "L 级和风险来自 dsh.so，本站没有复验。" : "没有 dsh.so 标注。缺标注不等于未通过。"}安装命令来自目录记录，本站不会执行。</p>
    </article>
    <aside class="side">
      <h2>信息</h2>
      <div class="facts">
        <div><span>仓库</span><b>${repoUrl ? `<a href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(plugin.repo)}</a>` : esc(plugin.repo || "—")}</b></div>
        <div><span>包名</span><b>${esc(plugin.npm || "—")}</b></div>
        <div><span>版本</span><b>${esc(plugin.ver || "—")}</b></div>
        <div><span>Star</span><b>${plugin.stars ? esc(compact(plugin.stars)) : "—"}</b></div>
        <div><span>下载量</span><b>${plugin.downloads ? esc(compact(plugin.downloads)) : "—"}</b></div>
        <div><span>语言</span><b>${esc(plugin.lang || "—")}</b></div>
        <div><span>风险</span><b>${esc(RISK[plugin.risk] || "—")}</b></div>
        <div><span>分类</span><b>${esc(cat)}</b></div>
      </div>
    </aside>
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
        <p>命令按 DeepSeek Harness 的写法给出，这个网站不会执行：</p>
        <div class="install"><code>dsh plugin --profile web add github:owner/repo</code></div>
        <div class="install"><code>dsh plugin --profile web add &lt;npm包名&gt;</code></div>
        <p class="muted">有仓库且没有被标成删除时，可以下载默认分支源码包。下载不会在网页里安装。</p>
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

function listHash() {
  const open = state.open;
  state.open = "";
  const href = marketHash();
  state.open = open;
  return href;
}

function stateListKey() {
  const hash = listHash();
  const cut = hash.indexOf("?");
  return catalogListKey(new URLSearchParams(cut === -1 ? "" : hash.slice(cut + 1)));
}

function cardId(href) {
  const cut = String(href || "").indexOf("?");
  if (cut < 0) return "";
  return new URLSearchParams(href.slice(cut + 1)).get("id") || "";
}

function scrollList() {
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
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
  const plugin = state.open ? (getById(state.open) || localRows.find((item) => item.id === state.open)) : null;
  document.title = plugin ? `${plugin.name} · DSH Plugins` : "目录 · DSH Plugins";
  renderDrawer();
}

async function draw() {
  const route = readRoute();
  let path = route.path;
  let params = route.params;
  if (path.startsWith("/plugin")) {
    const id = params.get("id") || "";
    const next = new URLSearchParams(params);
    next.delete("id");
    if (id) next.set("id", id);
    path = "/market";
    params = next;
    const query = next.toString();
    const hash = query ? `#/market?${query}` : "#/market";
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }
  if (isCatalog(path) && document.getElementById("results")) {
    if (catalogListKey(params) === renderedListKey) {
      state.open = params.get("id") || "";
      syncSearch();
      markNav(path);
      renderSession();
      document.querySelectorAll(".card").forEach((card) => {
        card.classList.toggle("is-open", cardId(card.getAttribute("href")) === state.open);
      });
      const plugin = state.open ? (getById(state.open) || localRows.find((item) => item.id === state.open)) : null;
      document.title = plugin ? `${plugin.name} · DSH Plugins` : "目录 · DSH Plugins";
      renderDrawer();
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
  if (isCatalog(path)) applyMarketParams(params);
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
    app.innerHTML = `<section class="page panel"><h1>页面没有打开</h1><p class="err">${esc(error.message || "未知错误")}</p></section>`;
  }
}


function catalogNote(manifest) {
  const when = day(manifest?.builtAt);
  if (manifest?.live) return `${num(manifest.total)} 条 · 刚刚从源站同步。Star 是 GitHub 星标，不是安装量。`;
  return `${num(manifest?.total)} 条 · 构建于 ${when || "未知"}。上方可以同步到最新。Star 是 GitHub 星标，不是安装量。`;
}

function drawerHtml(plugin) {
  const repoUrl = githubUrl(plugin.repo);
  const cat = plugin.cat && plugin.cat !== "other" ? catLabel(plugin.cat) : "未分类";
  return `<div class="drawer-bar">
      <a href="${esc(listHash())}" data-act="close">返回列表</a>
      <button type="button" class="btn btn-ghost" data-act="close">关闭</button>
    </div>
    <p class="crumb">${esc(cat)}</p>
    <h1>${esc(plugin.name)}</h1>
    <p class="lede">${esc(plugin.desc || "暂无简介")}</p>
    <div class="split">${levelChip(plugin)}${riskChip(plugin)}${plugin.health ? `<span class="pill pill-risk">${esc(HEALTH[plugin.health])}</span>` : ""}${plugin.local ? `<span class="pill">本机</span>` : sourcePills(plugin.src)}</div>
    ${plugin.install ? `<div class="install"><code>${esc(plugin.install)}</code><button class="btn" type="button" data-act="copy" data-copy="${esc(plugin.install)}">复制</button></div>` : ""}
    <div class="actions">
      ${repoUrl && plugin.health !== 1 ? `<a class="btn" href="${esc(`${repoUrl}/archive/HEAD.zip`)}">下载源码</a>` : ""}
      ${repoUrl ? `<a class="btn btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ""}
      ${plugin.dsh ? `<a class="btn btn-ghost" href="${esc(safeUrl(plugin.dsh))}" target="_blank" rel="noopener noreferrer">dsh.so</a>` : ""}
      ${npmUrl(plugin.npm) ? `<a class="btn btn-ghost" href="${esc(npmUrl(plugin.npm))}" target="_blank" rel="noopener noreferrer">npm</a>` : ""}
    </div>
    <div id="repo-live" class="repo-live"><p class="muted">${repoUrl ? "正在读取仓库说明…" : "这条没有 GitHub 仓库。"}</p></div>
    <div class="facts">
      <div><span>仓库</span><b>${esc(plugin.repo || "—")}</b></div>
      <div><span>包名</span><b>${esc(plugin.npm || "—")}</b></div>
      <div><span>版本</span><b>${esc(plugin.ver || "—")}</b></div>
      <div><span>Star</span><b>${plugin.stars ? esc(compact(plugin.stars)) : "—"}</b></div>
      <div><span>下载量</span><b>${plugin.downloads ? esc(compact(plugin.downloads)) : "—"}</b></div>
      <div><span>语言</span><b>${esc(plugin.lang || "—")}</b></div>
    </div>`;
}

function closeDrawer() {
  state.open = "";
  const next = marketHash();
  if (location.hash !== next) location.hash = next;
  else renderDrawer();
}

async function renderDrawer() {
  const id = state.open;
  document.body.classList.toggle("with-drawer", Boolean(id));
  let drawer = document.getElementById("drawer");
  if (!id) {
    drawer?.remove();
    return;
  }
  if (!drawer) {
    drawer = document.createElement("aside");
    drawer.id = "drawer";
    drawer.className = "drawer";
    drawer.setAttribute("aria-label", "插件详情");
    document.body.appendChild(drawer);
  }
  if (drawer.dataset.id === id && drawer.dataset.ready === "1") return;
  drawer.dataset.id = id;
  drawer.dataset.ready = "0";
  let plugin = getById(id) || localRows.find((item) => item.id === id);
  if (!plugin) {
    drawer.innerHTML = `<p class="muted">正在打开…</p>`;
    try { await ensureAll(); } catch { /* paint error elsewhere */ }
    if (state.open !== id) return;
    plugin = getById(id);
  }
  if (!plugin) {
    drawer.innerHTML = `<p>没有这个插件。</p><button class="btn" type="button" data-act="close">返回</button>`;
    return;
  }
  drawer.innerHTML = drawerHtml(plugin);
  drawer.dataset.ready = "1";
  drawer.scrollTop = 0;
  loadRemote(plugin);
}

function inlineReadme(text) {
  const re = /(`[^`]+`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let html = "";
  let last = 0;
  for (const match of text.matchAll(re)) {
    html += esc(text.slice(last, match.index));
    if (match[1]) html += `<code>${esc(match[1].slice(1, -1))}</code>`;
    else if (match[3]) {
      const url = safeUrl(match[3]);
      html += url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(match[2])}</a>` : esc(match[0]);
    } else if (match[4]) html += `<strong>${esc(match[4])}</strong>`;
    last = match.index + match[0].length;
  }
  html += esc(text.slice(last));
  return html;
}

function readableSource(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!/<\/?[a-z][\s\S]*?>/i.test(text)) return text;
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-3])[^>]*>/gi, (_, level) => `\n${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `[${label.replace(/<[^>]+>/g, "")}](${href})`)
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function renderReadme(raw) {
  const text = readableSource(raw).slice(0, 8000);
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
      const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
      if (heading) return `<h${heading[1].length + 2}>${inlineReadme(heading[2])}</h${heading[1].length + 2}>`;
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inlineReadme(line.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map((line) => inlineReadme(line)).join("<br>")}</p>`;
    }).join("");
  }).join("");
}

function paintRemote(slot, data) {
  const when = data.pushed ? `仓库更新于 ${esc(day(data.pushed))}。` : "";
  const stars = data.stars != null ? `当前 Star ${esc(compact(data.stars))}。` : "";
  const body = data.readme
    ? `<div class="readme">${renderReadme(data.readme)}</div>`
    : `<p class="muted">仓库没有可读取的 README。</p>`;
  slot.innerHTML = `<p class="muted">${when}${stars}说明来自 GitHub。</p>${body}`;
}

async function loadRemote(plugin) {
  const slot = document.getElementById("repo-live");
  const repoUrl = githubUrl(plugin.repo);
  if (!slot || !repoUrl) return;
  const mine = ++remoteToken;
  const cacheKey = `dsh-repo:3:${plugin.repo}`;
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
    if (mine !== remoteToken || state.open !== plugin.id || !slot.isConnected) return;
    if (repoResponse.status === 403 || repoResponse.status === 429) {
      slot.innerHTML = `<p class="muted">GitHub 暂时限制读取。可以打开仓库查看最新说明。</p>`;
      return;
    }
    const repo = repoResponse.ok ? await repoResponse.json() : null;
    const readme = readmeResponse.ok ? readableSource(await readmeResponse.text()).slice(0, 8000) : "";
    const data = { pushed: repo?.pushed_at || "", stars: repo?.stargazers_count ?? null, readme, at: Date.now() };
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
    const { pullLive } = await import("./live.js?v=20261028d");
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
    paintResults();
    const drawer = document.getElementById("drawer");
    if (drawer) drawer.dataset.ready = "0";
    renderDrawer();
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
  const { probeSources } = await import("./live.js?v=20261028d");
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

document.getElementById("top-search").addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(queryTimer);
  state.q = document.getElementById("top-q").value.trim();
  state.page = 1;
  syncSearch();
  const next = marketHash();
  if (location.hash !== next) location.hash = next;
  else if (isCatalog(readRoute().path)) paintResults();
  else draw();
});

const topQuery = document.getElementById("top-q");
topQuery.addEventListener("compositionstart", () => { composing = true; });
topQuery.addEventListener("compositionend", (event) => {
  composing = false;
  if (isCatalog(readRoute().path)) applyQuery(event.target.value);
});
topQuery.addEventListener("input", (event) => {
  if (composing || !isCatalog(readRoute().path)) return;
  applyQuery(event.target.value);
});

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || button.disabled) return;
  const act = button.dataset.act;
  if (act === "close") {
    event.preventDefault();
    closeDrawer();
  }
  if (act === "clear-q") {
    event.preventDefault();
    const input = document.getElementById("top-q");
    if (input) input.value = "";
    if (isCatalog(readRoute().path)) applyQuery("", true);
    else {
      state.q = "";
      syncSearch();
    }
  }
  if (act === "cat" || act === "src" || act === "level" || act === "sort") {
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
    if (act === "sort") state.sort = button.dataset.value || "stars";
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
    const { cancelPull } = await import("./live.js?v=20261028d");
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
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.open) {
    event.preventDefault();
    closeDrawer();
    return;
  }
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (/input|textarea|select/i.test(event.target.tagName)) return;
  const input = document.getElementById("top-q");
  if (!input) return;
  event.preventDefault();
  input.focus();
});

if (!location.hash || location.hash === "#/") location.replace("#/market");
draw();
watchSources().catch(() => {});
setInterval(() => { watchSources().catch(() => {}); }, 3 * 60 * 1000);
