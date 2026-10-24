"""Render Notion enhanced Markdown as self-contained, styled clipboard HTML.

Inputs: a saved Notion fetch response, or --url with NOTION_TOKEN set.
No credentials or page content are committed. Never modifies a Notion page.
"""
import argparse
import base64
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from functools import lru_cache
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from markdown_it import MarkdownIt
import requests

ROOT = Path(__file__).resolve().parents[2]
TEXT_COLORS = dict(zip(
    'gray brown orange yellow green blue purple pink red'.split(),
    '#787774 #9f6b53 #d9730d #cb912f #448361 #337ea9 #9065b0 #c14c8a #d44c47'.split()))
BG_COLORS = dict(zip(
    'gray brown orange yellow green blue purple pink red'.split(),
    '#f1f1ef #f4eeee #fbecdd #fbf3db #edf3ec #e7f3f8 #f4f0f7 #f9eef3 #fbe4e4'.split()))


def color_style(value):
    if not value or value == 'default':
        return ''
    if value.endswith(('_bg', '_background')):
        key = value.split('_')[0]
        if key in BG_COLORS:
            return 'background-color:' + BG_COLORS[key] + ';'
    if value in TEXT_COLORS:
        return 'color:' + TEXT_COLORS[value] + ';'
    raise ValueError('Unsupported Notion color: ' + value)


def safe_url(value, image=False):
    if image and re.match(r'^data:image/(png|jpeg|gif|webp);base64,', value):
        return value
    parsed = urlparse(value)
    if parsed.scheme not in (('https',) if image else ('http', 'https', 'mailto')):
        raise ValueError('Unsupported URL scheme: ' + parsed.scheme)
    return value


