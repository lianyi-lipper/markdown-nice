/* eslint-disable no-underscore-dangle */

const VALID_TYPES = ["choice", "multiple_choice", "indefinite_choice", "fill", "true_false", "essay"];
const METADATA_KEYS = [
  "title",
  "year",
  "semester",
  "region",
  "exam_type",
  "school_or_organization",
  "grade",
  "subject",
  "variant_labels",
];

const buildLineStarts = (text) => {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
};

const positionOf = (lineStarts, index) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const line = Math.max(0, high);
  return {line: line + 1, column: index - lineStarts[line] + 1};
};

const addIssue = (issues, lineStarts, index, severity, message) => {
  issues.push({
    ...positionOf(lineStarts, Math.max(0, index)),
    severity,
    message,
  });
};

const parseField = (line) => {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
  return match ? {key: match[1], value: match[2]} : null;
};

const parseQuestionPointsField = (line) => {
  const match = line.match(/^\s*(\d+)\s*:\s*(.*?)\s*$/);
  return match ? {key: match[1], value: match[2]} : null;
};

const normalizeBlock = (lines) => {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].text.trim()) start++;
  while (end > start && !lines[end - 1].text.trim()) end--;
  return lines
    .slice(start, end)
    .map((line) => line.text)
    .join("\n")
    .trim();
};

