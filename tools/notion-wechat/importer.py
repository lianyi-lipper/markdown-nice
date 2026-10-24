"""Import the same Notion source into editable Markdown Nice content.

Math stays as LaTeX; the editor's existing MathJax/WeChat pipeline renders SVG.
Only rich formatting that Markdown cannot express is retained as inline HTML.
"""
import base64
import html
import io
import ipaddress
import re
import socket
from urllib.parse import urlparse, urljoin
from uuid import uuid4

from bs4 import BeautifulSoup, NavigableString
from PIL import Image
import requests

from render import Renderer, STYLES, safe_url, source_content

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_MARKDOWN_CHARS = 100000


def public_image_url(url):
    parsed = urlparse(safe_url(url, image=True))
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('图片地址必须使用普通 HTTPS 链接。')
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('图片地址不能指向本机或内网。')
    return url


def image_data_url(src):
    safe_url(src, image=True)
    if src.startswith('data:'):
        try:
            raw = base64.b64decode(src.split(',', 1)[1], validate=True)
        except ValueError as error:
            raise ValueError('图片数据无效。') from error
    else:
        # Recheck every redirect; do not forward the Notion credential to images.
        for _ in range(5):
            with requests.get(public_image_url(src), stream=True, timeout=30, allow_redirects=False) as response:
                if response.is_redirect:
                    src = urljoin(src, response.headers['Location'])
                    continue
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > MAX_IMAGE_BYTES:
                        raise ValueError('单张图片不能超过 10 MB。')
                    chunks.append(chunk)
                raw = b''.join(chunks)
                break
        else:
            raise ValueError('图片重定向次数过多。')
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError('单张图片不能超过 10 MB。')
    with Image.open(io.BytesIO(raw)) as image:
        image.load()
        output = io.BytesIO()
        image.save(output, format='PNG')
    encoded = output.getvalue()
    if len(encoded) > MAX_IMAGE_BYTES:
        raise ValueError('转换后的图片不能超过 10 MB。')
    return 'data:image/png;base64,' + base64.b64encode(encoded).decode('ascii')


def escape_text(text):
    # HTML is enabled in Markdown Nice. Source text must stay text after import.
    return re.sub(r'([\\`*_\[\]{}#!|$])', r'\\\1', html.escape(text, quote=False))


def has_parent_color(node):
    return any(re.search(r'(?:^|;)\s*color:', parent.get('style', '')) for parent in node.parents)