class Renderer:
    def __init__(self):
        self.md = MarkdownIt('commonmark', {'html': False}).enable('strikethrough')
        self.formulas = []
        self.slot_serial = 0
        self.stats = {'inline_math': 0, 'display_math': 0, 'images': 0,
                      'colors': 0, 'toggles': 0, 'paragraphs': 0}

    def math(self, tex, display=False):
        index = len(self.formulas)
        self.formulas.append({'tex': tex, 'display': display})
        self.stats['display_math' if display else 'inline_math'] += 1
        return '<math-slot data-index="%s"></math-slot>' % index

    def inline(self, text):
        # Protect math before parsing any HTML or Markdown punctuation.
        slots = []

        def slot(value):
            key = 'N2WPLACEHOLDER%06dEND' % self.slot_serial
            self.slot_serial += 1
            slots.append((key, value))
            return key

        text = re.sub(r'\$`(.*?)`\$', lambda m: slot(self.math(m[1])), text)
        text = re.sub(r'<span\s+([^>]+)>(.*?)</span>',
                      lambda m: slot(self.styled_span(m[1], m[2])), text)
        text = re.sub(r'<mention-page\s+url="([^"]+)"\s*(?:/>|>(.*?)</mention-page>)',
                      lambda m: slot('<a href="%s">%s</a>' % (
                          html.escape(safe_url(m[1]), quote=True),
                          self.inline(m[2] or '查看原文页面'))), text)
        text = text.replace('<br>', slot('<br>'))
        # Notion permits spaces inside **...**, unlike CommonMark emphasis.
        text = re.sub(r'\*\*(.+?)\*\*', lambda m: slot('<strong>' + self.inline(m[1]) + '</strong>'), text)
        result = self.md.renderInline(text)
        for key, value in reversed(slots):
            result = result.replace(key, value)
        return result

    def styled_span(self, attrs, body):
        color = re.search(r'color="([^"]+)"', attrs)
        style = color_style(color[1]) if color else ''
        if color:
            self.stats['colors'] += 1
        if 'underline="true"' in attrs:
            style += 'text-decoration:underline;'
        return '<span style="%s">%s</span>' % (style, self.inline(body))

    def blocks(self, source):
        lines = source.splitlines()
        out, i, list_kind = [], 0, None
        while i < len(lines):
            raw = lines[i]
            line = raw.strip()
            i += 1
            if not line:
                continue
            bullet = re.match(r'^(- |\d+\. )(.*)', line)
            kind = ('ul' if bullet[1] == '- ' else 'ol') if bullet else None
            if list_kind != kind:
                if list_kind:
                    out.append('</%s>' % list_kind)
                if kind:
                    out.append('<%s>' % kind)
                list_kind = kind
            if line == '$$':
                tex = []
                while i < len(lines) and lines[i].strip() != '$$':
                    tex.append(lines[i].strip())
                    i += 1
                if i == len(lines):
                    raise ValueError('Unclosed display equation')
                i += 1
                out.append('<section class="equation">' + self.math('\n'.join(tex), True) + '</section>')
                continue
            if line.startswith('```'):
                code = []
                while i < len(lines) and not lines[i].strip().startswith('```'):
                    code.append(lines[i]); i += 1
                if i == len(lines):
                    raise ValueError('Unclosed code fence')
                i += 1
                out.append('<pre><code>' + html.escape('\n'.join(code)) + '</code></pre>')
                continue
            if line.startswith('<details') or line.startswith('<callout'):
                tag = 'details' if line.startswith('<details') else 'callout'
                depth, body = 1, []
                while i < len(lines):
                    child = lines[i].strip()
                    if child.startswith('<' + tag):
                        depth += 1
                    if child == '</' + tag + '>':
                        depth -= 1
                    i += 1
                    if depth == 0:
                        break
                    body.append(lines[i-1])
                if depth:
                    raise ValueError('Unclosed ' + tag)
                color = re.search(r'color="([^"]+)"', line)
                style = color_style(color[1]) if color else ''
                self.stats['colors'] += bool(color)
                self.stats['toggles'] += tag == 'details'
                out.append('<section class="note" style="%s">%s</section>' % (style, self.blocks('\n'.join(body))))
                continue
            if line.startswith('<summary>') and line.endswith('</summary>'):
                out.append('<p class="note-title">' + self.inline(line[9:-10]) + '</p>')
                continue
            if line.startswith('<table'):
                table = [line]
                while '</table>' not in table[-1] and i < len(lines):
                    table.append(lines[i]); i += 1
                if '</table>' not in table[-1]:
                    raise ValueError('Unclosed table')
                # A comparison such as x<y inside a table formula is TeX, not
                # an HTML opening tag. Protect it before parsing the table.
                table_math = {}

                def protect_table_math(match):
                    key = 'N2WTABLEMATH%06dEND' % self.slot_serial
                    self.slot_serial += 1
                    table_math[key] = self.math(match[1])
                    return key

                table_source = re.sub(r'\$`(.*?)`\$', protect_table_math, '\n'.join(table))
                soup = BeautifulSoup(table_source, 'html.parser')
                for node in soup.find_all(True):
                    if node.name not in ('table', 'tr', 'td', 'th', 'colgroup', 'col', 'span', 'br'):
                        raise ValueError('Unsupported table element: ' + node.name)
                for node in soup.find_all(True):
                    if node.name in ('span', 'br'):
                        continue
                    color = node.get('color')
                    node.attrs = {'style': color_style(color)} if color else {}
                    self.stats['colors'] += bool(color)
                for cell in soup.select('td,th'):
                    rendered = self.inline(cell.decode_contents())
                    for key, value in table_math.items():
                        rendered = rendered.replace(key, value)
                    cell.clear(); cell.append(BeautifulSoup(rendered, 'html.parser'))
                out.append(str(soup)); continue
            if re.match(r'^</?(columns|column)(\s|>)', line):
                continue  # Reading order becomes a single column.
            attr = re.search(r' \{color="([^"]+)"\}$', line)
            style = color_style(attr[1]) if attr else ''
            if attr:
                line = line[:attr.start()]
                self.stats['colors'] += 1
            if line == '---':
                out.append('<hr>'); continue
            if line == '<empty-block/>':
                out.append('<p><br></p>'); continue
            if re.match(r'^<(unknown|database|synced_block|image|video|audio|embed|file|pdf|tabs|custom-block)\b', line):
                raise ValueError('Block needs an explicit adapter: ' + line[:100])
            heading = re.match(r'^(#{1,4}) (.*)', line)
            if heading:
                level = len(heading[1])
                out.append('<h%d style="%s">%s</h%d>' % (level, style, self.inline(heading[2]), level))
            elif bullet:
                body = re.sub(r'^(- |\d+\. )', '', line)
                body = re.sub(r'^\[ \] ', '☐ ', body)
                body = re.sub(r'^\[x\] ', '☑ ', body)
                out.append('<li style="%s">%s</li>' % (style, self.inline(body)))
            elif line.startswith('> '):
                out.append('<blockquote style="%s">%s</blockquote>' % (style, self.inline(line[2:])))
            else:
                self.stats['paragraphs'] += 1
                out.append('<p style="%s">%s</p>' % (style, self.inline(line)))
        if list_kind:
            out.append('</%s>' % list_kind)
        return '\n'.join(out)


