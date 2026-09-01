const fs = require("fs");
const path = require("path");
const katex = require("katex");

const source = fs
  .readFileSync(path.join(__dirname, "markdownDiagnostics.js"), "utf8")
  .replace(/import katex from "katex";\s*/, "")
  .replace(/export default diagnoseMarkdown;\s*/, "")
  .concat("\nreturn diagnoseMarkdown;\n");
const diagnoseMarkdown = Function("katex", source)(katex);

describe("markdown diagnostics LaTeX validation", () => {
  test("reports a less-than sign that the preview mistakes for an HTML tag", () => {
    const content = ["可得", "", "$$", "x_0 <a+\\sqrt{3-\\frac1{a^2}}<0.", "$$", "", "所以"].join("\n");

    const diagnostics = diagnoseMarkdown(content);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 4,
          marker: "<",
          message: expect.stringContaining("误当成 HTML 标签"),
        }),
      ]),
    );
  });

  test("accepts valid inline and block LaTeX", () => {
    const content = ["设 $x_0=a$。", "", "$$", "x_0< a+\\sqrt{3-\\frac1{a^2}}<0", "$$"].join("\n");

    expect(diagnoseMarkdown(content)).toEqual([]);
  });

  test("still reports genuine LaTeX parse errors", () => {
    const diagnostics = diagnoseMarkdown("$\\frac{1}$");

    expect(diagnostics).toEqual([
      expect.objectContaining({marker: "LaTeX", message: expect.stringContaining("LaTeX 公式解析失败")}),
    ]);
  });

  test("does not validate dollar signs inside code", () => {
    expect(diagnoseMarkdown("`$\\notACommand{$`\n```\n$$\\bad{$$\n```")).toEqual([]);
  });
});
