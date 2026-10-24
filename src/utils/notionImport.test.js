/* eslint-env jest */
const {importNotionPage} = require("./notionImport");
const MarkdownIt = require("markdown-it");
const fs = require("fs");
const path = require("path");
const mathPlugin = Function(
  fs.readFileSync(path.join(__dirname, "markdown-it-math.js"), "utf8").replace("export default", "return"),
)();
const md = new MarkdownIt({html: true}).use(mathPlugin);
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFzQAAAAASUVORK5CYII=";

test("keeps editable equations, Notion colors and expanded teacher notes", async () => {
  const result = await importNotionPage({
    title: "课堂",
    markdown: [
      "## 公式",
      '<span color="red">**重要** $`x_1<2`$</span>',
      '重点。 {color="yellow_bg"}',
      "<details>",
      "<summary>教师备注</summary>",
      "$$",
      "\\text{子集个数}=2^n",
      "$$",
      "</details>",
      '<table><tr><td color="blue">$`x<y`$</td><td>**说明**</td></tr></table>',
    ].join("\n"),
  });
  expect(result.markdown).toContain("$x_1<2$");
  expect(result.markdown).toContain("$$\n\\text{子集个数}=2^n\n$$");
  expect(result.markdown).toContain("$x&lt;y$");
  expect(result.markdown).toContain("color:#d44c47;");
  expect(result.markdown).toContain('<strong style="color:inherit;">重要</strong>');
  expect(result.markdown).toContain("background-color:#fbf3db;");
  expect(result.markdown).toContain("color:#337ea9;");
  expect(result.markdown).toContain("**教师备注**");
  expect(result.markdown).not.toMatch(/<details|<svg|math-slot/);
  expect(result.stats).toMatchObject({inline_math: 2, display_math: 1, toggles: 1});
  const root = document.createElement("div");
  root.innerHTML = md.render(result.markdown);
  expect(root.textContent).toContain("x_1<2");
  expect(root.textContent).toContain("x<y");
  expect(root.textContent).toContain("教师备注");
});

test("supports standard and Notion inline math without parsing code or escaped dollars", async () => {
  const result = await importNotionPage({
    markdown: [
      "普通 $x<y$，Notion $`a_b`$。\\$100 是文字。",
      "`$not_math$` 和 ``$`still_code`$``。",
      "```tex",
      "$code_only$",
      "<script>literal</script>",
      "```",
    ].join("\n"),
  });
  expect(result.stats.inline_math).toBe(2);
  expect(result.markdown).toContain("$x<y$");
  expect(result.markdown).toContain("$a_b$");
  expect(result.markdown).toContain("\\$100");
  expect(result.markdown).toContain("```tex\n$code_only$\n<script>literal</script>\n```");
});

test("keeps nested colors, underline and Notion bold with internal spaces", async () => {
  const result = await importNotionPage({
    markdown: '<span color="red"><span underline="true">** 重点 **</span>和<span color="blue">*蓝色*</span></span>',
  });
  expect(result.markdown).toContain("text-decoration:underline;");
  expect(result.markdown).toContain('<strong style="color:inherit;"> 重点 </strong>');
  expect(result.markdown).toContain('<em style="color:inherit;">蓝色</em>');
  expect(result.stats.colors).toBe(2);
});

test("keeps nested lists, child equations and checkboxes in reading order", async () => {
  const result = await importNotionPage({
    markdown: ["- 父项目", "\t- 子项目 $`x=1`$", "\t- [x] 完成", "- 下个项目", "> 板书", "\t$$", "\tx&<y", "\t$$"].join(
      "\n",
    ),
  });
  expect(result.markdown).toContain("  - 子项目 $x=1$");
  expect(result.markdown).toContain("☑ 完成");
  expect(result.markdown).toContain("- 下个项目");
  const root = document.createElement("div");
  root.innerHTML = md.render(result.markdown);
  expect(root.querySelector("ul ul")).not.toBeNull();
  expect(root.querySelector("blockquote").textContent).toContain("x&<y");
  expect(result.stats).toMatchObject({inline_math: 1, display_math: 1});
});