def render_equations(formulas):
    # MathJax is the existing editor's JS engine; all orchestration stays in Python.
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is required for the installed MathJax engine')
    bridge = r'''const fs=require('fs');
require(process.argv[1]).init({loader:{paths:{mathjax:process.argv[1]+'/es5'},load:['input/tex','output/svg']},
  tex:{packages:['base','ams','newcommand','noundefined']},svg:{fontCache:'none'}}).then(M=>{
  const a=M.startup.adaptor;
  const values=JSON.parse(fs.readFileSync(0,'utf8'));
  console.log(JSON.stringify(values.map(x=>a.outerHTML(M.tex2svg(x.tex,{display:x.display,em:16,ex:8})))));
}).catch(e=>{console.error(e);process.exit(1)});'''
    result = subprocess.run([node, '-e', bridge, str(ROOT / 'node_modules/mathjax')],
                            input=json.dumps(formulas), text=True, encoding='utf-8',
                            capture_output=True)
    if result.returncode:
        raise RuntimeError('MathJax: ' + result.stdout + result.stderr)
    return json.loads(result.stdout)


STYLES = {
    'article': 'font-family:"Microsoft YaHei",Arial,sans-serif;font-size:16px;line-height:1.9;color:#37352f;word-wrap:break-word;',
    'h1': 'font-size:25px;line-height:1.45;margin:24px 0 20px;font-weight:700;',
    'h2': 'font-size:21px;line-height:1.5;margin:30px 0 16px;font-weight:700;',
    'h3': 'font-size:18px;line-height:1.6;margin:24px 0 12px;font-weight:700;',
    'h4': 'font-size:17px;margin:20px 0 12px;',
    'p': 'margin:0 0 16px;line-height:1.9;',
    'ul,ol': 'margin:0 0 18px;padding-left:26px;',
    'li': 'margin:7px 0;line-height:1.9;',
    'strong': 'font-weight:700;',
    'blockquote': 'margin:16px 0;padding:12px 16px;border-left:3px solid #c8c5bd;background-color:#f7f7f5;',
    '.note': 'margin:20px 0;padding:16px 18px;background-color:#f7f7f5;border-left:3px solid #c8c5bd;',
    '.note-title': 'font-weight:700;margin:0 0 10px;',
    '.equation': 'display:block;text-align:center;margin:18px 0;overflow-x:auto;',
    'img': 'max-width:100%;',
    'pre': 'padding:14px;background-color:#f5f5f3;white-space:pre-wrap;word-break:break-word;',
    'code': 'font-family:Consolas,monospace;',
    'hr': 'border:0;border-top:1px solid #e3e1db;margin:28px 0;',
    'a': 'color:#337ea9;text-decoration:underline;',
    'table': 'border-collapse:collapse;width:100%;margin:20px 0;font-size:14px;',
    'td,th': 'border:1px solid #ddd;padding:8px;vertical-align:top;',
}


@lru_cache(maxsize=1)
def cjk_font():
    from fontTools.ttLib import TTFont
    path = os.environ.get('NOTION_CJK_FONT', 'C:/Windows/Fonts/msyh.ttc')
    return TTFont(path, fontNumber=0)


def outline_cjk(svg_doc):
    """Keep Chinese formula glyphs self-contained, including after rich-text copy."""
    from fontTools.pens.svgPathPen import SVGPathPen
    for node in list(svg_doc.find_all('text')):
        value = node.get_text()
        if not any(ord(c) > 127 for c in value):
            continue
        font = cjk_font()
        cmap, glyphs = font.getBestCmap(), font.getGlyphSet()
        units = font['head'].unitsPerEm
        size = float(node.get('font-size', '884px').removesuffix('px'))
        group = svg_doc.new_tag('g')
        if node.get('transform'):
            group['transform'] = node['transform']
        for offset, char in enumerate(value):
            name = cmap.get(ord(char))
            if not name:
                raise ValueError('CJK font missing glyph: ' + char)
            pen = SVGPathPen(glyphs)
            glyphs[name].draw(pen)
            path = svg_doc.new_tag('path', d=pen.getCommands())
            # MathJax 3 assigns 600 SVG units to each unknown CJK character.
            path['transform'] = 'translate(%d,0) scale(%f,%f)' % (
                offset * 600, 600 / glyphs[name].width, -size / units)
            group.append(path)
        node.replace_with(group)


