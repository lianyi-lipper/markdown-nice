/* eslint-env jest */
const {sanitizeNotionSvg} = require("./notionSvg");
const wrap = (body, attrs = "") =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200" ' +
  attrs +
  ">" +
  body +
  "</svg>";

test("preserves vector geometry, Chinese labels, styles and local paint references", () => {
  const clean = sanitizeNotionSvg(
    wrap(
      '<defs><linearGradient id="paint"><stop offset="0" stop-color="blue"/></linearGradient></defs>' +
        '<style>.label { fill: #337ea9; font-size: 20px; }</style><path d="M0 0L20 20" fill="url(#paint)"/>' +
        '<text class="label" x="10" y="30">半圆 α₁</text>',
    ),
  );
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 300 200");
  expect(doc.querySelector("path").getAttribute("d")).toBe("M0 0L20 20");
  expect(doc.querySelector("path").getAttribute("fill")).toBe("url(#paint)");
  expect(doc.querySelector("text").textContent).toBe("半圆 α₁");
  expect(doc.querySelector("style").textContent).toContain("#337ea9");
});

test("preserves a raster image already embedded inside an SVG", () => {
  const raster = "data:image/png;base64,aGVsbG8=";
  const clean = sanitizeNotionSvg(wrap('<image href="' + raster + '" width="300" height="200"/>'));
  expect(clean).toContain(raster);
});

test("removes event handlers, HTML embedding and animation", () => {
  const source = wrap(
    "<foreignObject><div>HTML</div></foreignObject>" +
      '<circle r="10" onclick="alert(1)"><animate attributeName="r" to="20"/></circle>',
    'onload="alert(1)"',
  );
  const clean = sanitizeNotionSvg(source);
  expect(clean).not.toMatch(/script|foreignObject|onload|onclick|animate|alert\(/i);
  expect(clean).toContain("circle");
});

test("never retains executable scripts", () => {
  // This repository's old jsdom XML parser rejects script nodes before sanitizing;
  // real browser validation additionally checks that valid SVG scripts are removed.
  try {
    const clean = sanitizeNotionSvg(wrap('<script>alert(1)</script><circle r="10"/>'));
    expect(clean).not.toMatch(/script|alert\(/i);
  } catch (error) {
    expect(error.message).toBe("SVG 文件格式无效。");
  }
});

test("rejects external or nested SVG resources without making network requests", () => {
  for (const body of [
    '<image href="https://example.com/private.png"/>',
    '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    '<style>@import "https://example.com/font.css";</style>',
    '<path style="fill:url(https://example.com/paint.svg#x)"/>',
    '<path style="fill:u\\72l(https://example.com/x)"/>',
    '<path fill="url(//example.com/x)"/>',
  ])
    expect(() => sanitizeNotionSvg(wrap(body))).toThrow(/SVG/);
});

test("rejects broken XML, HTML and DTD entities", () => {
  for (const source of [
    "<svg><path></svg>",
    "<html/>",
    '<!DOCTYPE svg [<!ENTITY value "test">]>' + wrap("<text>&value;</text>"),
  ]) {
    expect(() => sanitizeNotionSvg(source)).toThrow(/SVG/);
  }
});
