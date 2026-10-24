/* The renderer and exporter are paired passes; parser scans intentionally assign inside parentheses. */
/* eslint max-classes-per-file: ["error", 2], no-cond-assign: ["error", "except-parens"] */
/* Convert Notion enhanced Markdown entirely in the browser.
 * Only generated, allowlisted HTML is retained; equations stay editable TeX.
 */
const MarkdownIt = require("markdown-it");
const svgDataImages = require("./markdown-it-svg-data");
const {loadNotionImage, imageUrl} = require("./notionImages");

const MAX_MARKDOWN_CHARS = 100000;
const TEXT_COLORS = {
  gray: "#787774",
  brown: "#9f6b53",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#448361",
  blue: "#337ea9",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#d44c47",
};
const BG_COLORS = {
  gray: "#f1f1ef",
  brown: "#f4eeee",
  orange: "#fbecdd",
  yellow: "#fbf3db",
  green: "#edf3ec",
  blue: "#e7f3f8",
  purple: "#f4f0f7",
  pink: "#f9eef3",
  red: "#fbe4e4",
};
const NOTE_STYLE = "margin:20px 0;padding:16px 18px;background-color:#f7f7f5;border-left:3px solid #c8c5bd;";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeText(text) {
  return escapeHtml(text).replace(/([\\`*_[\]{}#!|$~])/g, "\\$1");
}

function colorStyle(value) {
  if (!value || value === "default") return "";
  if (/_(bg|background)$/.test(value) && BG_COLORS[value.split("_")[0]]) {
    return "background-color:" + BG_COLORS[value.split("_")[0]] + ";";
  }
  if (TEXT_COLORS[value]) return "color:" + TEXT_COLORS[value] + ";";
  throw new Error("暂不支持此 Notion 颜色：" + value);
}

function attribute(source, name) {
  const match = source.match(new RegExp("(?:^|\\s)" + name + '="([^"]*)"'));
  return match ? match[1] : "";
}

function safeLink(value) {
  if (/^(https?:\/\/|mailto:|#)/i.test(value)) return value;
  throw new Error("页面中含有不支持的链接地址。");
}

function parseHtml(html) {
  // Template contents are inert: source markup must never enter the live DOM.
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function isEscaped(text, index) {
  let count = 0;
  while (index > 0 && text[--index] === "\\") count += 1;
  return count % 2 === 1;
}

function inlineMath(text, start) {
  if (text[start] !== "$" || isEscaped(text, start) || text[start + 1] === "$") return null;
  if (text[start + 1] === "`") {
    const end = text.indexOf("`$", start + 2);
    if (end < 0 || text.slice(start, end).includes("\n")) return null;
    return {tex: text.slice(start + 2, end), end: end + 2};
  }
  if (!text[start + 1] || /\s/.test(text[start + 1])) return null;
  let end = start + 1;
  while ((end = text.indexOf("$", end)) >= 0) {
    if (!isEscaped(text, end) && end > start + 1 && !/\s/.test(text[end - 1]) && !/\d/.test(text[end + 1] || "")) {
      if (text.slice(start, end).includes("\n")) return null;
      return {tex: text.slice(start + 1, end), end: end + 1};
    }
    end += 1;
  }
  return null;
}

function indentation(line) {
  return line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
}

class NotionRenderer {
  constructor() {
    this.formulas = [];
    this.stats = {inline_math: 0, display_math: 0, images: 0, colors: 0, toggles: 0, paragraphs: 0};
    this.md = new MarkdownIt("commonmark", {html: false}).enable("strikethrough");
    this.md.use(svgDataImages);
    this.md.inline.ruler.before("escape", "notion_rich_text", (state, silent) => this.richText(state, silent));
    this.md.renderer.rules.notion_rich_text = (tokens, index) => tokens[index].content;
  }

  math(tex, display = false) {
    const index = this.formulas.length;
    this.formulas.push({tex, display});
    this.stats[display ? "display_math" : "inline_math"] += 1;
    return '<math-slot data-index="' + index + '"></math-slot>';
  }

  inline(text) {
    return this.md.renderInline(text);
  }

  richText(state, silent) {
    const start = state.pos;
    const text = state.src.slice(start, state.posMax);
    let end = 0;
    let render;
    const equation = inlineMath(state.src.slice(0, state.posMax), start);
    if (equation) {
      end = equation.end - start;
      render = () => this.math(equation.tex);
    } else if (/^<span\b/.test(text)) {
      const open = text.match(/^<span\b([^>]*)>/);
      if (!open) return false;
      const tags = /<\/?span\b[^>]*>/g;
      tags.lastIndex = open[0].length;
      let depth = 1;
      let close;
      while ((close = tags.exec(text))) {
        depth += close[0].startsWith("</") ? -1 : 1;
        if (depth === 0) break;
      }
      if (!close || depth) throw new Error("Notion 颜色标记未闭合，请检查原始内容。");
      end = close.index + close[0].length;
      render = () => {
        const color = attribute(open[1], "color");
        let style = colorStyle(color);
        if (color) this.stats.colors += 1;
        if (attribute(open[1], "underline") === "true") style += "text-decoration:underline;";
        return '<span style="' + style + '">' + this.inline(text.slice(open[0].length, close.index)) + "</span>";
      };
    } else if (/^<(mention-page|page)\s/.test(text)) {
      const mention = text.match(/^<(mention-page|page)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
      if (!mention) return false;
      end = mention[0].length;
      render = () =>
        '<a href="' +
        escapeHtml(safeLink(attribute(mention[2], "url"))) +
        '">' +
        this.inline(mention[3] || "查看原文页面") +
        "</a>";
    } else if (/^<br\s*\/?>/.test(text)) {
      end = text.match(/^<br\s*\/?>/)[0].length;
      render = () => "<br>";
    } else if (text.startsWith("**")) {
      // Notion allows spaces inside bold markers; CommonMark does not.
      let closing = 2;
      while ((closing = text.indexOf("**", closing)) >= 0 && isEscaped(text, closing)) closing += 2;
      if (closing <= 2) return false;
      end = closing + 2;
      render = () => "<strong>" + this.inline(text.slice(2, closing)) + "</strong>";
    } else {
      return false;
    }
    if (!silent) {
      const token = state.push("notion_rich_text", "", 0);
      token.content = render();
    }
    state.pos = start + end;
    return true;
  }

  blockStyle(line) {
    const attrs = line.match(/\s+\{((?:(?:color="[^"]+"|toggle="true")\s*)+)\}$/);
    if (!attrs) return {line, style: ""};
    const color = attribute(attrs[1], "color");
    if (color) this.stats.colors += 1;
    return {line: line.slice(0, attrs.index), style: colorStyle(color)};
  }

  table(source) {
    // Protect '<' and '&' in TeX before the HTML table parser sees them.
    let prefix = "NICENOTIONTABLEMATH";
    while (source.includes(prefix)) prefix += "X";
    const slots = new Map();
    let protectedSource = "";
    for (let pos = 0; pos < source.length; ) {
      if (source[pos] === "`" && !isEscaped(source, pos)) {
        const fence = source.slice(pos).match(/^`+/)[0];
        const end = source.indexOf(fence, pos + fence.length);
        if (end >= 0) {
          protectedSource += source.slice(pos, end + fence.length);
          pos = end + fence.length;
          continue;
        }
      }
      const math = inlineMath(source, pos);
      if (math) {
        const key = prefix + slots.size + "END";
        slots.set(key, this.math(math.tex));
        protectedSource += key;
        pos = math.end;
      } else {
        protectedSource += source[pos++];
      }
    }
    const fragment = parseHtml(protectedSource);
    const allowed = new Set(["table", "tr", "td", "th", "colgroup", "col", "span", "br", "tbody", "thead", "tfoot"]);
    for (const node of fragment.querySelectorAll("*")) {
      if (!allowed.has(node.localName)) throw new Error("表格中含有暂不支持的元素：" + node.localName);
    }
    const table = fragment.querySelector("table");
    if (!table || Array.from(fragment.childNodes).some((node) => node !== table && node.textContent.trim())) {
      throw new Error("Notion 表格格式不完整，请检查原始内容。");
    }
    for (const node of table.querySelectorAll("*")) {
      if (node.localName === "span" || node.localName === "br") {
        if (!node.closest("td,th")) throw new Error("Notion 表格的富文本必须位于单元格中。");
        continue;
      }
      const color = node.getAttribute("color");
      for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
      if (color) {
        node.setAttribute("style", colorStyle(color));
        this.stats.colors += 1;
      }
    }
    for (const attr of Array.from(table.attributes)) table.removeAttribute(attr.name);
    for (const cell of table.querySelectorAll("td,th")) {
      let html = this.inline(cell.innerHTML);
      for (const [key, value] of slots) html = html.split(key).join(value);
      cell.textContent = "";
      cell.appendChild(parseHtml(html));
    }
    return table.outerHTML;
  }

  blocks(source) {
    const lines = source.split(/\r?\n/);
    const output = [];
    let index = 0;
    const childrenAfter = (parentIndent) => {
      const children = [];
      while (index < lines.length && (!lines[index].trim() || indentation(lines[index]) > parentIndent)) {
        children.push(lines[index++]);
      }
      return children.join("\n");
    };
    while (index < lines.length) {
      const raw = lines[index++];
      let line = raw.trim();
      if (!line) continue;
      const parentIndent = indentation(raw);
      if (line === "$$") {
        const tex = [];
        while (index < lines.length && lines[index].trim() !== "$$") tex.push(lines[index++].trim());
        if (index === lines.length) throw new Error("块级公式未闭合，请检查原始内容。");
        index += 1;
        output.push('<section class="equation">' + this.math(tex.join("\n"), true) + "</section>");
        continue;
      }
      if (/^\$\$.+\$\$$/.test(line)) {
        output.push('<section class="equation">' + this.math(line.slice(2, -2).trim(), true) + "</section>");
        continue;
      }
      const fence = line.match(/^(`{3,}|~{3,})(.*)$/);
      if (fence) {
        const code = [];
        const closing = new RegExp("^" + fence[1][0] + "{" + fence[1].length + ",}\\s*$");
        while (index < lines.length && !closing.test(lines[index].trim())) {
          // Keep code indentation relative to its enclosing Notion block.
          const content = lines[index++];
          code.push(content.slice(Math.min(content.match(/^\t*/)[0].length, raw.match(/^\t*/)[0].length)));
        }
        if (index === lines.length) throw new Error("代码块未闭合，请检查原始内容。");
        index += 1;
        const language = fence[2].trim().match(/^[a-z\d_-]+/i);
        output.push(
          '<pre data-language="' +
            (language ? language[0] : "") +
            '"><code>' +
            escapeHtml(code.join("\n")) +
            "</code></pre>",
        );
        continue;
      }
      const note = line.match(/^<(details|callout)\b([^>]*)>/);
      if (note) {
        const body = [];
        let depth = 1;
        while (index < lines.length) {
          const child = lines[index++];
          if (new RegExp("^<" + note[1] + "(?:\\s|>)").test(child.trim())) depth += 1;
          if (child.trim() === "</" + note[1] + ">") depth -= 1;
          if (!depth) break;
          body.push(child);
        }
        if (depth) throw new Error("折叠块或提示块未闭合，请检查原始内容。");
        const color = attribute(note[2], "color");
        if (color) this.stats.colors += 1;
        if (note[1] === "details") this.stats.toggles += 1;
        output.push(
          '<section class="note" style="' + colorStyle(color) + '">' + this.blocks(body.join("\n")) + "</section>",
        );
        continue;
      }
      if (line.startsWith("<summary>") && line.endsWith("</summary>")) {
        output.push('<p class="note-title">' + this.inline(line.slice(9, -10)) + "</p>");
        continue;
      }
      if (/^<table(?:\s|>)/.test(line)) {
        const table = [line];
        while (!table[table.length - 1].includes("</table>") && index < lines.length) table.push(lines[index++]);
        if (!table[table.length - 1].includes("</table>")) throw new Error("表格未闭合，请检查原始内容。");
        output.push(this.table(table.join("\n")));
        continue;
      }
      if (/^<\/?(columns|column)(\s|>)/.test(line)) continue;
      const styled = this.blockStyle(line);
      line = styled.line;
      const {style} = styled;
      if (line === "---") {
        output.push("<hr>");
        continue;
      }
      if (line === "<empty-block/>") {
        output.push("<p><br></p>");
        continue;
      }
      if (
        /^<(unknown|database|synced_block(?:_reference)?|image|video|audio|embed|file|pdf|tabs|custom-block|table_of_contents|meeting-notes)\b/.test(
          line,
        )
      ) {
        throw new Error("页面包含暂不支持的 Notion 内容块：" + line.match(/^<([^\s>/]+)/)[1]);
      }
      const heading = line.match(/^(#{1,4}) (.*)$/);
      const bullet = line.match(/^(- |\d+\. )(.*)$/);
      if (heading) {
        const tag = "h" + heading[1].length;
        output.push("<" + tag + ' style="' + style + '">' + this.inline(heading[2]) + "</" + tag + ">");
      } else if (bullet) {
        const kind = bullet[1] === "- " ? "ul" : "ol";
        const items = [];
        let current = {text: bullet[2], style};
        for (;;) {
          const body = current.text.replace(/^\[ \] /, "☐ ").replace(/^\[x\] /i, "☑ ");
          const inline = this.inline(body);
          const children = childrenAfter(parentIndent);
          items.push(
            '<li style="' +
              current.style +
              '">' +
              inline +
              (children.trim() ? "\n" + this.blocks(children) : "") +
              "</li>",
          );
          const next = index < lines.length && lines[index].trim().match(/^(- |\d+\. )(.*)$/);
          if (!next || indentation(lines[index]) !== parentIndent || (next[1] === "- " ? "ul" : "ol") !== kind) break;
          const item = this.blockStyle(lines[index++].trim());
          current = {text: item.line.replace(/^(- |\d+\. )/, ""), style: item.style};
        }
        output.push("<" + kind + ">" + items.join("\n") + "</" + kind + ">");
      } else if (line.startsWith("> ")) {
        const children = childrenAfter(parentIndent);
        output.push(
          '<blockquote style="' +
            style +
            '"><p>' +
            this.inline(line.slice(2)) +
            "</p>" +
            (children.trim() ? this.blocks(children) : "") +
            "</blockquote>",
        );
      } else {
        this.stats.paragraphs += 1;
        output.push('<p style="' + style + '">' + this.inline(line) + "</p>");
      }
    }
    return output.join("\n");
  }
}

function hasParentColor(node) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(?:^|;)\s*color:/.test(parent.getAttribute("style") || "")) return true;
  }
  return false;
}

class MarkdownExport {
  constructor(renderer, imageSources) {
    this.renderer = renderer;
    this.imageSources = imageSources;
  }

  math(node) {
    const equation = this.renderer.formulas[Number(node.getAttribute("data-index"))];
    return equation.display ? "$$\n" + equation.tex + "\n$$" : "$" + equation.tex + "$";
  }

  inline(node) {
    if (node.nodeType === 3) return escapeText(node.textContent);
    if (node.nodeType !== 1) return "";
    const tag = node.localName;
    if (tag === "math-slot") return this.math(node);
    if (tag === "img") {
      const src = this.imageSources.get(node.getAttribute("src"));
      return (
        "![" + escapeText(node.getAttribute("alt") || "") + "](" + src.replace(/\(/g, "%28").replace(/\)/g, "%29") + ")"
      );
    }
    if (tag === "code") {
      const text = node.textContent;
      if (hasParentColor(node)) return '<code style="color:inherit;">' + escapeHtml(text) + "</code>";
      const fence = "`".repeat(Math.max(0, ...(text.match(/`+/g) || []).map((x) => x.length)) + 1);
      return fence + " " + text + " " + fence;
    }
    const children = Array.from(node.childNodes)
      .map((child) => this.inline(child))
      .join("");
    if (["strong", "em", "s"].includes(tag)) {
      if (hasParentColor(node)) return "<" + tag + ' style="color:inherit;">' + children + "</" + tag + ">";
      const marker = {strong: "**", em: "*", s: "~~"}[tag];
      return children.trim() === children ? marker + children + marker : "<" + tag + ">" + children + "</" + tag + ">";
    }
    if (tag === "span")
      return '<span style="' + escapeHtml(node.getAttribute("style") || "") + '">' + children + "</span>";
    if (tag === "a") {
      const href = safeLink(node.getAttribute("href"))
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
      if (hasParentColor(node)) return '<a href="' + escapeHtml(href) + '" style="color:inherit;">' + children + "</a>";
      return "[" + children + "](" + href + ")";
    }
    if (tag === "br") return "<br>";
    return children;
  }

  styledInline(node, children = Array.from(node.childNodes)) {
    const text = children.map((child) => this.inline(child)).join("");
    const style = node.getAttribute("style");
    return style ? '<span style="' + escapeHtml(style) + '">' + text + "</span>" : text;
  }

  table(node) {
    const table = node.cloneNode(true);
    for (const slot of table.querySelectorAll("math-slot")) {
      slot.parentNode.replaceChild(document.createTextNode(this.math(slot)), slot);
    }
    for (const image of table.querySelectorAll("img"))
      image.setAttribute("src", this.imageSources.get(image.getAttribute("src")));
    for (const element of table.querySelectorAll("strong,em,s,code,a")) {
      if (hasParentColor(element))
        element.setAttribute("style", (element.getAttribute("style") || "") + "color:inherit;");
    }
    return table.outerHTML;
  }

  blocks(parent) {
    const output = [];
    for (const node of parent.childNodes) {
      if (node.nodeType === 3) {
        if (node.textContent.trim()) output.push(escapeText(node.textContent));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const tag = node.localName;
      if (/^h[1-4]$/.test(tag)) output.push("#".repeat(Number(tag[1])) + " " + this.styledInline(node));
      else if (tag === "p") {
        const text = this.styledInline(node);
        output.push(node.classList.contains("note-title") ? "**" + text + "**" : text);
      } else if (tag === "ul" || tag === "ol") {
        const items = [];
        Array.from(node.children).forEach((child, index) => {
          const marker = tag === "ul" ? "- " : index + 1 + ". ";
          const firstBlock = Array.from(child.childNodes).findIndex(
            (item) =>
              item.nodeType === 1 &&
              ["ul", "ol", "p", "section", "blockquote", "pre", "table", "hr"].includes(item.localName),
          );
          const inline =
            firstBlock < 0 ? Array.from(child.childNodes) : Array.from(child.childNodes).slice(0, firstBlock);
          let item = marker + this.styledInline(child, inline).trimEnd();
          if (firstBlock >= 0) {
            const nested = document.createDocumentFragment();
            Array.from(child.childNodes)
              .slice(firstBlock)
              .forEach((part) => nested.appendChild(part.cloneNode(true)));
            item +=
              "\n\n" +
              this.blocks(nested)
                .split("\n")
                .map((line) => " ".repeat(marker.length) + line)
                .join("\n");
          }
          items.push(item);
        });
        output.push(items.join("\n"));
      } else if (tag === "section") {
        if (node.classList.contains("equation")) output.push(this.math(node.querySelector("math-slot")));
        else
          output.push(
            '<section style="' +
              escapeHtml(NOTE_STYLE + (node.getAttribute("style") || "")) +
              '">\n\n' +
              this.blocks(node) +
              "\n\n</section>",
          );
      } else if (tag === "blockquote") {
        let text = this.blocks(node);
        const style = node.getAttribute("style");
        if (style) text = '<span style="' + escapeHtml(style) + '">' + text + "</span>";
        output.push(
          text
            .split("\n")
            .map((line) => "> " + line)
            .join("\n"),
        );
      } else if (tag === "pre") {
        const text = node.textContent;
        const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) || []).map((x) => x.length + 1)));
        output.push(fence + (node.getAttribute("data-language") || "") + "\n" + text + "\n" + fence);
      } else if (tag === "table") output.push(this.table(node));
      else if (tag === "hr") output.push("---");
      else throw new Error("暂不支持导入此内容：" + tag);
    }
    return output.join("\n\n");
  }
}

function sourceContent(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("请选择有效的 Notion 页面 JSON 文件。");
  if (data.truncated || (data.unknown_block_ids && data.unknown_block_ids.length) || data.unknown_block_count) {
    throw new Error("Notion 返回的内容不完整或包含未知块，请补全页面内容后再导入。");
  }
  let source = data.markdown === undefined ? data.text : data.markdown;
  if (typeof source !== "string") throw new Error("Notion 页面内容必须是文字。");
  const content = source.match(/<content>\r?\n([\s\S]*)\r?\n<\/content>/);
  if (content) [, source] = content;
  if (!source.trim()) throw new Error("页面没有可导入的内容。");
  return {source, title: typeof data.title === "string" && data.title.trim() ? data.title : "Notion 文章"};
}

async function importNotionPage(data, {loadImage = loadNotionImage} = {}) {
  const {source, title} = sourceContent(data);
  const renderer = new NotionRenderer();
  const fragment = parseHtml(renderer.blocks(source));
  const sources = new Map();
  const names = new Map();
  for (const image of fragment.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    imageUrl(src); // Reject unsafe sources before any image requests are made.
    sources.set(src, src);
    names.set(src, image.getAttribute("alt") || "");
  }
  const images = [];
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((item) => item && typeof item.message === "string")
    : [];
  const entries = Array.from(sources.keys());
  let externalImages = 0;
  const imageErrors = new Set();
  for (let offset = 0; offset < entries.length; offset += 3) {
    // Bound downloads to three at a time instead of starting every image at once.
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(
      entries.slice(offset, offset + 3).map(async (src, index) => {
        try {
          const dataUrl = await loadImage(src);
          const id =
            "notion-" +
            Date.now().toString(36) +
            "-" +
            (offset + index) +
            "-" +
            Math.random()
              .toString(36)
              .slice(2, 9);
          return {src, image: {id, dataUrl, filename: names.get(src)}};
        } catch (error) {
          const reason = /^(SVG|图片格式|单张图片|图片尺寸|图片解码)/.test(error.message || "")
            ? error.message
            : "链接过期、跨域限制或网络连接失败。";
          if (src.startsWith("data:")) throw new Error("内嵌图片无法读取：" + reason);
          return {src, image: null, reason};
        }
      }),
    );
    for (const {src, image, reason} of batch) {
      if (image) {
        images.push(image);
        sources.set(src, "mdnice-local-image://" + image.id);
      } else {
        externalImages += 1;
        imageErrors.add(reason);
      }
    }
  }
  if (externalImages) {
    warnings.push({
      code: "external_images",
      message: externalImages + " 张外链图片未能保存，已保留原链接。" + Array.from(imageErrors).join(" "),
    });
  }
  const exporter = new MarkdownExport(renderer, sources);
  let markdown = exporter.blocks(fragment);
  if (markdown.split("\n")[0] !== "# " + escapeText(title)) markdown = "# " + escapeText(title) + "\n\n" + markdown;
  if (markdown.length > MAX_MARKDOWN_CHARS) throw new Error("内容超过编辑器的 100000 字符上限，请拆分页面后导入。");
  renderer.stats.images = sources.size;
  return {title, markdown, images, stats: renderer.stats, warnings};
}

module.exports = {importNotionPage};
