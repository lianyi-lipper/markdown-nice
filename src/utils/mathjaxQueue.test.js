/* eslint-env jest */
const fs = require("fs");
const path = require("path");

function loadQueue() {
  const source = fs
    .readFileSync(path.join(__dirname, "mathjaxQueue.js"), "utf8")
    .replace("export default withMathjax;", "return withMathjax;");
  return Function(source)();
}

afterEach(() => {
  delete window.MathJax;
});

test("article typesetting and cover conversions wait for startup and never overlap", async () => {
  let start;
  window.MathJax = {
    startup: {
      promise: new Promise((resolve) => {
        start = resolve;
      }),
    },
  };
  const withMathjax = loadQueue();
  const events = [];
  let finishFirst;
  const first = withMathjax(async () => {
    events.push("article started");
    await new Promise((resolve) => {
      finishFirst = resolve;
    });
    events.push("article finished");
  });
  const second = withMathjax(() => events.push("cover started"));
  await Promise.resolve();
  expect(events).toEqual([]);
  start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events).toEqual(["article started"]);
  finishFirst();
  await Promise.all([first, second]);
  expect(events).toEqual(["article started", "article finished", "cover started"]);
});

test("a failed conversion does not prevent later corrected content from rendering", async () => {
  window.MathJax = {startup: {promise: Promise.resolve()}};
  const withMathjax = loadQueue();
  const failure = withMathjax(() => {
    throw new Error("bad TeX");
  });
  const success = withMathjax(() => "corrected preview");
  await expect(failure).rejects.toThrow("bad TeX");
  await expect(success).resolves.toBe("corrected preview");
});
