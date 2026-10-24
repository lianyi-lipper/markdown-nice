/* eslint-env jest */
const MarkdownIt = require("markdown-it");
const imsize = require("markdown-it-imsize");
const svgDataImages = require("./markdown-it-svg-data");

test("renders restored SVG data URLs as images through the editor's image parser", () => {
  const svg =
    "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
  const md = new MarkdownIt({html: true}).use(imsize).use(svgDataImages);
  const html = md.render("![矢量图](" + svg + " =300x200)");
  expect(html).toContain('<img src="' + svg + '"');
  expect(html).toContain('width="300"');
  expect(html).toContain('height="200"');
  expect(html).toContain('alt="矢量图"');
  expect(md.validateLink("javascript:alert(1)")).toBe(false);
  expect(md.validateLink("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
  expect(md.validateLink("data:image/svg+xml,<svg/>")).toBe(false);
});
