# Notion 链接 → Markdown Nice → 公众号富文本

编辑器直接在浏览器中读取 Notion 的增强 Markdown，转换为可编辑正文，保留颜色、高亮和 LaTeX，并使用现有 MathJax 渲染 SVG 公式。普通图片沿用本地图片存储，不上传第三方图床。本目录还保留可生成自包含 HTML 的独立 Python 原型，供对照使用；编辑器不依赖它。

## 本次采用的路径

用户给页面链接 → 已连接的 Notion 读取页面 → 保存完整 fetch 结果 JSON → `render.py` → 浏览器打开 HTML → “复制到公众号”。

2026-10-15 使用《集合第一课｜课堂讲稿》实测：267 处行内公式、48 处独立公式、13 个折叠备注。原页返回内容没有颜色和图片，另用独立样例验证颜色、背景高亮、表格、彩色公式及一张图片。不能把独立样例当作原页的颜色保真证据。

这是最初原型采用的读取路径。独立网页不会自动继承聊天中的 Notion 授权。

## Markdown Nice 浏览器导入

当前编辑器的 Notion 导入全部在浏览器中执行：浏览器直接调用 Notion 官方 API，并在本地转换内容、下载可跨域读取的图片、渲染公式。应用不再请求 `/api/notion/*`，不需要启动 Python 服务，也不需要额外的云端转换接口。

正常使用项目已有的 `npm start` 开发入口，或构建后将 `build/` 作为静态网页部署，即可选择 **文件 → 从 Notion 导入**。此旧版项目构建使用 Node.js 16；本机已安装在 `C:/work/tools/node-v16.20.2-win-x64`。

- **页面链接**：填写页面链接和密钥，页面须授权给该 Notion 连接。浏览器仅向 `api.notion.com` 发送密钥；不向图片地址发送密钥、Cookie 或来源地址。原本配置在 Python 进程里的 `NOTION_TOKEN` 不再参与网页导入。
- **记住密钥**：默认不勾选。可选“在此浏览器记住密钥”，沿用原有存储记录；勾选后刷新、关闭重开会自动填入，取消勾选立即删除保存记录。此选项只作用于当前浏览器及当前网站地址。
- **已读取文件**：选择带 `title` 和 `text` 或 `markdown` 的 Notion JSON 文件。文件在浏览器中解析，不上传到本站服务。
- **图片**：内嵌图片及可跨域读取的 HTTPS 图片沿用编辑器的本地图片存储。SVG 经 DOMPurify 清理脚本、事件、HTML 嵌入及动画后，仍以 `image/svg+xml` 保存，保留矢量路径、文字、样式、viewBox 及已嵌入的 PNG/JPEG 等图片，不转 PNG。SVG 中的外部图片、字体或样式引用须先内嵌，否则明确报错；普通 PNG、JPEG、GIF、WebP 沿用原来的浏览器解码转 PNG 路径。外链下载失败会保留原链接并说明已知原因。图片存储沿用编辑器既有的容量限制。
- **编辑与复制**：导入为 Markdown 和必要的内联 HTML 样式，公式保留 LaTeX；由既有 MathJax 渲染 SVG。继续使用原有主题、编辑器和公众号复制按钮。
- **恢复正文**：确认导入前保留一份正文备份，可在弹窗里“恢复导入前内容”。读取、转换失败不会替换正文；不完整响应或尚未支持的块会明确报错。

实现入口为 `src/utils/notionApi.js`、`notionImport.js`、`notionImages.js`、`notionSvg.js` 和 `src/component/Dialog/NotionDialog.js`。本目录的 Python 脚本保留为独立原型及对照资料，不是编辑器的运行依赖。

相关检查（使用 Node.js 16）：

```text
node scripts/test.js --no-watch --runInBand --runTestsByPath src/utils/notionImport.test.js src/utils/notionApi.test.js src/utils/notionImages.test.js src/utils/notionSvg.test.js src/utils/markdown-it-math.test.js
node --max_old_space_size=4096 scripts/build.js
```

此项目有离线缓存。重新构建后若仍显示旧版本，请关闭该地址的所有标签，再重新打开。

## 独立 Python 原型的运行方式

Python 3.10+，依赖 `requests`、`markdown-it-py`、`beautifulsoup4`、`lxml`、`Pillow`、`fonttools`。公式使用仓库现有 `node_modules/mathjax`，需要 Node.js。Windows 中文公式默认读取 `C:/Windows/Fonts/msyh.ttc`；其他环境可用 `NOTION_CJK_FONT` 指定有中文字形的字体。

```text
python tools/notion-wechat/render.py --input /absolute/path/source.json --output /absolute/path/lesson.html
python tools/notion-wechat/verify.py --directory /absolute/path/output-directory
```

输入 JSON 可以是 Notion fetch 返回的对象（`title`、`text`），也可以包含 `title` 和 `markdown` 字段。输出包括：

