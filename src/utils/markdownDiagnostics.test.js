/* eslint-env jest */
const fs = require("fs");
const path = require("path");
const source = fs
  .readFileSync(path.join(__dirname, "markdownDiagnostics.js"), "utf8")
  .replace(/export default diagnoseMarkdown;\s*/, "")
  .concat("\nreturn diagnoseMarkdown;\n");
const diagnoseMarkdown = Function(source)();

describe("markdown diagnostics LaTeX validation", () => {
  test("accepts less-than signs now that math output is HTML-escaped", () => {
    const content = ["可得", "", "$$", "x_0 <a+\\sqrt{3-\\frac1{a^2}}<0.", "$$", "", "所以"].join("\n");

    const diagnostics = diagnoseMarkdown(content);

    expect(diagnostics).toEqual([]);
  });

  test("accepts valid inline and block LaTeX", () => {
    const content = ["设 $x_0=a$。", "", "$$", "x_0< a+\\sqrt{3-\\frac1{a^2}}<0", "$$"].join("\n");

    expect(diagnoseMarkdown(content)).toEqual([]);
  });

  test("does not validate dollar signs inside code", () => {
    expect(diagnoseMarkdown("`$\\notACommand{$`\n```\n$$\\bad{$$\n```")).toEqual([]);
  });

  test("accepts bold text next to normal paragraph and list spacing", () => {
    expect(diagnoseMarkdown("**使用方式：** 正文\n\n- **集合与元素**：正文\n\n这是 **重点** 内容。")).toEqual([]);
  });

  test("still reports spaces inside bold delimiters", () => {
    expect(diagnoseMarkdown("** 错误**")[0].message).toContain("起始 ** 后面是空格");
    expect(diagnoseMarkdown("**错误 **")[0].message).toContain("结束 ** 前面是空格");
    expect(diagnoseMarkdown("**未闭合")[0].message).toContain("未闭合");
  });
});