const parseExamMarkdown = (text = "") => {
  const lineStarts = buildLineStarts(text);
  const lines = text.split("\n");
  const sections = [];
  const questions = [];
  const issues = [];
  let title = "";
  const metadataFields = {};
  let currentSection = null;
  let currentQuestion = null;
  let currentBlock = "metadata_fields";

  lines.forEach((raw, zeroIndex) => {
    const lineNo = zeroIndex + 1;
    const offset = lineStarts[zeroIndex] || 0;
    const textLine = raw.replace(/\r$/, "");
    const trimmed = textLine.trim();

    if (trimmed.indexOf(":::") === 0) {
      addIssue(issues, lineStarts, offset, "error", "元数据直接写在一级标题下方，不要使用 :::metadata 或 ::: 包裹。");
      return;
    }

    const heading = textLine.match(/^(#{1,5})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const headingText = heading[2].trim();
      if (level === 1) {
        title = headingText;
        currentBlock = "metadata_fields";
        return;
      }
      if (level === 2) {
        if (headingText.toLowerCase() === "notes") {
          currentSection = null;
          currentQuestion = null;
          currentBlock = "global_notes";
          return;
        }
        currentSection = {
          title: headingText,
          line: lineNo,
          offset,
          fields: {},
          questions: [],
        };
        sections.push(currentSection);
        currentQuestion = null;
        currentBlock = "section_fields";
        return;
      }
      if (level === 3) {
        const qMatch = headingText.match(/^Q\s*(\d+)$/i);
        if (!qMatch) {
          addIssue(issues, lineStarts, offset, "error", "三级标题必须使用 ### QN。");
          return;
        }
        if (!currentSection) {
          addIssue(issues, lineStarts, offset, "error", "题目必须放在某个二级大题下面。");
        }
        currentQuestion = {
          qNum: Number(qMatch[1]),
          line: lineNo,
          offset,
          section: currentSection,
          contentLines: [],
          answers: {},
          explanations: {},
          notes: [],
          subquestions: [],
        };
        questions.push(currentQuestion);
        if (currentSection) {
          currentSection.questions.push(currentQuestion);
        }
        currentBlock = "content";
        return;
      }
      if (level === 4) {
        if (!currentQuestion) {
          addIssue(issues, lineStarts, offset, "error", "四级答案/解析标题必须放在题目内。");
          return;
        }
        const block = headingText.match(/^(Answer|Explanation|Notes)(?:\s*\(([^)]+)\))?$/i);
        if (!block) {
          addIssue(issues, lineStarts, offset, "error", "四级标题只支持 Answer、Explanation、Notes。");
          return;
        }
        const name = block[1].toLowerCase();
        const label = block[2] ? block[2].trim() : "";
        currentBlock = label ? `${name}:${label}` : name;
        if (name === "answer") currentQuestion.answers[label || "__single__"] = [];
        if (name === "explanation") currentQuestion.explanations[label || "__single__"] = [];
        return;
      }
      if (level === 5) {
        if (!currentQuestion) {
          addIssue(issues, lineStarts, offset, "error", "五级小问标题必须放在题目内。");
          return;
        }
        const sub = headingText.match(/^(?:\(([^)]+)\)|（([^）]+)）|([①②③④⑤⑥⑦⑧⑨⑩]))$/);
        if (!sub) {
          addIssue(issues, lineStarts, offset, "error", "五级标题只用于小问边界，例如 ##### (1)。");
          return;
        }
        const label = sub[1] || sub[2] || sub[3];
        currentQuestion.subquestions.push({
          label,
          line: lineNo,
          offset,
          lines: [],
          fields: {},
          answerLines: [],
          explanationLines: [],
          block: "content",
        });
        currentBlock = `subquestion:${currentQuestion.subquestions.length - 1}`;
        return;
      }
    }

    if (currentBlock === "metadata_fields") {
      const field = parseField(textLine);
      if (field) {
        if (METADATA_KEYS.includes(field.key)) {
          metadataFields[field.key] = {value: field.value, line: lineNo, offset};
          if (field.key === "variant_labels" && !field.value) currentBlock = "metadata_variant_labels";
        } else {
          addIssue(issues, lineStarts, offset, "error", `未知元数据字段：${field.key}。`);
        }
      } else if (trimmed) {
        addIssue(issues, lineStarts, offset, "error", "元数据字段必须写在第一个二级大题之前，并使用 key: value。");
      }
      return;
    }

    if (currentBlock === "metadata_variant_labels") {
      if (!trimmed) return;
      if (/^\s*-\s+.+/.test(textLine)) return;
      currentBlock = "metadata_fields";
      const field = parseField(textLine);
      if (field && METADATA_KEYS.includes(field.key)) {
        metadataFields[field.key] = {value: field.value, line: lineNo, offset};
      } else {
        addIssue(
          issues,
          lineStarts,
          offset,
          "error",
          "variant_labels 下必须使用 Markdown 列表，后续元数据仍使用 key: value。",
        );
      }
      return;
    }

    if (currentBlock === "section_fields" && currentSection) {
      const field = parseField(textLine);
      if (field) {
        currentSection.fields[field.key] = {value: field.value, line: lineNo, offset};
        if (field.key === "points_by_question") currentBlock = "points_by_question";
      } else if (trimmed) {
        addIssue(issues, lineStarts, offset, "error", "大题字段必须使用 key: value。");
      }
      return;
    }

    if (currentBlock === "points_by_question" && currentSection) {
      const sectionField = parseField(textLine);
      if (
        sectionField &&
        [
          "type",
          "question_type",
          "points_each",
          "points_per_blank",
          "points_by_question",
          "instruction",
          "id",
        ].includes(sectionField.key)
      ) {
        currentSection.fields[sectionField.key] = {value: sectionField.value, line: lineNo, offset};
        if (sectionField.key !== "points_by_question") currentBlock = "section_fields";
      } else if (trimmed) {
        const pointField = parseQuestionPointsField(textLine);
        if (pointField) {
          if (!currentSection.pointsByQuestion) currentSection.pointsByQuestion = {};
          currentSection.pointsByQuestion[pointField.key] = {value: pointField.value, line: lineNo, offset};
        } else {
          addIssue(issues, lineStarts, offset, "error", "points_by_question 下必须写成 题号: 分值。");
        }
      }
      return;
    }

    if (!currentQuestion) {
      return;
    }
    const lineRecord = {text: textLine, line: lineNo, offset};
    if (currentBlock === "content") currentQuestion.contentLines.push(lineRecord);
    else if (currentBlock === "answer") currentQuestion.answers.__single__.push(lineRecord);
    else if (currentBlock === "explanation") currentQuestion.explanations.__single__.push(lineRecord);
    else if (currentBlock === "notes") currentQuestion.notes.push(lineRecord);
    else if (currentBlock && currentBlock.indexOf("answer:") === 0) {
      const label = currentBlock.slice("answer:".length);
      currentQuestion.answers[label].push(lineRecord);
    } else if (currentBlock && currentBlock.indexOf("explanation:") === 0) {
      const label = currentBlock.slice("explanation:".length);
      currentQuestion.explanations[label].push(lineRecord);
    } else if (currentBlock && currentBlock.indexOf("subquestion:") === 0) {
      const sub = currentQuestion.subquestions[Number(currentBlock.slice("subquestion:".length))];
      const field = parseField(textLine);
      if (sub.block === "content" && field && ["kind", "points", "answer_mode"].includes(field.key)) {
        sub.fields[field.key] = {value: field.value, line: lineNo, offset};
        return;
      }
      const inlineBlock = textLine.match(/^\s*(Answer|Explanation)\s*[:：]\s*$/i);
      if (inlineBlock) {
        sub.block = inlineBlock[1].toLowerCase();
        return;
      }
      if (sub.block === "answer") sub.answerLines.push(lineRecord);
      else if (sub.block === "explanation") sub.explanationLines.push(lineRecord);
      else sub.lines.push(lineRecord);
    }
  });

  return {
    title,
    hasMetadata: Object.keys(metadataFields).length > 0,
    metadataFields,
    sections,
    questions,
    issues,
    lineStarts,
  };
};

