/* eslint-env jest */
const {fetchNotionPage, notionPageId} = require("./notionApi");
const originalFetch = global.fetch;
const originalAbortController = global.AbortController;
const ID = "123456781234123412341234567890ab";

beforeEach(() => {
  global.fetch = jest.fn();
  global.AbortController = class {
    constructor() {
      this.signal = {aborted: false};
    }
    abort() {
      this.signal.aborted = true;
    }
  };
});
afterEach(() => {
  global.fetch = originalFetch;
  global.AbortController = originalAbortController;
});

test("accepts Notion page links and rejects lookalike domains, credentials and invalid IDs", () => {
  expect(notionPageId("https://app.notion.com/p/" + ID + "?source=copy_link")).toBe(ID);
  expect(notionPageId("https://www.notion.so/title-12345678-1234-1234-1234-1234567890ab")).toBe(ID);
  for (const url of [
    "http://notion.so/" + ID,
    "https://notion.so.evil.example/" + ID,
    "https://evil.example/" + ID,
    "https://notion.so/not-a-page",
    "https://user:password@notion.so/" + ID,
  ]) {
    expect(() => notionPageId(url)).toThrow();
  }
});

test("reads content and title directly from official API with no cookies or token in the URL", async () => {
  global.fetch.mockImplementation((url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("/markdown")
          ? {markdown: "正文", truncated: false, unknown_block_ids: []}
          : {properties: {Name: {type: "title", title: [{plain_text: "页面"}, {text: {content: "标题"}}]}}},
    }),
  );
  const result = await fetchNotionPage("https://notion.so/" + ID, " test-token ");
  expect(result.title).toBe("页面标题");
  expect(result.markdown).toBe("正文");
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch.mock.calls[0][0]).toBe("https://api.notion.com/v1/pages/" + ID + "/markdown?markdown_version=v1");
  for (const [url, options] of global.fetch.mock.calls) {
    expect(new URL(url).origin).toBe("https://api.notion.com");
    expect(url).not.toContain("test-token");
    expect(options).toMatchObject({
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {Authorization: "Bearer test-token", "Notion-Version": "2026-03-11"},
    });
  }
});

test("requires a token without probing a local service", async () => {
  await expect(fetchNotionPage("https://notion.so/" + ID, "")).rejects.toThrow("请填写 Notion 连接密钥");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("reports auth, permission, rate and network errors without exposing tokens", async () => {
  for (const [status, message] of [
    [401, "密钥无效"],
    [403, "授权"],
    [404, "授权"],
    [429, "过于频繁"],
    [500, "读取失败"],
  ]) {
    global.fetch.mockResolvedValue({ok: false, status});
    await expect(fetchNotionPage("https://notion.so/" + ID, "never-log-me")).rejects.toThrow(message);
  }
  global.fetch.mockRejectedValue(new TypeError("private upstream details never-log-me"));
  await expect(fetchNotionPage("https://notion.so/" + ID, "never-log-me")).rejects.toThrow("浏览器无法连接 Notion");
});
