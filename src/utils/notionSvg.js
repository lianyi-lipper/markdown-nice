const DOMPurify = require("dompurify");

const SVG_NS = "http://www.w3.org/2000/svg";
const RASTER_DATA = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i;
const LOCAL_REFERENCE = /^#[a-z_][\w:.-]*$/i;
const CSS_ATTRIBUTES = new Set([
  "style",
  "fill",
  "stroke",
  "filter",
  "clip-path",
  "mask",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
]);

function parseSvg(source) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || !root || root.localName !== "svg" || root.namespaceURI !== SVG_NS) {
    throw new Error("SVG 文件格式无效。");
  }
  return root;
}

function checkCss(value) {
  // Keep ordinary SVG styling and local paint servers, but no imported resources,
  // CSS escapes/comments that could disguise a URL, or executable legacy CSS.
  // eslint-disable-next-line no-control-regex
  if (/[\\@<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|\/\*|expression\s*\(|-moz-binding|behavior\s*:/i.test(value)) {
    throw new Error("SVG 含有不支持的样式，请移除外部样式或特殊 CSS 后重试。");
  }
  const withoutUrls = value.replace(/url\(\s*(['"]?)(#[a-z_][\w:.-]*)\1\s*\)/gi, "");
  if (/url\s*\(/i.test(withoutUrls)) {
    throw new Error("SVG 引用了外部资源，请先将图片或字体嵌入 SVG 后重试。");
  }
}

function sanitizeNotionSvg(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("SVG 不支持文档类型或实体声明。");
  parseSvg(source); // Do not let HTML error recovery silently repair broken XML.
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: {svg: true, svgFilters: true},
    FORBID_TAGS: ["script", "foreignObject", "animate", "animateMotion", "animateTransform", "set", "discard"],
    FORBID_ATTR: ["xml:base"],
    ALLOW_DATA_ATTR: false,
  });
  const root = parseSvg(clean);
  for (const node of [root, ...root.querySelectorAll("*")]) {
    if (node.localName === "style") checkCss(node.textContent);
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "href" || name === "xlink:href" || name === "src") {
        const value = attr.value.trim();
        const embeddedRaster = ["image", "feImage"].includes(node.localName) && RASTER_DATA.test(value);
        if (value && !LOCAL_REFERENCE.test(value) && !embeddedRaster) {
          throw new Error("SVG 引用了外部资源，请先将图片或字体嵌入 SVG 后重试。");
        }
      } else if (CSS_ATTRIBUTES.has(name)) checkCss(attr.value);
    }
  }
  // Never insert this document into the page DOM: it is stored/rendered as an img
  // data URL. SVG geometry, text, viewBox and embedded raster bytes stay intact.
  return root.outerHTML;
}

module.exports = {sanitizeNotionSvg};