test("source HTML stays inert while generated table attributes are allowlisted", async () => {
  const result = await importNotionPage({
    markdown: [
      "<script>alert(1)</script>",
      "普通文本 <img src=x onerror=alert(1)>",
      '<span color="red" onclick="alert(1)">文字</span>',
      '<table onclick="alert(1)"><tr><td onmouseover="alert(1)">文本 &amp; $`x<y`$</td></tr></table>',
    ].join("\n"),
  });
  const root = document.createElement("div");
  root.innerHTML = md.render(result.markdown);
  expect(root.querySelector("script,img,[onclick],[onmouseover],[onerror]")).toBeNull();
  expect(root.textContent).toContain("<script>alert(1)</script>");
  expect(root.querySelector("td").textContent).toContain("文本 & $x<y$");
});

test("deduplicates local images and keeps large data outside editable Markdown", async () => {
  const loadImage = jest.fn().mockResolvedValue(PNG);
  const result = await importNotionPage({markdown: "![图1](" + PNG + ")\n![图2](" + PNG + ")"}, {loadImage});
  expect(loadImage).toHaveBeenCalledTimes(1);
  expect(result.images).toHaveLength(1);
  expect(result.images[0].dataUrl).toBe(PNG);
  expect(result.markdown.match(/mdnice-local-image:\/\//g)).toHaveLength(2);
  expect(result.markdown).not.toContain("base64");
  expect(result.stats.images).toBe(1);
});

test("keeps an inaccessible external image with an explicit warning", async () => {
  const loadImage = jest.fn().mockRejectedValue(new TypeError("CORS"));
  const result = await importNotionPage({markdown: "![图](https://example.com/image.png)\n后续文字"}, {loadImage});
  expect(result.markdown).toContain("![图](https://example.com/image.png)");
  expect(result.markdown).toContain("后续文字");
  expect(result.images).toHaveLength(0);
  expect(result.stats.images).toBe(1);
  expect(result.warnings[0].code).toBe("external_images");
  await expect(importNotionPage({markdown: "![图](" + PNG + ")"}, {loadImage})).rejects.toThrow("内嵌图片无法读取");
});

test("imports embedded SVG references and reports SVG-specific failures accurately", async () => {
  const svg =
    "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
  const result = await importNotionPage({markdown: "![矢量图](" + svg + ")"}, {loadImage: async () => svg});
  expect(result.images).toHaveLength(1);
  expect(result.images[0].dataUrl).toBe(svg);
  expect(result.markdown).toContain("mdnice-local-image://");
  const failed = await importNotionPage(
    {markdown: "![图](https://example.com/a.svg)"},
    {
      loadImage: async () => {
        throw new Error("SVG 文件格式无效。");
      },
    },
  );
  expect(failed.warnings[0].message).toContain("SVG 文件格式无效");
  expect(failed.warnings[0].message).not.toContain("跨域");
});

test("rejects incomplete, unsupported or malformed source instead of silently dropping content", async () => {
  for (const source of [
    {markdown: "内容", truncated: true},
    {markdown: "内容", unknown_block_ids: ["abc"]},
    {markdown: "内容", unknown_block_count: 1},
    {markdown: "<video>视频</video>"},
    {markdown: ""},
    {markdown: {}},
    null,
    {markdown: "$$\nx"},
    {markdown: "<details>\n内容"},
    {markdown: "```\n代码"},
    {markdown: "<table><tr><td>未闭合"},
    {markdown: "<table><tr><td><script>坏内容</script></td></tr></table>"},
    {markdown: "字".repeat(100001)},
    {markdown: "![内网](https://127.0.0.1/image.png)"},
  ]) {
    await expect(importNotionPage(source)).rejects.toThrow();
  }
});

test("accepts complete API responses and extracts saved connector content without duplicate titles", async () => {
  const api = await importNotionPage({
    title: "标题",
    markdown: "# 标题\n内容",
    truncated: false,
    unknown_block_ids: [],
  });
  expect(api.markdown.match(/# 标题/g)).toHaveLength(1);
  const saved = await importNotionPage({
    title: "标题",
    text: "<page>\n<properties>metadata</properties>\n<content>\n内容 $`x=1`$\n</content>\n</page>",
  });
  expect(saved.markdown).toBe("# 标题\n\n内容 $x=1$");
  expect(saved.markdown).not.toContain("metadata");
});
