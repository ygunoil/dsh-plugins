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
  SOURCES,
} from "./catalog.js?v=20261027";
import { readPackageJson } from "./zip.js?v=20261027";

const app = document.querySelector("#app");
const state = { q: "", cat: "", src: 0, level: 0, sort: "stars", page: 1 };
const pageSize = 24;
let token = 0;
let unsub = null;
let flash = "";
let localRows = [];

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
  if (path.startsWith("/plugin") || isCatalog(path)) return "/market";
  if (path === "/insights" || path === "/guide" || path === "/about") return "/about";
  if (path === "/publish" || path === "/local") return "/local";
  return path || "/market";
}

function syncSearch() {
  const input = document.getElementById("top-q");
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

function option(value, label, current) {
  const selected = String(value) === String(current) ? " selected" : "";
  return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
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

function card(plugin) {
  const repo = plugin.repo || plugin.npm || "";
  const cat = plugin.cat && plugin.cat !== "other" ? `<span class="pill">${esc(catLabel(plugin.cat))}</span>` : "";
  const health = plugin.health ? `<span class="pill pill-risk">${esc(HEALTH[plugin.health] || "异常")}</span>` : "";
  const sources = plugin.local ? `<span class="pill">本机</span>` : sourcePills(plugin.src);
  return `<a class="card${plugin.health === 1 ? " is-dead" : ""}" href="#/plugin?id=${encodeURIComponent(plugin.id)}">
    <header><h3>${esc(plugin.name)}</h3>${plugin.stars ? `<em class="stars">${esc(compact(plugin.stars))}</em>` : ""}</header>
    ${repo ? `<p class="repo">${esc(repo)}</p>` : ""}
    <p class="desc">${esc(plugin.desc || "暂无简介")}</p>
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

function paintResults() {
  const root = document.getElementById("results");
  if (!root) return;
  const manifest = getManifest();
  const base = state.src === 32 ? localRows : getItems();
  const filtered = filterPlugins(base, state);
  const { page, pages, slice } = currentPage(filtered);
  const loading = !isLoaded() && state.src !== 32;
  const progress = loading ? `已载入 ${num(getItems().length)} / ${num(manifest?.total)}` : `${num(filtered.length)} 条`;
  const empty = loading ? "正在载入目录…" : "没有匹配的插件。";
  root.innerHTML = `<div class="result-bar"><span>${progress}</span><span>第 ${num(page)} / ${num(pages)} 页</span></div>
    <div class="grid">${slice.map(card).join("") || `<p class="empty">${empty}</p>`}</div>
    ${pager(page, pages)}`;
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
  const cats = (manifest.categories || []).map(([id, count]) => option(id, `${catLabel(id)} · ${num(count)}`, state.cat)).join("");
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>插件目录</h1>
      <p class="muted">${num(manifest.total)} 条，五个公开来源去重。Star 是 GitHub 星标，不是安装量。</p>
    </div>
    <form class="toolbar" data-form="market-filters">
      <label class="field"><span>分类</span><select id="cat" aria-label="分类">${option("", "全部", state.cat)}${cats}</select></label>
      <label class="field"><span>来源</span><select id="src" aria-label="来源">
        ${option(0, "全部", state.src)}
        ${SOURCES.map((source) => option(source.bit, source.name, state.src)).join("")}
        ${option(32, "只看本机", state.src)}
      </select></label>
      <label class="field"><span>dsh.so</span><select id="lv" aria-label="dsh.so 等级">
        ${option(0, "全部等级", state.level)}
        ${[5, 4, 3, 2, 1].map((level) => option(level, `L${level}`, state.level)).join("")}
      </select></label>
      <label class="field"><span>排序</span><select id="sort" aria-label="排序">
        ${option("stars", "Star", state.sort)}
        ${option("level", "dsh.so 等级", state.sort)}
        ${option("downloads", "下载量", state.sort)}
        ${option("name", "名称", state.sort)}
      </select></label>
    </form>
    <div id="results"></div>
  </section>`;
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
      <p class="lede">把 GitHub topic、dshmarket、awesome-dsh-plugin、创意工坊和 dsh.so 收成一份目录。同一个仓库只留一条。构建于 ${esc(day(manifest.builtAt))}。</p>
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

async function draw() {
  const my = ++token;
  if (unsub) {
    unsub();
    unsub = null;
  }
  const { path, params } = readRoute();
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

document.getElementById("top-search").addEventListener("submit", (event) => {
  event.preventDefault();
  state.q = document.getElementById("top-q").value.trim();
  state.page = 1;
  const next = marketHash();
  if (location.hash !== next) location.hash = next;
  else if (isCatalog(readRoute().path)) paintResults();
  else draw();
});

document.getElementById("top-q").addEventListener("input", (event) => {
  if (!isCatalog(readRoute().path)) return;
  state.q = event.target.value;
  state.page = 1;
  const next = marketHash();
  if (location.hash !== next) history.replaceState(null, "", next);
  paintResults();
});

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || button.disabled) return;
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (/input|textarea|select/i.test(event.target.tagName)) return;
  const input = document.getElementById("top-q");
  if (!input) return;
  event.preventDefault();
  input.focus();
});

if (!location.hash || location.hash === "#/") location.replace("#/market");
draw();