const questionContent = (question) => {
  const parts = [normalizeBlock(question.contentLines)];
  question.subquestions.forEach((sub) => {
    parts.push(`(${sub.label}) ${normalizeBlock(sub.lines)}`.trim());
  });
  return parts.filter(Boolean).join("\n\n");
};

const countFillBlanks = (content) => (content.match(/\\rule\{2cm\}\{0\.15mm\}/g) || []).length;

const hasChoicePlaceholder = (content) => /\(\s*\$\\quad\\quad\\quad\$\s*\)/.test(content);
const hasTrueFalsePlaceholder = (content) => /\(\s*\$\\quad\$\s*\)/.test(content);

const hasOptionsABCD = (content) =>
  ["A", "B", "C", "D"].every((key) => new RegExp(`(?:^|\\n)\\s*${key}[.．、]`).test(content));

const answerLabels = (question) => Object.keys(question.answers).filter((key) => key !== "__single__");

const subquestionPath = (label) => (/^\d+(?:\.\d+)*$/.test(label) ? label.split(".") : [label]);

const subquestionTree = (question, issues, lineStarts) => {
  const byPath = {};
  const roots = [];
  question.subquestions.forEach((sub) => {
    const path = subquestionPath(sub.label);
    const key = path.join(".");
    if (byPath[key]) {
      addIssue(issues, lineStarts, sub.offset, "error", `小问 (${sub.label}) 重复。`);
      return;
    }
    const node = {...sub, path, key, children: []};
    byPath[key] = node;
    if (path.length === 1) {
      roots.push(node);
      return;
    }
    const parentKey = path.slice(0, -1).join(".");
    const parent = byPath[parentKey];
    if (!parent) {
      addIssue(
        issues,
        lineStarts,
        sub.offset,
        "error",
        `小问 (${sub.label}) 缺少父节点 (${parentKey})，或父节点写在它后面。`,
      );
      roots.push(node);
      return;
    }
    parent.children.push(node);
  });
  return {roots, nodes: Object.values(byPath)};
};

const leafSubquestions = (nodes) => {
  const leaves = [];
  const visit = (node) => {
    if (node.children && node.children.length) {
      node.children.forEach(visit);
    } else {
      leaves.push(node);
    }
  };
  nodes.forEach(visit);
  return leaves;
};

const hasInlineAnswer = (sub) => normalizeBlock(sub.answerLines).length > 0;
const hasInlineExplanation = (sub) => normalizeBlock(sub.explanationLines).length > 0;

const validateAnswerBlock = (lines, label, issues, lineStarts) => {
  const nonempty = lines.filter((line) => line.text.trim());
  if (!nonempty.length) {
    addIssue(issues, lineStarts, lines[0] ? lines[0].offset : 0, "error", `${label} 不能为空。`);
    return;
  }
  const firstField = parseField(nonempty[0].text);
  const modeLine = firstField && firstField.key === "answer_mode" ? nonempty[0] : null;
  const misplacedMode = nonempty.find((line, index) => {
    const field = parseField(line.text);
    return field && field.key === "answer_mode" && index !== 0;
  });
  if (misplacedMode) {
    addIssue(issues, lineStarts, misplacedMode.offset, "error", `${label} 的 answer_mode 必须是第一条非空行。`);
  }
  if (!modeLine) return;
  const mode = parseField(modeLine.text)
    .value.trim()
    .toLowerCase();
  if (!["exact", "reference"].includes(mode)) {
    addIssue(issues, lineStarts, modeLine.offset, "error", `${label} 的 answer_mode 只能是 exact 或 reference。`);
  }
  if (nonempty.length === 1) {
    addIssue(issues, lineStarts, modeLine.offset, "error", `${label} 写了 answer_mode，但缺少非空答案。`);
  }
};

