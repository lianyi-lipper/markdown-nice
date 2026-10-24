import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {toCanvas} from "html-to-image";
import markdownItMath from "./markdown-it-math";
import markdownItImsize from "markdown-it-imsize";
import markdownItSvgData from "./markdown-it-svg-data";
import {resolveLocalImages} from "./localImages";
import withMathjax from "./mathjaxQueue";
import {loadNotionImage} from "./notionImages";
import {COVER_HEIGHT, COVER_WIDTHS, COVER_PIXEL_RATIO, resolveCoverImages} from "./coverDraft";

// Keep the article parser and its renderer rules untouched. Formula placeholders
// are converted to self-contained SVG before they enter the cover preview.
const parser = new MarkdownIt({html: true, breaks: true})
  .use(markdownItMath)
  .use(markdownItImsize)
  .use(markdownItSvgData);
const mathMarker = (tokens, index) =>
  `<span data-cover-tex="${parser.utils.escapeHtml(tokens[index].content)}" data-cover-display="${tokens[index].type ===
    "math_block"}"></span>`;
parser.renderer.rules.math_inline = mathMarker;
parser.renderer.rules.math_block = mathMarker;

const imageCache = new Map();
const embedImage = (src) => {
  if (!imageCache.has(src)) {
    if (imageCache.size > 32) imageCache.clear();
    imageCache.set(
      src,
      loadNotionImage(src).catch((error) => {
        imageCache.delete(src);
        throw error;
      }),
    );
  }
  return imageCache.get(src);
};

export const renderCoverContent = async (panel, images, width) => {
  const text = resolveLocalImages(resolveCoverImages(panel.text, images));
  const root = document.createElement("div");
  root.innerHTML = DOMPurify.sanitize(parser.render(text), {
    ALLOWED_TAGS: [
      "p",
      "div",
      "span",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "del",
      "sub",
      "sup",
      "mark",
      "small",
      "blockquote",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "hr",
      "img",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: [
      "src",
      "alt",
      "width",
      "height",
      "style",
      "colspan",
      "rowspan",
      "start",
      "data-cover-tex",
      "data-cover-display",
    ],
    ALLOW_DATA_ATTR: false,
  });
  // Imported rich text may keep emphasis/colors, but cannot move content outside
  // the measured frame or bring in hidden CSS background images.
  root.querySelectorAll("[style]").forEach((element) => {
    const previous = element.style;
    const retained = ["color", "background-color", "font-weight", "font-style", "text-decoration", "text-align"]
      .map((property) => [property, previous.getPropertyValue(property)])
      .filter((entry) => entry[1]);
    element.removeAttribute("style");
    retained.forEach(([property, value]) => element.style.setProperty(property, value));
  });
  const formulas = Array.from(root.querySelectorAll("[data-cover-tex]"));
  if (formulas.length) {
    await withMathjax(async (mathjax) => {
      mathjax.texReset();
      for (let index = 0; index < formulas.length; index += 1) {
        const formula = formulas[index];
        // The shared MathJax engine must finish one formula before starting another.
        // eslint-disable-next-line no-await-in-loop
        const node = await mathjax.tex2svgPromise(formula.getAttribute("data-cover-tex"), {
          display: formula.getAttribute("data-cover-display") === "true",
          em: panel.fontSize,
          ex: panel.fontSize / 2,
          containerWidth: width - panel.padding * 2,
        });
        if (node.querySelector("[data-mjx-error]")) throw new Error("有公式未能正确渲染，请检查 LaTeX 写法。");
        formula.replaceWith(node);
      }
    });
  }
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(async (image) => {
      try {
        image.src = await embedImage(image.getAttribute("src") || "");
        image.removeAttribute("srcset");
      } catch (error) {
        throw new Error(`图片读取失败，请改为粘贴或插入本地图片。${error.message || ""}`);
      }
    }),
  );
  return root.innerHTML;
};

export const waitForCoverAssets = async (root) => {
  if (document.fonts) await document.fonts.ready;
  await Promise.all(Array.from(root.querySelectorAll("img")).map((image) => image.decode()));
  await new Promise((resolve) => requestAnimationFrame(resolve));
};

export const coverOverflows = (canvas) => {
  const content = canvas.firstElementChild;
  const padding = parseFloat(canvas.style.padding) || 0;
  return (
    content.scrollHeight > COVER_HEIGHT - 2 * padding + 1 || content.scrollWidth > canvas.clientWidth - 2 * padding + 1
  );
};

export const exportCoverPng = async (sheet) => {
  await waitForCoverAssets(sheet);
  const canvas = await toCanvas(sheet, {
    width: COVER_WIDTHS.wide + COVER_WIDTHS.square,
    height: COVER_HEIGHT,
    pixelRatio: COVER_PIXEL_RATIO,
    backgroundColor: "#ffffff",
    // The cover uses system fonts and MathJax SVG paths, with images already
    // embedded. Do not fetch unrelated webfonts from the article's stylesheets.
    skipFonts: true,
    style: {transform: "none", margin: "0"},
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片生成失败，请重试。"))), "image/png");
  });
};

export const readCoverImage = (file) => {
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("单张图片不能超过 10 MB。"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  }).then(loadNotionImage);
};
