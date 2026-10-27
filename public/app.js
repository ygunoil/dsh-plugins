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
} from "./auth.js?v=20261026";
import {
  boot,
  catLabel,
  ensureAll,
  filterPlugins,
  getById,
  getItems,
  getManifest,
  hydrate,
  isLoaded,
  onProgress,
  SOURCES,
} from "./catalog.js?v=20261026";
import { readPackageJson } from "./zip.js?v=20261026";

const app = document.querySelector("#app");
const state = { q: "", cat: "", src: 0, level: 0, sort: "stars", page: 1 };
let token = 0;
let unsub = null;
let flash = "";
let localRows = [];

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
  const raw = (location.hash || "#/").slice(1);
  const cut = raw.indexOf("?");
  const path = cut === -1 ? raw || "/" : raw.slice(0, cut) || "/";
  const params = new URLSearchParams(cut === -1 ? "" : raw.slice(cut + 1));
  return { path, params };
}

function marketHash() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.cat) params.set("cat", state.cat);
  if (state.src) params.set("src", String(state.src));
  if (state.level) params.set("lv", String(state.level));
  if (state.sort && state.sort !== "stars") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
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
}

function navKey(path) {
  if (path.startsWith("/plugin")) return "/market";
  return path || "/";
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
    link.classList.toggle("is-on", link.dataset.nav === key);
  });
}

function starsHtml(value) {
  if (!value) return "";
  return `<em class="stars">${esc(compact(value))}</em>`;
}

function levelChip(plugin) {
  if (!plugin.level) return "";
  return `<span class="lv" title="dsh.so 标注，本站没有复验">L${plugin.level}</span>`;
}

function riskChip(plugin) {
  if (plugin.risk < 3 || plugin.risk === 5) return "";
  return `<span class="risk">${plugin.risk === 4 ? "严重" : "高风险"}</span>`;
}

function sourceDots(src) {
  return `<span class="dots">${SOURCES.map((source) => `<i class="${src & source.bit ? "on" : ""}" title="${esc(source.name)}">${source.short}</i>`).join("")}</span>`;
}

function card(plugin) {
  const dead = plugin.health === 1 ? " is-dead" : "";
  return `<a class="card${dead}" href="#/plugin?id=${encodeURIComponent(plugin.id)}">
    <header><div><h3>${esc(plugin.name)}</h3>${plugin.repo ? `<small>${esc(plugin.repo)}</small>` : ""}</div>${starsHtml(plugin.stars)}</header>
    <p>${esc(plugin.desc || "这份目录没有简介。")}</p>
    <footer>
      <span class="cat">${esc(catLabel(plugin.cat))}</span>
      ${levelChip(plugin)}
      ${riskChip(plugin)}
      ${plugin.local ? `<span class="dead">本机</span>` : ""}
      ${sourceDots(plugin.src)}
    </footer>
  </a>`;
}

function whale() {
  return `<svg class="whale" viewBox="0 0 360 240" aria-hidden="true">
    <defs>
      <linearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#d5defe"/>
        <stop offset="0.45" stop-color="#4d6bfe"/>
        <stop offset="1" stop-color="#2441c8"/>
      </linearGradient>
    </defs>
    <path fill="url(#wg)" d="M46 146c18-8 38-28 78-34 34-28 92-24 138 8 22-18 58-12 54 24 22 8-2 34-36 28-18 34-86 48-142 28-38 16-78 4-92-54z"/>
    <path fill="#070b14" d="M214 104c18 8 34 28 28 48-20-6-36-20-40-40 4-4 8-6 12-8z" opacity=".35"/>
    <circle cx="236" cy="112" r="7" fill="#fff"/>
    <circle cx="238" cy="112" r="3" fill="#070b14"/>
    <path fill="#9eb2ff" d="M78 132c20 10 34 8 48-2-18 18-36 20-48 2z"/>
  </svg>`;
}

