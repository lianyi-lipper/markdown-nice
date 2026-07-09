from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser
import tempfile
import os

PORT = 8765

HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>微信公众号剪贴板图片测试</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 980px;
      margin: 32px auto;
      padding: 0 20px;
      line-height: 1.6;
    }
    button {
      margin: 6px 8px 6px 0;
      padding: 8px 12px;
      cursor: pointer;
    }
    textarea {
      width: 100%;
      height: 260px;
      margin-top: 12px;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 13px;
    }
    .box {
      border: 1px solid #ddd;
      padding: 16px;
      border-radius: 8px;
      margin: 18px 0;
    }
    img {
      max-width: 320px;
      max-height: 240px;
      display: block;
      margin-top: 12px;
      border: 1px solid #ddd;
    }
    code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .ok { color: #0a7a0a; }
    .warn { color: #b36b00; }
    .bad { color: #b00020; }
  </style>
</head>
<body>
  <h1>微信公众号剪贴板图片测试</h1>

  <div class="box">
    <p>选择一张本地图片：</p>
    <input id="fileInput" type="file" accept="image/*" />
    <div id="info"></div>
    <img id="preview" />
  </div>

  <div class="box">
    <h2>第一步：复制测试内容</h2>

    <button id="copyBase64Html">复制：纯 base64 HTML</button>
    <button id="copyImageBlob">复制：纯图片 Blob</button>
    <button id="copyBoth">复制：HTML + 图片 Blob 双格式</button>

    <p>
      然后去微信公众号编辑器正文区域粘贴。
      粘贴后观察图片是否正常显示。
    </p>
  </div>

  <div class="box">
    <h2>第二步：检查微信有没有转 CDN</h2>

    <p>
      在公众号编辑器正文区域里选中刚才粘贴的内容，复制回来，然后点下面按钮读取剪贴板里的 HTML。
    </p>

    <button id="readClipboard">读取剪贴板 HTML</button>
    <div id="result"></div>
    <textarea id="output" placeholder="这里会显示剪贴板里的 text/html 或 text/plain"></textarea>
  </div>

<script>
let originalFile = null;
let originalDataUrl = "";
let pngBlob = null;
let pngDataUrl = "";

const fileInput = document.getElementById("fileInput");
const info = document.getElementById("info");
const preview = document.getElementById("preview");
const output = document.getElementById("output");
const result = document.getElementById("result");

function setResult(html) {
  const hasDataImage = html.includes("data:image/");
  const hasMmbiz = html.includes("mmbiz.qpic.cn") || html.includes("mmbiz.qlogo.cn");
  const hasWxCdn = html.includes("qpic.cn") || html.includes("qq.com");

  let msg = "";

  if (hasMmbiz) {
    msg += `<p class="ok">检测到 <code>mmbiz.qpic.cn</code>：很可能已经被微信上传/接管。</p>`;
  } else if (hasWxCdn) {
    msg += `<p class="warn">检测到疑似腾讯图片域名，但不是典型 <code>mmbiz.qpic.cn</code>，需要人工确认。</p>`;
  } else {
    msg += `<p class="bad">没有检测到微信 CDN 图片地址。</p>`;
  }

  if (hasDataImage) {
    msg += `<p class="bad">仍然检测到 <code>data:image/</code>：说明至少复制出来的 HTML 里还保留 base64。</p>`;
  } else {
    msg += `<p class="ok">没有检测到 <code>data:image/</code>。</p>`;
  }

  result.innerHTML = msg;
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function dataUrlToPngBlob(dataUrl) {
  const img = new Image();
  img.src = dataUrl;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  return await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function requireImage() {
  if (!originalFile || !originalDataUrl || !pngBlob) {
    alert("请先选择一张图片。");
    throw new Error("No image selected");
  }
}

function makeBase64Html() {
  const marker = "BASE64_HTML_TEST_" + Date.now();
  return `
    <section data-test-marker="${marker}">
      <p>下面是 base64 HTML 测试图，标记：${marker}</p>
      <img src="${originalDataUrl}" alt="base64-test-image" />
    </section>
  `;
}

function makeBothHtml() {
  const marker = "BOTH_HTML_AND_IMAGE_TEST_" + Date.now();
  return `
    <section data-test-marker="${marker}">
      <p>下面是 HTML + image/png 双格式测试图，标记：${marker}</p>
      <img src="${originalDataUrl}" alt="both-test-image" />
    </section>
  `;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  originalFile = file;
  originalDataUrl = await fileToDataUrl(file);
  pngBlob = await dataUrlToPngBlob(originalDataUrl);
  pngDataUrl = await blobToDataUrl(pngBlob);

  preview.src = originalDataUrl;

  const originalSizeKB = (file.size / 1024).toFixed(1);
  const base64SizeKB = (originalDataUrl.length / 1024).toFixed(1);
  const pngSizeKB = (pngBlob.size / 1024).toFixed(1);

  info.innerHTML = `
    <p>文件名：<code>${file.name}</code></p>
    <p>原始类型：<code>${file.type || "unknown"}</code></p>
    <p>原始大小：<code>${originalSizeKB} KB</code></p>
    <p>base64 data URL 长度约：<code>${base64SizeKB} KB</code></p>
    <p>转换后的 PNG Blob 大小约：<code>${pngSizeKB} KB</code></p>
  `;
});

document.getElementById("copyBase64Html").addEventListener("click", async () => {
  requireImage();

  const html = makeBase64Html();
  const plain = "BASE64 HTML 图片测试";

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    })
  ]);

  alert("已复制：纯 base64 HTML。现在去公众号编辑器粘贴。");
});

document.getElementById("copyImageBlob").addEventListener("click", async () => {
  requireImage();

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": pngBlob,
    })
  ]);

  alert("已复制：纯图片 Blob。现在去公众号编辑器粘贴。");
});

document.getElementById("copyBoth").addEventListener("click", async () => {
  requireImage();

  const html = makeBothHtml();
  const plain = "HTML + image/png 双格式图片测试";

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
      "image/png": pngBlob,
    })
  ]);

  alert("已复制：HTML + image/png 双格式。现在去公众号编辑器粘贴。");
});

document.getElementById("readClipboard").addEventListener("click", async () => {
  output.value = "";
  result.innerHTML = "";

  try {
    const items = await navigator.clipboard.read();

    let found = false;

    for (const item of items) {
      if (item.types.includes("text/html")) {
        const blob = await item.getType("text/html");
        const html = await blob.text();
        output.value = html;
        setResult(html);
        found = true;
        break;
      }
    }

    if (!found) {
      const text = await navigator.clipboard.readText();
      output.value = text || "[剪贴板里没有 text/html，也没有 text/plain]";
      setResult(output.value);
    }
  } catch (err) {
    output.value = String(err);
    result.innerHTML = `<p class="bad">读取剪贴板失败。浏览器可能没有授权，或者当前页面不是 localhost。</p>`;
  }
});
</script>
</body>
</html>
"""

def main():
    tmpdir = Path(tempfile.mkdtemp(prefix="wechat_clipboard_test_"))
    html_path = tmpdir / "index.html"
    html_path.write_text(HTML, encoding="utf-8")

    os.chdir(tmpdir)

    url = f"http://localhost:{PORT}/index.html"
    print(f"测试页已启动：{url}")
    print("请用 Chrome / Edge 打开。如果没有自动打开，请手动复制上面的地址。")
    print("按 Ctrl+C 结束。")

    webbrowser.open(url)

    server = ThreadingHTTPServer(("localhost", PORT), SimpleHTTPRequestHandler)
    server.serve_forever()

if __name__ == "__main__":
    main()