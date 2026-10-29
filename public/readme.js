import { Marked, Renderer } from "./vendor/marked.esm.js";

const ALERTS = {
  NOTE: "说明",
  TIP: "提示",
  IMPORTANT: "重要",
  WARNING: "注意",
  CAUTION: "危险",
};

const BADGE = /shields\.io|badge\.fury\.io|badgen\.net|codecov\.io|img\.shields\.io|travis-ci\.|coveralls\.io|github\.com\/[^)\s]+\/(?:actions\/workflows|workflows)\//i;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function safeHttp(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function repoParts(repoUrl) {
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com") return null;
    const [owner, name] = url.pathname.split("/").filter(Boolean);
    if (!owner || !name) return null;
    return { owner, name: name.replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

function readmeUrl(href, repoUrl, kind) {
  const raw = String(href || "").trim();
  if (!raw || /^(?:javascript|data|vbscript):/i.test(raw)) return "";
  if (raw.startsWith("#")) return /^#[^\s"<>]*$/.test(raw) ? raw : "";
  if (raw.startsWith("//")) return safeHttp(`https:${raw}`);
  if (/^https?:\/\//i.test(raw)) return safeHttp(raw);
  const repo = repoParts(repoUrl);
  if (!repo || raw.includes("\\")) return "";
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  const path = (hashAt === -1 ? raw : raw.slice(0, hashAt)).replace(/^\.\//, "").replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) return "";
  if (hash && !/^#[^\s"<>]*$/.test(hash)) return "";
  const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (kind === "img") return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/HEAD/${encoded}`;
  return `https://github.com/${repo.owner}/${repo.name}/blob/HEAD/${encoded}${hash}`;
}

function isHtmlDocument(text) {
  const trimmed = text.trim();
  if (/^#{1,6}\s|\n#{1,6}\s|^\s*```/m.test(text)) return false;
  return /^<!doctype html/i.test(trimmed) || /^<(?:html|body|div|article|section|main|p|h1)\b/i.test(trimmed);
}

function liftImages(text) {
  return text.replace(/<img\b([^>]*?)\/?\s*>/gi, (_, attrs) => {
    const src = /src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs);
    const alt = /alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const href = src?.[1] || src?.[2] || src?.[3] || "";
    if (!href || /^(?:javascript|data|vbscript):/i.test(href)) return "";
    const name = (alt?.[1] || alt?.[2] || "").replace(/[\[\]]/g, "");
    return `![${name}](${href})`;
  }).replace(/<br\s*\/?>/gi, "\n");
}

function readableSource(raw) {
  let text = String(raw || "").replace(/\r\n/g, "\n");
  if (!isHtmlDocument(text)) return text;
  text = liftImages(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h([1-6])[^>]*>/gi, (_, level) => `\n${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const name = label.replace(/<[^>]+>/g, "").replace(/[\[\]]/g, "").trim();
      return name ? `[${name}](${href})` : "";
    })
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
  return text
    .replace(/\[!\[[^\]]*\]\(([^)\n]+)\)\]\([^)\n]*\)/g, (all, src) => (BADGE.test(src) ? "" : all))
    .replace(/!\[[^\]]*\]\(([^)\n]+)\)/g, (all, src) => (BADGE.test(src) ? "" : all))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function markAlerts(html) {
  return html.replace(/<blockquote>\n<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n?/g, (_, kind) => {
    return `<blockquote class="md-alert is-${kind.toLowerCase()}">\n<p><strong>${ALERTS[kind]}</strong> `;
  });
}

function parserFor(repoUrl) {
  const renderer = new Renderer();
  const renderTable = renderer.table;
  renderer.html = () => "";
  renderer.heading = function heading({ tokens, depth }) {
    const level = Math.min(6, depth + 1);
    return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
  };
  renderer.image = function image({ href, title, text }) {
    const src = readmeUrl(href, repoUrl, "img");
    if (!src) return "";
    const tip = title ? ` title="${esc(title)}"` : "";
    return `<img src="${esc(src)}" alt="${esc(text || "")}"${tip} loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`;
  };
  renderer.link = function link({ href, title, tokens }) {
    const url = readmeUrl(href, repoUrl, "link");
    const inner = this.parser.parseInline(tokens);
    if (!url) return inner;
    const tip = title ? ` title="${esc(title)}"` : "";
    const blank = /^https?:/i.test(url) ? ` target="_blank" rel="noopener noreferrer"` : "";
    return `<a href="${esc(url)}"${tip}${blank}>${inner}</a>`;
  };
  renderer.table = function table(token) {
    return `<div class="md-table">${renderTable.call(this, token)}</div>\n`;
  };
  return new Marked({ renderer, gfm: true, breaks: false });
}

export function renderReadme(raw, repoUrl) {
  const text = stripBadges(liftImages(readableSource(raw))).slice(0, 14000);
  if (!text.trim()) return "";
  return markAlerts(parserFor(repoUrl || "").parse(text));
}
