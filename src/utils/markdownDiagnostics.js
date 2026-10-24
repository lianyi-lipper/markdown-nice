const MAX_DIAGNOSTICS = 20;

const isEscaped = (text, index) => {
  let count = 0;
  for (let pos = index - 1; pos >= 0 && text[pos] === "\\"; pos--) {
    count++;
  }
  return count % 2 === 1;
};

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
  return {
    line: line + 1,
    column: index - lineStarts[line] + 1,
  };
};

const markRange = (mask, start, end) => {
  for (let index = Math.max(0, start); index < end && index < mask.length; index++) {
    mask[index] = true;
  }
};

const buildProtectedMask = (text) => {
  const mask = new Array(text.length).fill(false);
  const lines = text.split("\n");
  let offset = 0;
  let inFence = false;
  let fenceMarker = "";

  lines.forEach((line) => {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);

    if (inFence) {
      markRange(mask, lineStart, lineEnd);
      if (fenceMatch && fenceMatch[1][0] === fenceMarker[0] && fenceMatch[1].length >= fenceMarker.length) {
        inFence = false;
        fenceMarker = "";
      }
    } else if (fenceMatch) {
      inFence = true;
      [, fenceMarker] = fenceMatch;
      markRange(mask, lineStart, lineEnd);
    } else {
      let index = 0;
      while (index < line.length) {
        if (line[index] !== "`" || isEscaped(line, index)) {
          index++;
          continue;
        }
        let tickCount = 1;
        while (line[index + tickCount] === "`") {
          tickCount++;
        }
        const ticks = "`".repeat(tickCount);
        const close = line.indexOf(ticks, index + tickCount);
        if (close === -1) {
          break;
        }
        markRange(mask, lineStart + index, lineStart + close + tickCount);
        index = close + tickCount;
      }
    }

    offset = lineEnd + 1;
  });

  return mask;
};

const addDiagnostic = (diagnostics, lineStarts, index, message, marker) => {
  if (diagnostics.length >= MAX_DIAGNOSTICS) {
    return;
  }
  diagnostics.push({
    ...positionOf(lineStarts, index),
    message,
    marker,
  });
};

const getDollarDelimiter = (text, index) => {
  if (text[index] !== "$" || isEscaped(text, index)) {
    return "";
  }
  return text[index + 1] === "$" ? "$$" : "$";
};

const diagnoseMath = (text, mask, lineStarts, diagnostics) => {
  const inlineStack = [];
  const blockStack = [];
  const ignoredInlineDelimiters = {};

  for (let index = 0; index < text.length; index++) {
    if (mask[index]) {
      continue;
    }

    const delimiter = getDollarDelimiter(text, index);
    if (!delimiter) {
      continue;
    }
    if (ignoredInlineDelimiters[index]) {
      continue;
    }

    const prev = index > 0 ? text[index - 1] : "";
    const next = text[index + delimiter.length] || "";
    const prevIsSpace = prev === " " || prev === "\t";
    const nextIsSpace = next === " " || next === "\t";

    if (delimiter === "$$") {
      if (blockStack.length) {
        blockStack.pop();
      } else {
        blockStack.push(index);
      }
      index++;
      continue;
    }

    if (!inlineStack.length) {
      if (nextIsSpace) {
        addDiagnostic(diagnostics, lineStarts, index, "行内公式的起始 $ 后面是空格，MathJax 很可能不会识别。", "$");
        const nextDelimiter = text.indexOf("$", index + 1);
        const nextLineBreak = text.indexOf("\n", index + 1);
        if (nextDelimiter !== -1 && (nextLineBreak === -1 || nextDelimiter < nextLineBreak)) {
          ignoredInlineDelimiters[nextDelimiter] = true;
        }
      } else {
        inlineStack.push(index);
      }
      continue;
    }

    if (prevIsSpace) {
      addDiagnostic(diagnostics, lineStarts, index, "行内公式的结束 $ 前面是空格，MathJax 很可能不会识别。", "$");
      inlineStack.pop();
      continue;
    }
    if (/[0-9]/.test(next)) {
      addDiagnostic(
        diagnostics,
        lineStarts,
        index,
        "行内公式的结束 $ 后面紧跟数字，当前解析规则不会把它当作结束符。",
        "$",
      );
      inlineStack.pop();
      continue;
    }
    inlineStack.pop();
  }

  inlineStack.forEach((index) => {
    addDiagnostic(diagnostics, lineStarts, index, "发现未闭合的行内公式 $。", "$");
  });
  blockStack.forEach((index) => {
    addDiagnostic(diagnostics, lineStarts, index, "发现未闭合的块级公式 $$。", "$$");
  });
};

const diagnoseEmphasis = (text, mask, lineStarts, diagnostics) => {
  const strongStack = [];
  const ignoredStrongDelimiters = {};

  for (let index = 0; index < text.length - 1; index++) {
    if (mask[index] || text.slice(index, index + 2) !== "**" || isEscaped(text, index)) {
      continue;
    }
    if (ignoredStrongDelimiters[index]) {
      index++;
      continue;
    }

    const prev = index > 0 ? text[index - 1] : "";
    const next = text[index + 2] || "";
    if (strongStack.length) {
      if (prev === " " || prev === "\t") {
        addDiagnostic(diagnostics, lineStarts, index, "加粗结束 ** 前面是空格，可能不会按预期加粗。", "**");
      }
      strongStack.pop();
    } else if (next === " " || next === "\t") {
      addDiagnostic(diagnostics, lineStarts, index, "加粗起始 ** 后面是空格，可能不会按预期加粗。", "**");
      const nextDelimiter = text.indexOf("**", index + 2);
      const nextLineBreak = text.indexOf("\n", index + 2);
      if (nextDelimiter !== -1 && (nextLineBreak === -1 || nextDelimiter < nextLineBreak)) {
        ignoredStrongDelimiters[nextDelimiter] = true;
      }
    } else {
      strongStack.push(index);
    }
    index++;
  }

  strongStack.forEach((index) => {
    addDiagnostic(diagnostics, lineStarts, index, "发现疑似未闭合的加粗标记 **。", "**");
  });
};

const diagnoseMarkdown = (text = "") => {
  if (!text) {
    return [];
  }

  const lineStarts = buildLineStarts(text);
  const mask = buildProtectedMask(text);
  const diagnostics = [];

  diagnoseMath(text, mask, lineStarts, diagnostics);
  diagnoseEmphasis(text, mask, lineStarts, diagnostics);

  return diagnostics
    .sort((left, right) => left.line - right.line || left.column - right.column)
    .slice(0, MAX_DIAGNOSTICS);
};

export default diagnoseMarkdown;