- `.html`：带预览、复制按钮及下载按钮的单文件页面。
- `.fragment.html`：只有内联样式的正文，所有图片已嵌入。
- `.report.json`：公式、颜色、图片、折叠块等数量。

原文和输出应放在仓库外；不要提交用户笔记。

独立预览脚本也支持官方 API 读取：在进程环境中配置 `NOTION_TOKEN` 后使用 `--url`、`--title`。连接必须有页面读取权限。真实密钥读取尚未联调；当前本地集成使用已读取的 JSON 验证，官方 API 请求与错误处理使用模拟响应测试。

## 格式范围

已支持本篇使用的标题、段落、简单列表、加粗、链接、引用、折叠备注、行内和块级数学公式。颜色与背景高亮映射为内联 CSS，公式继承所在文字颜色。折叠块展开为备注框；分栏转为阅读顺序的单栏。远程普通图片转为 PNG，动态远程图片会变成静态首帧；已有图片 data URL 保留。

2026-10-23 起，公式沿用 Markdown Nice 的 SVG 导出方式：MathJax 使用 `fontCache: none` 输出自包含轮廓，将 SVG 尺寸移到内联样式，保留 `viewBox` 和基线；不再转成 PNG。中文也转成矢量轮廓，以免粘贴后依赖外部字体。在 `aria-label` 与 `data-formula` 中保留 LaTeX。复制优先采用 Markdown Nice 的 `copy` 事件 / `text/html` 方式，不支持时再尝试 Clipboard API。

基础表格和代码块有适配。嵌套列表、复杂表格列样式、合并单元格、交互组件、嵌入媒体等尚不属于完整保真范围。未知/不完整块会尽量中止并报告，新增页面仍需对照源页检查。

## 验证边界

2026-10-24 增加 SVG 直接导入：本地生产构建和 38 项相关自动化测试通过。使用《用量角器做出一道三角函数选择题》的两张真实 Notion SVG 外链，在浏览器下载、导入并刷新验证，均保持 `image/svg+xml`，显示尺寸分别为 1000×583、1100×760。第一张原本封装的 PNG 数据校验一致；第二张保留 3 条 path、19 个文字节点及原 viewBox。该文 68 处公式无渲染错误。复制事件输出的 HTML 含 2 张内嵌 SVG、0 张外链图片及 68 处公式；尚未验证公众号粘贴、保存草稿、重新打开。另以浏览器样例确认脚本、事件处理器与 foreignObject 被清理，中文文字保留。测试正文来自连接器快照，图片/加粗/斜体的封装标记转为官网 REST 接口的 Markdown 写法；未把这一测试计为有效密钥的页面读取验证。

2026-10-23 浏览器本地转换版已在仅提供静态文件的 Node 预览服务器验证：重新导入完整讲义，315 处公式的 LaTeX 多重集合与原始快照一致，315 个公式 SVG 均有布局尺寸，13 个折叠备注展开；独立样例的 4 处公式、文字颜色、高亮及 600×250 内嵌图片正常。勾选记住密钥后刷新可恢复，取消勾选再刷新为空；测试密钥已清除。浏览器直连 Notion 返回可识别的 401 密钥错误，验证了当前环境的跨域请求与错误处理，但尚未用有效密钥完成真实页面读取。转换、API 和图片处理的自动化测试使用模拟网络响应，不将其计作真实授权读取成功。

`verify.py` 检查：源公式与输出 SVG 的 LaTeX 多重集合一致、矢量轮廓与 `viewBox` 保留、公式不依赖外部图片或字体、无未替换占位符、文字颜色与高亮保留；普通图片仍检查像素非空。

浏览器验证：SVG 版讲稿包含 315 处矢量公式，无公式 PNG；浏览器中各公式的布局尺寸均非零。独立小样含 4 处 SVG 公式及 1 张普通图片，已检查中文、红色公式、分数及正文基线。自动化工具的虚拟剪贴板与浏览器实际复制不是同一路径，不能将其空剪贴板或传输限制视为实际复制失败，也不能用它确认公众号兼容性。

公众号兼容性必须以实际粘贴 → 保存草稿 → 重新打开为准。本地显示正常、剪贴板包含图片，不等同于公众号已永久保存图片。浏览器工具的站点安全策略禁止代理操作公众号后台；用户也报告开启代理时公众号卡在加载，因此此项仍待用户关闭代理后验证。

## 参考

- [Notion2WeChat](https://github.com/nmvr2600/notion2wechat)：参考其 CSS 内联、富文本剪贴板和图片 Base64 的思路；其主体经普通 Markdown 转换，不能直接据此保证 Notion 颜色保留。未复制其源代码。
- [react-notion-x](https://github.com/NotionX/react-notion-x)：公开页面获取与渲染参考；本次私有页面读取采用已授权的官方连接，没有引入其非官方接口。
- [Notion Markdown API](https://developers.notion.com/reference/retrieve-page-markdown)：官方接口支持读取页面的增强 Markdown。
