"""Serve the local Markdown Nice build and its Notion import API on loopback."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlparse

import requests

from importer import import_page

ROOT = Path(__file__).resolve().parents[2]
MAX_REQUEST_BYTES = 16 * 1024 * 1024


def notion_page_id(url):
    parsed = urlparse(url)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or not any(
            host == domain or host.endswith('.' + domain)
            for domain in ('notion.so', 'notion.site', 'notion.com')):
        raise ValueError('请填写完整的 Notion 页面 HTTPS 链接。')
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Notion 页面链接无效。')
    match = re.search(r'([a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})/?$', parsed.path)
    if not match:
        raise ValueError('链接中没有找到页面 ID，请在 Notion 中重新复制页面链接。')
    return match[1].replace('-', '')


def fetch_notion(url, token):
    page_id = notion_page_id(url)
    if not token:
        raise ValueError('请填写 Notion 连接密钥，并将该页面授权给这个连接。也可以先导入已读取的 JSON 文件。')
    headers = {'Authorization': 'Bearer ' + token, 'Notion-Version': '2026-03-11'}

    def get(suffix):
        response = requests.get('https://api.notion.com/v1/pages/' + page_id + suffix,
                                headers=headers, timeout=45)
        if response.status_code == 401:
            raise ValueError('Notion 连接密钥无效或已失效。')
        if response.status_code in (403, 404):
            raise ValueError('无法读取此页面，请确认链接正确，并在 Notion 中将页面授权给这个连接。')
        if response.status_code == 429:
            raise ValueError('Notion 请求过于频繁，请稍后重试。')
        response.raise_for_status()
        return response.json()

    source = get('/markdown')
    page = get('')
    titles = [prop.get('title', []) for prop in page.get('properties', {}).values() if prop.get('type') == 'title']
    source['title'] = ''.join(part.get('plain_text', part.get('text', {}).get('content', ''))
                             for title in titles for part in title) or 'Notion 文章'
    return source


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self):
        port = self.server.server_port
        hosts = {'127.0.0.1:%d' % port, 'localhost:%d' % port}
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        return host in hosts and (not origin or origin == 'http://' + host)

    def do_GET(self):
        if not self.same_origin():
            return self.send_json(403, {'error': '本地服务只接受本机页面的请求。'})
        if self.path == '/api/notion/status':
            return self.send_json(200, {'available': True, 'tokenConfigured': bool(os.environ.get('NOTION_TOKEN'))})
        if self.path.startswith('/api/'):
            return self.send_json(404, {'error': '接口不存在。'})
        return super().do_GET()

    def do_POST(self):
        if not self.same_origin():
            return self.send_json(403, {'error': '本地服务只接受本机页面的请求。'})
        if self.path != '/api/notion/import':
            return self.send_json(404, {'error': '接口不存在。'})
        if self.headers.get_content_type() != 'application/json':
            return self.send_json(415, {'error': '请以 JSON 格式提交导入请求。'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > MAX_REQUEST_BYTES:
                return self.send_json(413, {'error': '导入文件为空或超过 16 MB。'})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('导入请求格式不正确。')
            if 'source' in data:
                source = data['source']
            else:
                url, token = data.get('url', ''), data.get('token', '')
                if not isinstance(url, str) or not isinstance(token, str):
                    raise ValueError('链接和密钥必须为文本。')
                source = fetch_notion(url.strip(), token.strip() or os.environ.get('NOTION_TOKEN', ''))
            result = import_page(source)
            self.send_json(200, result)
        except (ValueError, KeyError, TypeError) as error:
            self.send_json(400, {'error': str(error)})
        except requests.RequestException:
            self.send_json(502, {'error': '读取 Notion 或图片失败，请检查网络后重试。'})
        except OSError:
            self.send_json(400, {'error': '图片无法读取或格式不受支持。'})


def build_frontend():
    if (ROOT / 'build').resolve().parent != ROOT:
        raise SystemExit('build 目录必须位于当前项目内，不能指向外部目录。')
    node = os.environ.get('MARKDOWN_NICE_NODE')
    bundled = Path('C:/work/tools/node-v16.20.2-win-x64/node.exe')
    node = node or (str(bundled) if bundled.exists() else shutil.which('node'))
    if not node:
        raise SystemExit('需要 Node.js 16 才能构建这个版本的 Markdown Nice。')
    env = os.environ.copy()
    env['NODE_OPTIONS'] = env.get('NODE_OPTIONS', '').replace('--openssl-legacy-provider', '').strip()
    subprocess.run([node, '--max_old_space_size=4096', str(ROOT / 'scripts/build.js')],
                   cwd=ROOT, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18797)
    parser.add_argument('--build', action='store_true', help='Build the editor before serving it')
    args = parser.parse_args()
    if args.build:
        build_frontend()
    directory = ROOT / 'build'
    if not (directory / 'index.html').is_file():
        raise SystemExit('请先使用 --build 构建 Markdown Nice。')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(directory)))
    print('Markdown Nice + Notion: http://127.0.0.1:%d' % args.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
