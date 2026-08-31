const fs = require("fs");
const path = require("path");

const source = fs
  .readFileSync(path.join(__dirname, "examMarkdownDiagnostics.js"), "utf8")
  .replace(/export \{diagnoseExamMarkdown, insertAnswerPlaceholders\};\s*/, "")
  .replace(/export default diagnoseExamMarkdown;\s*/, "")
  .concat("\nreturn {diagnoseExamMarkdown, insertAnswerPlaceholders};\n");
const {diagnoseExamMarkdown, insertAnswerPlaceholders} = Function(source)();

const messages = (markdown) => diagnoseExamMarkdown(markdown).map((issue) => issue.message);

test("accepts current metadata and explicit reference answer modes", () => {
  const markdown = `# 测试卷
region: 全国
variant_labels:
  - 全国Ⅱ卷
  - 文科

## 解答题
type: essay

### Q1
说明理由。

#### Answer
answer_mode: reference
完整参考作答。

### Q2
回答问题。

##### (1)
kind: question
answer_mode: reference
证明结论。

Answer:
完整证明。
`;

  expect(messages(markdown).filter((message) => message.includes("answer_mode"))).toEqual([]);
  expect(messages(markdown).filter((message) => message.includes("未知元数据字段"))).toEqual([]);
});

test("rejects invalid, misplaced, and answerless answer modes", () => {
  const markdown = `# 测试卷

## 解答题
type: essay

### Q1
说明理由。

#### Answer
答案正文。
answer_mode: none

### Q2
回答问题。

##### (1)
kind: question
answer_mode: invalid
证明结论。
`;
  const result = messages(markdown);

  expect(result.some((message) => message.includes("必须是第一条非空行"))).toBe(true);
  expect(result.some((message) => message.includes("只能是 exact 或 reference"))).toBe(true);
  expect(result.some((message) => message.includes("缺少非空 Answer"))).toBe(true);
});

test("answer placeholders emit modes compatible with the current contract", () => {
  const simple = insertAnswerPlaceholders(`# 测试卷

## 解答题
type: essay

### Q1
说明理由。
`);
  expect(simple).toContain("#### Answer\nanswer_mode: reference");
  expect(simple).not.toContain("见详细解答");

  const compound = insertAnswerPlaceholders(`# 测试卷

## 解答题
type: essay

### Q1
回答问题。

##### (1)
kind: question
证明结论。
`);
  expect(compound).toContain("##### (1)\nkind: question\nanswer_mode: reference");
  expect(compound).toContain("Answer:\n<!-- TODO: 完整、可独立展示的参考答案 -->");
});