def finish_html(body, renderer):
    soup = BeautifulSoup('<article>' + body + '</article>', 'html.parser')
    rendered = render_equations(renderer.formulas) if renderer.formulas else []
    for placeholder in soup.select('math-slot'):
        index = int(placeholder['data-index'])
        item = renderer.formulas[index]
        svg_doc = BeautifulSoup(rendered[index], 'xml')
        if svg_doc.find(attrs={'data-mml-node': 'merror'}):
            raise ValueError('MathJax failed: ' + item['tex'])
        svg = svg_doc.find('svg')
        if not svg:
            raise ValueError('No SVG for equation ' + str(index))
        outline_cjk(svg_doc)
        # Match Markdown Nice's WeChat export: keep vector paths and viewBox,
        # move dimensions to inline CSS, and preserve MathJax's baseline.
        width, height = svg.attrs.pop('width'), svg.attrs.pop('height')
        foreground = '#37352f'
        for parent in placeholder.parents:
            match = re.search(r'(?:^|;)\s*color:\s*([^;]+)', parent.get('style', ''))
            if match:
                foreground = match[1]
                break
        svg['style'] = svg.get('style', '').rstrip(';') + (
            ';width:%s;height:%s;overflow:visible;color:%s;' % (width, height, foreground))
        svg['data-formula'] = item['tex']
        svg['role'] = 'img'
        svg['aria-label'] = item['tex']
        svg.attrs.pop('focusable', None)
        for node in svg.find_all(True):
            if node.get('class') == 'mjx-solid':
                node['fill'], node['stroke-width'] = 'none', '70'
            node.attrs.pop('class', None)
        # Insert the XML node directly; an HTML reparse would lowercase viewBox.
        placeholder.replace_with(svg)
    for img in soup.select('img'):
        src = safe_url(img['src'], image=True)
        if not src.startswith('data:'):
            # User-requested image content only; no cookies or tokens are forwarded.
            response = requests.get(src, timeout=40)
            response.raise_for_status()
            from PIL import Image
            loaded = Image.open(io.BytesIO(response.content))
            loaded.load()
            buffer = io.BytesIO()
            loaded.save(buffer, format='PNG')
            src = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()
        img['src'] = src
        renderer.stats['images'] += 1
    # Defaults first, original explicit color/highlight last.
    for selector, style in STYLES.items():
        for el in soup.select(selector):
            el['style'] = style + el.get('style', '')
    for el in soup.find_all(True):
        # These SVG nodes are generated by MathJax, never accepted from source
        # HTML. Preserve their geometry rather than applying HTML's allowlist.
        if el.name == 'svg' or el.find_parent('svg'):
            continue
        for key in list(el.attrs):
            if key not in ('style', 'src', 'href', 'alt', 'data-formula'):
                del el.attrs[key]
    return str(soup.article)


def source_content(data, title=None):
    if not isinstance(data, dict):
        raise ValueError('Expected a Notion page JSON object')
    if data.get('truncated') or data.get('unknown_block_ids') or data.get('unknown_block_count'):
        raise ValueError('Incomplete Notion response; retrieve missing blocks first')
    source = data.get('markdown', data.get('text', ''))
    if not isinstance(source, str):
        raise ValueError('Page content must be text')
    if '<content>\n' in source:
        source = source.split('<content>\n', 1)[1].rsplit('\n</content>', 1)[0]
    if not source.strip():
        raise ValueError('Page has no content')
    return title or data.get('title', 'Notion 文章'), source


def load_source(args):
    if args.url:
        match = re.search(r'([a-f0-9]{32}|[a-f0-9-]{36})(?:[/?#]|$)', args.url)
        if not match:
            raise ValueError('No Notion page ID in URL')
        token = os.environ.get('NOTION_TOKEN')
        if not token:
            raise ValueError('Private link requires NOTION_TOKEN, or save the connected Notion fetch result as --input')
        response = requests.get('https://api.notion.com/v1/pages/' + match[1] + '/markdown',
            headers={'Authorization': 'Bearer ' + token, 'Notion-Version': '2026-03-11'}, timeout=60)
        response.raise_for_status()
        data = response.json()
        data['title'] = args.title or 'Notion 文章'
    else:
        data = json.loads(args.input.read_text(encoding='utf-8'))
    return source_content(data, args.title)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--input', type=Path)
    group.add_argument('--url')
    parser.add_argument('--title')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    title, source = load_source(args)
    renderer = Renderer()
    body = '<h1>' + html.escape(title) + '</h1>' + renderer.blocks(source)
    article = finish_html(body, renderer)
    template = (Path(__file__).with_name('preview.html')).read_text(encoding='utf-8')
    result = template.replace('@@TITLE@@', html.escape(title)).replace('@@ARTICLE@@', article)
    result = result.replace('@@STATS@@', html.escape(json.dumps(renderer.stats, ensure_ascii=False)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf-8')
    args.output.with_suffix('.fragment.html').write_text(article, encoding='utf-8')
    args.output.with_suffix('.report.json').write_text(json.dumps(renderer.stats, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), **renderer.stats}, ensure_ascii=False))


if __name__ == '__main__':
    main()