function countUp(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = num(target);
    return;
  }
  const start = performance.now();
  const frame = (now) => {
    const progress = Math.min(1, (now - start) / 800);
    el.textContent = num(Math.round(target * (1 - (1 - progress) ** 3)));
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function sourceCards(manifest) {
  const rows = [
    ["GitHub topic", "topic", "检索上限 1000 条", 1],
    ["dshmarket", "market", "format 1", 2],
    ["awesome", "awesome", "CC0", 4],
    ["创意工坊", "workshop", "topic 快照", 8],
    ["dsh.so", "dshso", "CC BY 4.0", 16],
  ];
  return rows.map(([label, key, note, bit]) => `<a class="src-card" href="#/market?src=${bit}">
    <small>${esc(note)}</small>
    <strong>${num(manifest.withBit?.[key])}</strong>
    <span>${esc(label)} · 原始 ${num(manifest.input?.[key])}</span>
  </a>`).join("");
}

async function renderHome(my) {
  const manifest = await boot();
  if (my !== token) return;
  app.innerHTML = `<section class="hero">
    <div>
      <p class="eyebrow"><span>DeepSeek Harness</span> 非官方社区目录</p>
      <h1>五处来源<br>收成一本目录</h1>
      <p class="lede">探索未至之境。GitHub topic、dshmarket、awesome-dsh-plugin、创意工坊和 dsh.so，同一个仓库只留一条。</p>
      <form class="search" data-form="hero-search">
        <input name="q" placeholder="搜索插件、仓库或包名" aria-label="搜索插件">
        <button class="btn" type="submit">检索</button>
      </form>
      <div class="stats">
        <div><b id="count-total">0</b><span>去重后</span></div>
        <div><b>5</b><span>来源</span></div>
        <div><b id="count-dsh">0</b><span>含 dsh.so</span></div>
      </div>
    </div>
    <div class="hero-art">${whale()}<i class="orb o1"></i><i class="orb o2"></i></div>
  </section>
  <section class="section">
    <div class="section-head"><h2>五个入口</h2><a href="#/insights">看覆盖</a></div>
    <div class="src-grid">${sourceCards(manifest)}</div>
  </section>
  <section class="section">
    <div class="section-head"><h2>公开 Star 最高</h2><a href="#/market">进入目录</a></div>
    <div class="grid">${(manifest.featured || []).map((row) => card(hydrate(row))).join("")}</div>
  </section>
  <section class="steps">
    <article class="step"><b>01</b><h3>检索</h3><p>按名称、简介、仓库和包名找。来源、分类和 dsh.so 标注可以一起筛。</p></article>
    <article class="step"><b>02</b><h3>下载</h3><p>有仓库就下默认分支源码包，也可以复制宿主自己的安装命令。</p></article>
    <article class="step"><b>03</b><h3>登录后上传</h3><p>注册可用。账号和 zip 只留在这台浏览器，因为 Pages 没有用户库。</p></article>
  </section>`;
  countUp("count-total", manifest.total || 0);
  countUp("count-dsh", manifest.withBit?.dshso || 0);
}

function option(value, label, current) {
  const selected = String(value) === String(current) ? " selected" : "";
  return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
}

async function renderMarket(my) {
  const manifest = await boot();
  if (my !== token) return;
  localRows = [];
  const user = currentUser();
  if (user && globalThis.indexedDB) {
    try {
      localRows = (await listUploads(user.id)).map(uploadToPlugin);
    } catch {
      localRows = [];
    }
  }
  if (my !== token) return;
  const cats = (manifest.categories || []).map(([id, count]) => option(id, `${catLabel(id)} · ${num(count)}`, state.cat)).join("");
  app.innerHTML = `<section class="market">
    <p class="eyebrow"><span>Catalog</span> ${num(manifest.total)} 条去重结果</p>
    <h1>目录</h1>
    <form class="filters" data-form="market-filters">
      <input id="q" name="q" value="${esc(state.q)}" placeholder="搜索插件、仓库或包名" aria-label="搜索">
      <select id="cat" aria-label="分类">${option("", "全部分类", state.cat)}${cats}</select>
      <select id="src" aria-label="来源">
        ${option(0, "全部来源", state.src)}
        ${SOURCES.map((source) => option(source.bit, source.name, state.src)).join("")}
        ${option(32, "本机上传", state.src)}
      </select>
      <select id="lv" aria-label="标注">
        ${option(0, "全部标注", state.level)}
        ${[5, 4, 3, 2, 1].map((level) => option(level, `L${level}`, state.level)).join("")}
      </select>
      <select id="sort" aria-label="排序">
        ${option("stars", "Star", state.sort)}
        ${option("level", "标注", state.sort)}
        ${option("downloads", "下载量", state.sort)}
        ${option("name", "名称", state.sort)}
      </select>
    </form>
    <div id="results"></div>
  </section>`;
  document.getElementById("q").addEventListener("input", (event) => {
    state.q = event.target.value;
    state.page = 1;
    history.replaceState(null, "", marketHash());
    paintResults();
  });
  for (const id of ["cat", "src", "lv", "sort"]) {
    document.getElementById(id).addEventListener("change", (event) => {
      if (id === "cat") state.cat = event.target.value;
      if (id === "src") state.src = Number(event.target.value);
      if (id === "lv") state.level = Number(event.target.value);
      if (id === "sort") state.sort = event.target.value;
      state.page = 1;
      const next = marketHash();
      if (location.hash !== next) location.hash = next;
      else paintResults();
    });
  }
  paintResults();
  if (unsub) unsub();
  unsub = onProgress(() => paintResults());
  ensureAll().then(() => {
    if (my === token) paintResults();
  }).catch((error) => {
    const root = document.getElementById("results");
    if (root && my === token) root.insertAdjacentHTML("afterbegin", `<p class="err">${esc(error.message)}</p>`);
  });
}

function pager(page, pages) {
  if (pages <= 1) return "";
  const buttons = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  if (page > 1) buttons.push(`<button type="button" data-act="page" data-page="${page - 1}">上一页</button>`);
  for (let i = start; i <= end; i += 1) {
    buttons.push(`<button type="button" data-act="page" data-page="${i}" class="${i === page ? "is-on" : ""}">${i}</button>`);
  }
  if (page < pages) buttons.push(`<button type="button" data-act="page" data-page="${page + 1}">下一页</button>`);
  return `<nav class="pager">${buttons.join("")}</nav>`;
}

function paintResults() {
  const root = document.getElementById("results");
  if (!root) return;
  const base = state.src === 32 ? localRows : getItems();
  const filtered = filterPlugins(base, state);
  const locals = state.src === 0 && state.page === 1 ? filterPlugins(localRows, { ...state, src: 0 }) : [];
  const pageSize = 24;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(state.page, pages);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const manifest = getManifest();
  const progress = isLoaded() ? "" : ` · 已载入 ${num(getItems().length)} / ${num(manifest?.total)}`;
  root.innerHTML = `<div class="result-bar"><span>${num(filtered.length)} 条${progress}</span>${locals.length ? `<span>${locals.length} 个本机包</span>` : ""}</div>
    ${locals.length ? `<div class="grid local-grid">${locals.map(card).join("")}</div>` : ""}
    <div class="grid">${slice.map(card).join("") || `<p class="empty">${isLoaded() || state.src === 32 ? "没有匹配的插件。" : "目录还在装载。"}</p>`}</div>
    ${pager(page, pages)}`;
}

function uploadToPlugin(row) {
  const plugin = {
    id: row.id,
    name: row.name,
    desc: row.description || "本机上传，没有简介。",
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

const HEALTH = { 1: "源仓库已删除", 2: "源仓库已改名", 3: "源仓库已合并", 4: "topic 已移除" };
const RISK = { 1: "低", 2: "中", 3: "高", 4: "严重", 5: "待核验" };

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
    zip ? `<a class="btn" href="${esc(zip)}">下载源码 zip</a>` : "",
    tgz ? `<a class="btn btn-ghost" href="${esc(tgz)}">下载 npm 包</a>` : "",
    plugin.local ? `<button class="btn" type="button" data-act="dl-upload" data-id="${esc(plugin.id)}">下载本机 zip</button>` : "",
  ].join("");
  const generated = getManifest()?.upstream?.dshso?.generatedAt;
  return `<section class="detail">
    <article class="panel">
      <p class="eyebrow"><a href="#/market">目录</a> / ${esc(catLabel(plugin.cat))}</p>
      <h1>${esc(plugin.name)}</h1>
      <p>${esc(plugin.desc || "这份目录没有简介。")}</p>
      <div class="split">${levelChip(plugin)}${riskChip(plugin)}${plugin.health ? `<span class="dead">${esc(HEALTH[plugin.health])}</span>` : ""}${sourceDots(plugin.src)}</div>
      ${plugin.install ? `<div class="install"><code>${esc(plugin.install)}</code><button class="btn" type="button" data-act="copy" data-copy="${esc(plugin.install)}">复制</button></div>` : `<p>这个条目没有安装命令。</p>`}
      <div class="actions">${downloads}${links}</div>
      ${plugin.dsh ? `<p class="muted">验证等级来自 dsh.so，索引时间 ${esc(generated || "未知")}。本站没有复验，也不代表官方认证。</p>` : `<p class="muted">没有 dsh.so 标注。空着不是“未通过”。</p>`}
    </article>
    <aside class="side">
      <h2>条目</h2>
      <div class="facts">
        <div><span>仓库</span><b>${esc(plugin.repo || "—")}</b></div>
        <div><span>包名</span><b>${esc(plugin.npm || "—")}</b></div>
        <div><span>版本</span><b>${esc(plugin.ver || "—")}</b></div>
        <div><span>Star</span><b>${plugin.stars ? esc(compact(plugin.stars)) : "—"}</b></div>
        <div><span>下载量</span><b>${plugin.downloads ? esc(compact(plugin.downloads)) : "—"}</b></div>
        <div><span>语言</span><b>${esc(plugin.lang || "—")}</b></div>
        <div><span>风险标注</span><b>${esc(RISK[plugin.risk] || "—")}</b></div>
      </div>
      <p class="muted">安装命令是宿主自己的写法。下载 zip 不会在这个网站里执行。</p>
    </aside>
  </section>`;
}

async function renderPlugin(my, id) {
  if (!id) {
    app.innerHTML = `<section class="panel"><h1>没有这个插件</h1><p><a href="#/market">回目录</a></p></section>`;
    return;
  }
  await boot();
  let plugin = getById(id);
  const user = currentUser();
  if (!plugin && user && globalThis.indexedDB) {
    const rows = await listUploads(user.id);
    plugin = rows.map(uploadToPlugin).find((item) => item.id === id) || null;
  }
  if (!plugin) {
    await ensureAll();
    if (my !== token) return;
    plugin = getById(id);
  }
  if (my !== token) return;
  app.innerHTML = plugin
    ? pluginHtml(plugin)
    : `<section class="panel"><h1>没有这个插件</h1><p><a href="#/market">回目录</a></p></section>`;
}

function bars(entries) {
  const max = Math.max(1, ...entries.map((entry) => entry[1]));
  return entries.map(([label, count]) => `<div class="bar"><span>${esc(label)}</span><i><b style="width:${(count / max) * 100}%"></b></i><em>${num(count)}</em></div>`).join("");
}

async function renderInsights(my) {
  const manifest = await boot();
  if (my !== token) return;
  const levels = ["未标注", "L1", "L2", "L3", "L4", "L5"].map((label, index) => [label, manifest.levels?.[index] || 0]);
  const sources = [
    ["GitHub topic", manifest.withBit?.topic || 0],
    ["dshmarket", manifest.withBit?.market || 0],
    ["awesome", manifest.withBit?.awesome || 0],
    ["创意工坊", manifest.withBit?.workshop || 0],
    ["dsh.so", manifest.withBit?.dshso || 0],
  ];
  const cats = (manifest.categories || []).slice(0, 16).map(([id, count]) => [catLabel(id), count]);
  const up = manifest.upstream || {};
  app.innerHTML = `<section class="market">
    <p class="eyebrow"><span>Snapshot</span> ${esc(manifest.builtAt || "")}</p>
    <h1>覆盖</h1>
    <p class="lede">原始记录 ${num((manifest.input?.dshso || 0) + (manifest.input?.awesome || 0) + (manifest.input?.market || 0) + (manifest.input?.workshop || 0))} 条，去重后 ${num(manifest.total)} 条。GitHub topic 的检索窗口最多 1000 条，创意工坊这份快照就是这个窗口。</p>
    <div class="cols">
      <article class="panel"><h2>来源</h2>${bars(sources)}<p class="muted">只在 topic 快照里、没进另外三个目录的有 ${num(manifest.only?.snapshot)} 条。只出现在 dsh.so 的有 ${num(manifest.only?.dshso)} 条。awesome 家族（含 dshmarket）单独 ${num(manifest.only?.awesome)} 条。</p></article>
      <article class="panel"><h2>dsh.so 标注</h2>${bars(levels)}<p class="muted">高风险 ${num(manifest.risks?.[3])}，严重 ${num(manifest.risks?.[4])}。源仓库标记已删除 ${num(manifest.health?.deleted)}。这些都是来源自己的标记。</p></article>
    </div>
    <article class="panel"><h2>分类</h2>${bars(cats)}</article>
    <article class="panel">
      <h2>新鲜度</h2>
      <p>dsh.so ${esc(up.dshso?.generatedAt || "未知")} · ${esc(up.dshso?.attribution || "")}</p>
      <p>awesome ${esc(up.awesome?.updated || "未知")} · ${esc(up.awesome?.license || "")}</p>
      <p>创意工坊 ${esc(up.workshop?.fetchedAt || "未知")}</p>
    </article>
  </section>`;
}

async function renderGuide(my) {
  const manifest = await boot();
  if (my !== token) return;
  const up = manifest.upstream || {};
  app.innerHTML = `<section class="market cols">
    <article class="panel guide">
      <h1>手册</h1>
      <p>安装命令沿用宿主的写法，这个站不会替你执行：</p>
      <div class="install"><code>dsh plugin --profile web add github:owner/repo</code></div>
      <div class="install"><code>dsh plugin --profile web add &lt;npm包名&gt;</code></div>
      <div class="install"><code>dsh plugin --profile web add ./解压后的目录</code></div>
      <p>有 GitHub 仓库、且没被标记删除时，下载走 <code>https://github.com/owner/repo/archive/HEAD.zip</code>，这是默认分支的源码包。</p>
      <p><a href="./samples/dsh-hello-community-0.1.0.zip">示例 zip</a> 只用来试上传和下载。它没有可安装的补丁，不要装进正在使用的 profile。</p>
    </article>
    <article class="panel guide">
      <h2>署名</h2>
      <p>dsh.so 索引是 ${esc(up.dshso?.license || "CC-BY-4.0")}。署名：${esc(up.dshso?.attribution || "dsh.so — DSH Developer Hub (https://www.dsh.so)")}。索引时间 ${esc(up.dshso?.generatedAt || "")}。每条来自 dsh.so 的记录都链回它的详情页。</p>
      <p>awesome-dsh-plugin 目录是 ${esc(up.awesome?.license || "CC0-1.0")}，更新日 ${esc(up.awesome?.updated || "")}。dshmarket 用的是同一家族的 format 1。创意工坊快照来自 GitHub topic，抓取于 ${esc(up.workshop?.fetchedAt || "")}。</p>
      <p>本站是目录，不是 dsh.so 数据的再售镜像。整库再分发请先联系 hello@dsh.so。这里的数字是构建快照，不是实时源。</p>
      <p>账号写在这台浏览器里，密码只留 PBKDF2 哈希。GitHub Pages 不能托管共享用户库。</p>
    </article>
  </section>`;
}

function renderAccount() {
  const user = currentUser();
  if (user) {
    app.innerHTML = `<section class="market">
      <h1>已登录</h1>
      <article class="panel">
        <p>${esc(user.name)} · ${esc(user.email)}</p>
        <div class="actions">
          <a class="btn" href="#/publish">去发布</a>
          <button class="btn btn-ghost" type="button" data-act="logout">退出</button>
          <button class="btn btn-ghost" type="button" data-act="wipe">清除本机社区数据</button>
        </div>
        <p class="muted">退出只结束这次会话。清除会删掉这台浏览器里的账号和上传的包，没有邮件可以找回。</p>
      </article>
    </section>`;
    return;
  }
  app.innerHTML = `<section class="market">
    <p class="eyebrow"><span>Local account</span> 只在这台浏览器</p>
    <h1>登录 / 注册</h1>
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
        <input name="password" type="password" autocomplete="new-password" placeholder="密码，至少 8 位" required aria-label="密码">
        <input name="confirm" type="password" autocomplete="new-password" placeholder="再输入一次密码" required aria-label="确认密码">
        <button class="btn" type="submit">注册</button>
        <p data-note class="err"></p>
      </form>
    </div>
    <p class="muted">密码不会明文保存。换浏览器、清站点数据，账号就没了。这是静态页面能做到的真实登录，不是全网同步的账号系统。</p>
  </section>`;
}

async function renderPublish(my) {
  const user = currentUser();
  if (!user) {
    app.innerHTML = `<section class="panel"><h1>先登录</h1><p>上传需要一个本机账号。</p><p><a class="btn" href="#/account">去登录或注册</a></p></section>`;
    return;
  }
  let rows = [];
  if (globalThis.indexedDB) {
    try { rows = await listUploads(user.id); } catch { rows = []; }
  }
  if (my !== token) return;
  app.innerHTML = `<section class="market">
    <h1>发布</h1>
    <p class="lede">zip 保存在这台浏览器的 IndexedDB 里，可以再下载。它不会出现在别人打开的目录里。</p>
    <label class="drop">
      <input data-act="upload" type="file" accept=".zip,application/zip">
      <strong>放下 zip，或点这里选择</strong>
      <span>根目录或第一层要有 package.json，最大 20MB</span>
    </label>
    <p id="upload-note" class="err">${esc(flash)}</p>
    <div class="list">${rows.map((row) => `<article>
      <div><strong>${esc(row.name)}@${esc(row.version)}</strong><p class="muted">${esc(row.description || "没有简介")} · ${num(Math.ceil((row.size || 0) / 1024))} KB</p></div>
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
  app.innerHTML = `<section class="panel"><h1>没有这一页</h1><p><a href="#/">回概览</a></p></section>`;
}

async function draw() {
  const my = ++token;
  if (unsub) {
    unsub();
    unsub = null;
  }
  const { path, params } = readRoute();
  if (path === "/market") applyMarketParams(params);
  markNav(path);
  renderSession();
  const titles = { "/": "概览", "/market": "目录", "/insights": "洞察", "/guide": "手册", "/publish": "发布", "/account": "账号" };
  document.title = `${titles[navKey(path)] || "DSH Plugins"} · DSH Plugins`;
  try {
    if (path === "/" || path === "") await renderHome(my);
    else if (path === "/market") await renderMarket(my);
    else if (path === "/insights") await renderInsights(my);
    else if (path === "/guide") await renderGuide(my);
    else if (path === "/publish") await renderPublish(my);
    else if (path === "/account") renderAccount();
    else if (path.startsWith("/plugin")) await renderPlugin(my, params.get("id"));
    else renderNotFound();
  } catch (error) {
    if (my !== token) return;
    app.innerHTML = `<section class="panel"><h1>页面没有打开</h1><p class="err">${esc(error.message || "未知错误")}</p></section>`;
  }
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
  flash = `已保存 ${meta.name}@${meta.version}。这个包只在这台浏览器里。`;
  await draw();
}

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const act = button.dataset.act;
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
    else paintResults();
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
  if (kind === "hero-search") {
    const q = String(new FormData(form).get("q") || "");
    location.hash = q ? `#/market?q=${encodeURIComponent(q)}` : "#/market";
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
    location.hash = kind === "register" ? "#/publish" : "#/";
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
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (/input|textarea|select/i.test(event.target.tagName)) return;
  const input = document.querySelector(".search input, #q");
  if (!input) return;
  event.preventDefault();
  input.focus();
});

draw();
