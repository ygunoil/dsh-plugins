import assert from "node:assert/strict";
import test from "node:test";
import { renderReadme } from "../public/readme.js";

const repo = "https://github.com/Foo/Bar";

test("readme keeps tables, code, pictures and drops scripts", () => {
  const html = renderReadme(`# 标题

![界面](./docs/shot.png)

| 名称 | 说明 |
| --- | --- |
| web | 终端 |

\`\`\`js
const n = 1
\`\`\`

- [x] 已完成
- 子项
  - 嵌套

> [!WARNING]
> 先看风险

[仓库](./README.md#安装)

<script>alert(1)</script>
![x](javascript:alert(1))
[坏链](javascript:alert(1))
`, repo);
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /src="https:\/\/raw\.githubusercontent\.com\/Foo\/Bar\/HEAD\/docs\/shot\.png"/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-js"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /class="md-alert is-warning"/);
  assert.match(html, /href="https:\/\/github\.com\/Foo\/Bar\/blob\/HEAD\/README\.md#安装"/);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("javascript:"), false);
});

test("readme drops badge images and keeps a real screenshot", () => {
  const html = renderReadme(`![build](https://img.shields.io/badge/build-passing)
![界面](https://raw.githubusercontent.com/Foo/Bar/main/shot.png)`, repo);
  assert.equal(html.includes("shields.io"), false);
  assert.match(html, /shot\.png/);
});

test("readme image alt cannot break out of the attribute", () => {
  const html = renderReadme(`![" onerror="alert(1)](./a.png)`, repo);
  assert.equal(html.includes("onerror=\"alert"), false);
  assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)"/);
});