const diagnoseExamMarkdown = (text = "") => {
  const parsed = parseExamMarkdown(text);
  const {issues, lineStarts, sections, questions} = parsed;

  if (!parsed.title) addIssue(issues, lineStarts, 0, "warning", "建议使用一级标题作为试卷标题。");
  if (!parsed.hasMetadata) addIssue(issues, lineStarts, 0, "warning", "建议在一级标题下方补充元数据字段。");
  if (!sections.length) addIssue(issues, lineStarts, 0, "error", "缺少二级大题标题。");
  if (!questions.length) addIssue(issues, lineStarts, 0, "error", "缺少 ### QN 题目。");

  const seen = {};
  questions.forEach((question) => {
    if (seen[question.qNum]) {
      addIssue(issues, lineStarts, question.offset, "error", `题号 Q${question.qNum} 重复。`);
    }
    seen[question.qNum] = true;
  });

  sections.forEach((section) => {
    const typeField = section.fields.type || section.fields.question_type;
    const qType = typeField && typeField.value;
    if (!qType) {
      addIssue(issues, lineStarts, section.offset, "error", `大题「${section.title}」缺少 type 字段。`);
      return;
    }
    if (!VALID_TYPES.includes(qType)) {
      addIssue(issues, lineStarts, typeField.offset, "error", `题型 ${qType} 不在白名单中。`);
    }

    section.questions.forEach((question) => {
      const content = questionContent(question);
      if (!content) {
        addIssue(issues, lineStarts, question.offset, "error", `Q${question.qNum} 题干为空。`);
        return;
      }
      if (qType === "fill" && countFillBlanks(content) === 0) {
        addIssue(
          issues,
          lineStarts,
          question.offset,
          "error",
          `Q${question.qNum} 是填空题，但题干缺少 $\\rule{2cm}{0.15mm}$。`,
        );
      }
      if (qType === "true_false" && !hasTrueFalsePlaceholder(content)) {
        addIssue(issues, lineStarts, question.offset, "error", `Q${question.qNum} 是判断题，但题干缺少 ($\\quad$)。`);
      }
      if (["choice", "multiple_choice", "indefinite_choice"].includes(qType)) {
        if (!hasChoicePlaceholder(content)) {
          addIssue(
            issues,
            lineStarts,
            question.offset,
            "error",
            `Q${question.qNum} 是选择题，但题干缺少 ($\\quad\\quad\\quad$)。`,
          );
        }
        if (!hasOptionsABCD(content)) {
          addIssue(
            issues,
            lineStarts,
            question.offset,
            "error",
            `Q${question.qNum} 是选择题，但未检测到完整 A-D 选项。`,
          );
        }
      }

      const labels = answerLabels(question);
      const tree = subquestionTree(question, issues, lineStarts);
      const leaves = leafSubquestions(tree.roots);
      const inlineAnswerCount = leaves.filter(hasInlineAnswer).length;
      const inlineExplanationCount = leaves.filter(hasInlineExplanation).length;
      Object.keys(question.answers).forEach((label) => {
        validateAnswerBlock(
          question.answers[label],
          label === "__single__" ? `Q${question.qNum} 的 Answer` : `Q${question.qNum} 的 Answer (${label})`,
          issues,
          lineStarts,
        );
      });
      if (question.answers.__single__ && labels.length) {
        addIssue(issues, lineStarts, question.offset, "error", `Q${question.qNum} 不要混用 Answer 和 Answer (n)。`);
      }
      if ((question.answers.__single__ || labels.length) && inlineAnswerCount) {
        addIssue(
          issues,
          lineStarts,
          question.offset,
          "error",
          `Q${question.qNum} 不要混用块内 Answer: 和 #### Answer。`,
        );
      }
      labels.forEach((label) => {
        if (question.subquestions.length && !question.subquestions.some((sub) => sub.label === label)) {
          addIssue(
            issues,
            lineStarts,
            question.offset,
            "warning",
            `Q${question.qNum} 的 Answer (${label}) 没有对应的 ##### (${label})。`,
          );
        }
      });
      Object.keys(question.explanations)
        .filter((key) => key !== "__single__")
        .forEach((label) => {
          if (!question.answers[label]) {
            addIssue(
              issues,
              lineStarts,
              question.offset,
              "error",
              `Q${question.qNum} 的 Explanation (${label}) 没有对应 Answer (${label})。`,
            );
          }
        });

      tree.nodes.forEach((sub) => {
        const explicitKind = sub.fields.kind && sub.fields.kind.value;
        const hasChildren = sub.children.length > 0;
        const kind = explicitKind || (hasChildren ? "context" : "question");
        const hasPoints = Boolean(sub.fields.points && sub.fields.points.value);
        const answerModeField = sub.fields.answer_mode;
        const answerMode = answerModeField && answerModeField.value.trim().toLowerCase();
        if (explicitKind && !["context", "question"].includes(explicitKind)) {
          addIssue(
            issues,
            lineStarts,
            sub.fields.kind.offset,
            "error",
            `小问 (${sub.label}) 的 kind 只能是 context 或 question。`,
          );
        }
        if (hasChildren && !explicitKind) {
          addIssue(
            issues,
            lineStarts,
            sub.offset,
            "warning",
            `小问 (${sub.label}) 有子节点，建议显式写 kind: context。`,
          );
        }
        if (kind === "context") {
          if (!hasChildren) {
            addIssue(issues, lineStarts, sub.offset, "error", `kind: context 的小问 (${sub.label}) 必须有子节点。`);
          }
          if (hasPoints) {
            addIssue(
              issues,
              lineStarts,
              sub.fields.points.offset,
              "error",
              `kind: context 的小问 (${sub.label}) 不要写 points。`,
            );
          }
          if (hasInlineAnswer(sub) || hasInlineExplanation(sub)) {
            addIssue(
              issues,
              lineStarts,
              sub.offset,
              "error",
              `kind: context 的小问 (${sub.label}) 不要写 Answer: 或 Explanation:。`,
            );
          }
          if (answerModeField) {
            addIssue(
              issues,
              lineStarts,
              answerModeField.offset,
              "error",
              `kind: context 的小问 (${sub.label}) 不要写 answer_mode。`,
            );
          }
        }
        if (kind === "question" && hasChildren) {
          addIssue(issues, lineStarts, sub.offset, "error", `kind: question 的小问 (${sub.label}) 不能再有子节点。`);
        }
        if (answerModeField && !["exact", "reference"].includes(answerMode)) {
          addIssue(
            issues,
            lineStarts,
            answerModeField.offset,
            "error",
            `小问 (${sub.label}) 的 answer_mode 只能是 exact 或 reference。`,
          );
        }
        if (answerModeField && !hasInlineAnswer(sub)) {
          addIssue(
            issues,
            lineStarts,
            answerModeField.offset,
            "error",
            `小问 (${sub.label}) 写了 answer_mode，但缺少非空 Answer:。`,
          );
        }
      });

      const leafPoints = leaves.map((sub) => sub.fields.points && sub.fields.points.value).filter(Boolean);
      if (leafPoints.length > 0 && leafPoints.length !== leaves.length) {
        addIssue(
          issues,
          lineStarts,
          question.offset,
          "error",
          `Q${question.qNum} 小问分值不完整：要么所有最小可评分小问都写 points，要么都不写。`,
        );
      }
      if (inlineExplanationCount > inlineAnswerCount) {
        addIssue(
          issues,
          lineStarts,
          question.offset,
          "error",
          `Q${question.qNum} 存在 Explanation: 但缺少对应 Answer:。`,
        );
      }
    });
  });

  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
};

