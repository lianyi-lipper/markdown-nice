"""Focused fidelity checks plus a separate, clearly labeled visual fixture."""
import argparse
import base64
from collections import Counter
import io
import json
from pathlib import Path
import re
import subprocess
import sys

from bs4 import BeautifulSoup
from PIL import Image, ImageDraw
from render import Renderer, finish_html


def verify_article(path):
    soup = BeautifulSoup(path.read_text(encoding='utf-8'), 'html.parser')
    article = soup.select_one('article')
    assert article
    assert not article.select('script, iframe, math-slot, details, mjx-container')
    assert 'N2WPLACEHOLDER' not in str(article)
    assert '$`' not in article.get_text()
    assert not article.select('img[data-formula]'), 'Formulas must remain vector SVG'
    for svg in article.select('svg'):
        assert svg.get('viewbox'), 'Missing SVG viewBox (HTML parser lowercases names)'
    for svg in article.select('svg[data-formula]'):
        assert svg['data-formula']
        assert any(path.get('d') for path in svg.select('path')), 'Empty vector formula'
        assert not svg.select('image, use, text'), 'Formula must contain self-contained paths'
        assert 'width:' in svg.get('style', '') and 'height:' in svg.get('style', '')
    assert path.read_text(encoding='utf-8').count('viewBox=') == len(article.select('svg'))
    for img in article.select('img'):
        assert img['src'].startswith('data:image/png;base64,')
        picture = Image.open(io.BytesIO(base64.b64decode(img['src'].split(',')[1])))
        assert picture.getbbox(), 'Empty raster image: ' + img.get('alt', '')
    return article


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--directory', type=Path, required=True)
    args = p.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGB', (600, 250), '#fffdf6')
    draw = ImageDraw.Draw(image)
    draw.ellipse((110, 35, 330, 235), fill='#e7f3f8', outline='#337ea9', width=4)
    draw.ellipse((270, 35, 490, 235), outline='#d44c47', width=4)
    draw.text((200, 110), 'A', fill='#337ea9', font_size=35)
    draw.text((390, 110), 'B', fill='#d44c47', font_size=35)
    buffer = io.BytesIO(); image.save(buffer, format='PNG')
    data_url = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()
    fixture = '''# 格式验证样例
这份样例用于检查转换器，不属于用户原讲稿。
<span color="red">红色文字</span>与<span color="blue">**蓝色加粗**</span>。
<span color="yellow_bg">黄色高亮，保留重点</span>。
整段绿色文字。 {color="green"}
<span color="red">红色公式 $`x^2=1`$</span>，普通公式 $`\\frac{1}{2}`$。
$$
\\text{子集个数}=2^n,\\qquad A\\cap B=\\varnothing
$$
![内嵌图片验证](IMAGE_URL)
<details>
<summary>折叠备注保留检查</summary>
\t备注的正文应当展开，**加粗**和 $`n\\geq1`$ 应保留。
</details>
<table>
<tr><td>项目</td><td>结果</td></tr>
<tr><td color="blue">颜色</td><td>**保留**</td></tr>
</table>
'''.replace('IMAGE_URL', data_url)
    data = {'title': '颜色、图片与公式验证', 'markdown': fixture}
    fixture_path = args.directory / 'fixture.json'
    fixture_path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    output = args.directory / 'fixture.html'
    subprocess.run([sys.executable, str(Path(__file__).with_name('render.py')), '--input', str(fixture_path), '--output', str(output)], check=True)
    article = verify_article(output)
    assert len(article.select('img')) == 1
    assert len(article.select('svg[data-formula]')) == 4
    assert article.find('span', string='红色文字')['style'] == 'color:#d44c47;'
    assert 'background-color:#fbf3db' in str(article)
    assert 'color:#448361' in str(article)
    assert article.find('strong', string='蓝色加粗')
    red_formula = next(svg for svg in article.select('svg') if svg.get('data-formula') == 'x^2=1')
    assert 'color:#d44c47' in red_formula['style'], 'Formula must inherit red'
    assert red_formula.select_one('g[fill="currentColor"]')
    table_renderer = Renderer()
    table_html = finish_html(table_renderer.blocks('<table>\n<tr><td><span color="red">$`x`$</span></td></tr>\n</table>'), table_renderer)
    table_soup = BeautifulSoup(table_html, 'html.parser')
    assert table_soup.select_one('td span')['style'] == 'color:#d44c47;'
    assert table_soup.select_one('td svg')['data-formula'] == 'x'
    lesson = args.directory / 'lesson.html'
    if lesson.exists():
        article = verify_article(lesson)
        source = json.loads((args.directory / 'source.json').read_text(encoding='utf-8'))['text']
        expected_inline = re.findall(r'\$`(.*?)`\$', source)
        expected_display = re.findall(r'^\s*\$\$\s*\n(.*?)\n\s*\$\$', source, re.S | re.M)
        expected = Counter(expected_inline + ['\n'.join(x.strip() for x in y.splitlines()) for y in expected_display])
        actual = Counter(svg['data-formula'] for svg in article.select('svg[data-formula]'))
        assert actual == expected, (expected - actual, actual - expected)
        assert len(article.select('svg[data-formula]')) == 315
        assert len(article.select('h2')) == 13
        assert '资料说明与后续整理' in article.get_text()
    print('PASS: 315 lesson formulas preserve TeX as self-contained SVG; vector paths/viewBox/dimensions intact; colors/highlight/bold/image/table/toggle retained.')


if __name__ == '__main__':
    main()