class MarkdownExport:
    def __init__(self, renderer):
        self.renderer = renderer
        self.images = []
        self.image_cache = {}

    def math(self, node, in_html=False):
        equation = self.renderer.formulas[int(node['data-index'])]
        tex = equation['tex']
        if in_html:
            tex = html.escape(tex, quote=False)
        if equation['display']:
            return '$$\n' + tex + '\n$$'
        return '$' + tex + '$'

    def image(self, node):
        src = node['src']
        if src not in self.image_cache:
            image_id = 'notion-' + uuid4().hex
            self.images.append({'id': image_id, 'dataUrl': image_data_url(src), 'filename': node.get('alt', '')})
            self.image_cache[src] = 'mdnice-local-image://' + image_id
        return self.image_cache[src]

    def inline(self, node):
        if isinstance(node, NavigableString):
            return escape_text(str(node))
        if node.name == 'math-slot':
            return self.math(node)
        if node.name == 'img':
            return '![%s](%s)' % (escape_text(node.get('alt', '')), self.image(node))
        if node.name == 'code':
            text = node.get_text()
            if has_parent_color(node):
                return '<code style="color:inherit;">' + html.escape(text) + '</code>'
            fence = '`' * (max([len(x) for x in re.findall(r'`+', text)] or [0]) + 1)
            return fence + ' ' + text + ' ' + fence
        children = ''.join(self.inline(child) for child in node.children)
        if node.name in ('strong', 'em', 's'):
            # Editor themes style these tags directly. Preserve Notion's
            # explicit ancestor color rather than letting the theme replace it.
            if has_parent_color(node):
                return '<%s style="color:inherit;">%s</%s>' % (node.name, children, node.name)
            marker = {'strong': '**', 'em': '*', 's': '~~'}[node.name]
            if children.strip() == children:
                return marker + children + marker
            return '<%s>%s</%s>' % (node.name, children, node.name)
        if node.name == 'span':
            return '<span style="%s">%s</span>' % (html.escape(node.get('style', ''), quote=True), children)
        if node.name == 'a':
            url = node['href'].replace('(', '%28').replace(')', '%29')
            if has_parent_color(node):
                return '<a href="%s" style="color:inherit;">%s</a>' % (html.escape(url, quote=True), children)
            return '[%s](%s)' % (children, url)
        if node.name == 'br':
            return '<br>'
        return children

    def styled_inline(self, node):
        text = ''.join(self.inline(child) for child in node.children)
        style = node.get('style', '')
        if style:
            text = '<span style="%s">%s</span>' % (html.escape(style, quote=True), text)
        return text

    def table(self, node):
        # Table cells are HTML blocks; MathJax still reads their text nodes.
        for slot in list(node.select('math-slot')):
            slot.replace_with(NavigableString(self.math(slot)))
        for img in node.select('img'):
            img['src'] = self.image(img)
        for element in node.select('strong,em,s,code,a'):
            if has_parent_color(element):
                element['style'] = element.get('style', '') + 'color:inherit;'
        return str(node)

    def blocks(self, parent):
        output = []
        for node in parent.children:
            if isinstance(node, NavigableString):
                if node.strip():
                    output.append(escape_text(str(node)))
                continue
            if re.fullmatch(r'h[1-4]', node.name):
                output.append('#' * int(node.name[1]) + ' ' + self.styled_inline(node))
            elif node.name == 'p':
                text = self.styled_inline(node)
                if 'note-title' in node.get('class', []):
                    text = '**' + text + '**'
                output.append(text)
            elif node.name in ('ul', 'ol'):
                items = []
                for index, child in enumerate(node.find_all('li', recursive=False), 1):
                    marker = '- ' if node.name == 'ul' else '%d. ' % index
                    items.append(marker + self.styled_inline(child))
                output.append('\n'.join(items))
            elif node.name == 'section':
                if 'equation' in node.get('class', []):
                    output.append(self.math(node.find('math-slot')))
                else:
                    style = STYLES['.note'] + node.get('style', '')
                    output.append('<section style="%s">\n\n%s\n\n</section>' % (
                        html.escape(style, quote=True), self.blocks(node)))
            elif node.name == 'blockquote':
                output.append('> ' + self.styled_inline(node).replace('\n', '\n> '))
            elif node.name == 'pre':
                text = node.get_text()
                fence = '`' * max(3, max([len(x) for x in re.findall(r'`+', text)] or [0]) + 1)
                output.append(fence + '\n' + text + '\n' + fence)
            elif node.name == 'table':
                output.append(self.table(node))
            elif node.name == 'hr':
                output.append('---')
            else:
                raise ValueError('暂不支持导入此内容：' + node.name)
        return '\n\n'.join(output)


def import_page(data):
    title, source = source_content(data)
    renderer = Renderer()
    body = renderer.blocks(source)
    soup = BeautifulSoup(body, 'html.parser')
    exporter = MarkdownExport(renderer)
    markdown = exporter.blocks(soup)
    if not markdown.startswith('# ' + escape_text(title) + '\n'):
        markdown = '# ' + escape_text(title) + '\n\n' + markdown
    if len(markdown) > MAX_MARKDOWN_CHARS:
        raise ValueError('内容超过编辑器的 100000 字符上限，请拆分页面后导入。')
    renderer.stats['images'] = len(exporter.images)
    return {'title': title, 'markdown': markdown, 'images': exporter.images,
            'stats': renderer.stats, 'warnings': data.get('warnings', [])}
