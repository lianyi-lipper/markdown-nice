/* Browser-only Notion API access. Tokens are sent only to api.notion.com. */
const NOTION_API = "https://api.notion.com/v1/pages/";
const NOTION_VERSION = "2026-03-11";

function notionPageId(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("请填写完整的 Notion 页面 HTTPS 链接。");
  }
  const allowedHost = ["notion.so", "notion.site", "notion.com"].some(
    (host) => url.hostname === host || url.hostname.endsWith("." + host),
  );
  if (url.protocol !== "https:" || !allowedHost || url.username || url.password || url.port) {
    throw new Error("请填写完整的 Notion 页面 HTTPS 链接。");
  }
  const match = url.pathname.match(/([a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/?$/i);
  if (!match) throw new Error("链接中没有找到页面 ID，请在 Notion 中重新复制页面链接。");
  return match[1].replace(/-/g, "");
}

async function readNotionJson(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: controller.signal,
        headers: {Authorization: "Bearer " + token, "Notion-Version": NOTION_VERSION},
      });
    } catch (error) {
      throw new Error(
        controller.signal.aborted
          ? "读取 Notion 超时，请稍后重试。"
          : "浏览器无法连接 Notion，可能是网络或跨域限制；可改用“已读取文件”导入。",
      );
    }
    if (response.status === 401) throw new Error("Notion 连接密钥无效或已失效。");
    if (response.status === 403 || response.status === 404) {
      throw new Error("无法读取此页面，请确认链接正确，并在 Notion 中将页面授权给这个连接。");
    }
    if (response.status === 429) throw new Error("Notion 请求过于频繁，请稍后重试。");
    if (!response.ok) throw new Error("Notion 读取失败，请稍后重试（" + response.status + "）。");
    try {
      return await response.json();
    } catch (error) {
      throw new Error("Notion 返回的内容格式不正确，请重新读取。");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNotionPage(url, token) {
  const id = notionPageId(url);
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("请填写 Notion 连接密钥，并将该页面授权给这个连接。");
  }
  // These two independent reads keep their credentials out of URLs and images.
  const [content, page] = await Promise.all([
    readNotionJson(NOTION_API + id + "/markdown?markdown_version=v1", token.trim()),
    readNotionJson(NOTION_API + id, token.trim()),
  ]);
  const title =
    Object.values(page.properties || {})
      .filter((property) => property && property.type === "title")
      .reduce((items, property) => items.concat(property.title || []), [])
      .map((part) => part.plain_text || (part.text && part.text.content) || "")
      .join("") || "Notion 文章";
  return {...content, title};
}

module.exports = {fetchNotionPage, notionPageId};
