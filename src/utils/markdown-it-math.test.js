/* eslint-env jest */
const fs = require("fs");
const path = require("path");
const MarkdownIt = require("markdown-it");
const source = fs.readFileSync(path.join(__dirname, "markdown-it-math.js"), "utf8").replace("export default", "return");
const mathPlugin = Function(source)();
const md = new MarkdownIt({html: true}).use(mathPlugin);

test("comparison formulas keep their TeX and cannot swallow following text", () => {
  const text = "若 $0<x<1$，区间是 $(0,1)$。";
  const root = document.createElement("div");
  root.innerHTML = md.render(text);
  expect(root.textContent.trim()).toBe(text);
  expect(root.querySelectorAll("p")).toHaveLength(1);
  expect(root.querySelectorAll("p *")).toHaveLength(0);
});

test("display formulas preserve ampersands and comparisons as text for MathJax", () => {
  const tex = "\\begin{aligned}x&<y\\\\y&>0\\end{aligned}";
  const root = document.createElement("div");
  root.innerHTML = md.render("$$\n" + tex + "\n$$");
  expect(root.textContent).toContain(tex);
  expect(root.children).toHaveLength(0);
});

test("HTML-looking content inside TeX is not an executable element", () => {
  const tex = "\\text{<img src=x onerror=alert(1)>}";
  const root = document.createElement("div");
  root.innerHTML = md.render("$" + tex + "$");
  expect(root.querySelector("img")).toBeNull();
  expect(root.textContent.trim()).toBe("$" + tex + "$");
});
