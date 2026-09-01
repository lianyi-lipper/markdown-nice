const fs = require("fs");
const path = require("path");
const source = fs
  .readFileSync(path.join(__dirname, "markdownDiagnostics.js"), "utf8")
  .replace(/export default diagnoseMarkdown;\s*/, "")
  .concat("\nreturn diagnoseMarkdown;\n");
const diagnoseMarkdown = Function(source)();

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

  test("does not validate dollar signs inside code", () => {
    expect(diagnoseMarkdown("`$\\notACommand{$`\n```\n$$\\bad{$$\n```")).toEqual([]);
  });
});