const answerPlaceholderFor = (qType, content, label, options = {}) => {
  const inline = Boolean(options.inline);
  const title = inline ? "Answer:" : `#### Answer${label ? ` (${label})` : ""}`;
  const explanationTitle = inline ? "Explanation:" : `#### Explanation${label ? ` (${label})` : ""}`;
  if (qType === "fill") {
    const count = Math.max(1, countFillBlanks(content));
    return [
      title,
      ...(inline ? [] : ["answer_mode: exact"]),
      ...Array.from({length: count}, (_, index) => `- <!-- TODO: 第 ${index + 1} 空 -->`),
    ].join("\n");
  }
  if (qType === "true_false") {
    return [
      title,
      ...(inline ? [] : ["answer_mode: exact"]),
      "<!-- TODO: true 或 false；如需改正说明，改成多值列表 -->",
    ].join("\n");
  }
  if (["choice", "multiple_choice", "indefinite_choice"].includes(qType)) {
    return [title, ...(inline ? [] : ["answer_mode: exact"]), "<!-- TODO: A/B/C/D -->"].join("\n");
  }
  return [
    title,
    ...(inline ? [] : ["answer_mode: reference"]),
    "<!-- TODO: 完整、可独立展示的参考答案 -->",
    "",
    explanationTitle,
    "<!-- TODO: 来源解析；没有时可省略 Explanation -->",
  ].join("\n");
};

const insertAfterLine = (text, lineNo, insertion) => {
  const lines = text.split("\n");
  lines.splice(lineNo, 0, insertion);
  return lines.join("\n");
};

const subquestionEndLine = (question, sub) => {
  const laterSubLines = question.subquestions
    .filter((candidate) => candidate.line > sub.line)
    .map((candidate) => candidate.line);
  const laterBlockLines = [
    ...Object.values(question.answers)
      .flat()
      .map((line) => line.line),
    ...Object.values(question.explanations)
      .flat()
      .map((line) => line.line),
  ].filter((line) => line > sub.line);
  const next = Math.min(...laterSubLines, ...laterBlockLines, Number.POSITIVE_INFINITY);
  if (Number.isFinite(next)) return next - 1;
  return Math.max(
    sub.line,
    ...sub.lines.map((line) => line.line),
    ...sub.answerLines.map((line) => line.line),
    ...sub.explanationLines.map((line) => line.line),
  );
};

const questionEndLine = (parsed, section, question) => {
  const laterQuestionLines = section.questions
    .filter((candidate) => candidate.line > question.line)
    .map((candidate) => candidate.line);
  const laterSectionLines = parsed.sections
    .filter((candidate) => candidate.line > question.line)
    .map((candidate) => candidate.line);
  const next = Math.min(...laterQuestionLines, ...laterSectionLines, Number.POSITIVE_INFINITY);
  if (Number.isFinite(next)) return next - 1;
  return textLineCount(parsed);
};

const textLineCount = (parsed) => parsed.lineStarts.length;

const insertAnswerPlaceholders = (text = "") => {
  const parsed = parseExamMarkdown(text);
  let output = text.replace(/\s*$/, "");

  [...parsed.sections].reverse().forEach((section) => {
    const qType = (section.fields.type || section.fields.question_type || {}).value;
    if (!VALID_TYPES.includes(qType)) return;
    [...section.questions].reverse().forEach((question) => {
      if (question.answers.__single__ || answerLabels(question).length) return;
      const content = questionContent(question);
      if (question.subquestions.length) {
        const tree = subquestionTree(question, [], parsed.lineStarts);
        const leaves = leafSubquestions(tree.roots).filter((sub) => !hasInlineAnswer(sub));
        [...leaves].reverse().forEach((sub) => {
          const insertion = answerPlaceholderFor(qType, normalizeBlock(sub.lines), sub.label, {inline: true});
          output = insertAfterLine(output, subquestionEndLine(question, sub), `\n${insertion}`);
          if (qType === "essay" && !sub.fields.answer_mode) {
            const fieldEndLine = Math.max(sub.line, ...Object.values(sub.fields).map((field) => field.line));
            output = insertAfterLine(output, fieldEndLine, "answer_mode: reference");
          }
        });
      } else {
        output = insertAfterLine(
          output,
          questionEndLine(parsed, section, question),
          `\n<!-- Q${question.qNum} answer placeholders -->\n${answerPlaceholderFor(qType, content, "")}`,
        );
      }
    });
  });
  return output + "\n";
};

export {diagnoseExamMarkdown, insertAnswerPlaceholders};
export default diagnoseExamMarkdown;
