import base64
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from unittest.mock import patch, Mock

from PIL import Image
import requests

from importer import import_page, public_image_url
from serve import Handler, fetch_notion, notion_page_id


class ImporterTests(unittest.TestCase):
    def test_editable_math_colors_and_expanded_notes(self):
        source = {'title': '课堂', 'markdown': r'''## 公式
<span color="red">**重要** $`x_1<2`$</span>
重点。 {color="yellow_bg"}
<details>
<summary>教师备注</summary>
$$
\text{子集个数}=2^n
$$
</details>
<table>
<tr><td color="blue">$`x<y`$</td><td>**说明**</td></tr>
</table>'''}
        result = import_page(source)
        markdown = result['markdown']
        self.assertIn('$x_1<2$', markdown)
        self.assertIn('$$\n\\text{子集个数}=2^n\n$$', markdown)
        self.assertIn('$x&lt;y$', markdown)
        self.assertIn('color:#d44c47;', markdown)
        self.assertIn('<strong style="color:inherit;">重要</strong>', markdown)
        self.assertIn('background-color:#fbf3db;', markdown)
        self.assertIn('color:#337ea9;', markdown)
        self.assertIn('**教师备注**', markdown)
        self.assertNotIn('<details', markdown)
        self.assertNotIn('<svg', markdown)
        self.assertEqual(result['stats']['inline_math'], 2)
        self.assertEqual(result['stats']['display_math'], 1)

    def test_images_are_separate_from_editable_text_and_deduplicated(self):
        output = io.BytesIO()
        Image.new('RGB', (3, 3), 'red').save(output, 'PNG')
        url = 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()
        result = import_page({'markdown': '![图1](%s)\n![图2](%s)' % (url, url)})
        self.assertEqual(len(result['images']), 1)
        self.assertEqual(result['markdown'].count('mdnice-local-image://'), 2)
        self.assertNotIn('base64', result['markdown'])
        self.assertEqual(result['images'][0]['dataUrl'], url)

    def test_rejects_partial_or_unsupported_content(self):
        for data in ({'markdown': '一段内容', 'truncated': True},
                     {'markdown': '一段内容', 'unknown_block_ids': ['abc']},
                     {'markdown': '<video>未处理内容</video>'},
                     {'markdown': ''}, {'markdown': '长' * 100001}):
            with self.subTest(data=str(data)[:80]), self.assertRaises(ValueError):
                import_page(data)

    def test_source_html_is_text_and_cannot_execute(self):
        result = import_page({'markdown': '<script>alert(1)</script>\n普通文本 <img src=x onerror=alert(1)>'})
        self.assertNotIn('<script>', result['markdown'])
        self.assertNotIn('<img ', result['markdown'])
        self.assertIn('&lt;script&gt;', result['markdown'])

    def test_link_validation_and_private_image_block(self):
        page_id = '3f95e01d348781d9bbbbe64947eaecea'
        self.assertEqual(notion_page_id('https://app.notion.com/p/' + page_id + '?source=copy_link'), page_id)
        for url in ('https://evil.example/' + page_id, 'https://notion.so.evil.example/' + page_id,
                    'http://notion.so/' + page_id, 'https://notion.so/not-a-page'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                notion_page_id(url)
        with self.assertRaises(ValueError):
            public_image_url('https://127.0.0.1/image.png')

    @patch('serve.requests.get')
    def test_official_api_and_title(self, get):
        get.side_effect = [Mock(status_code=200, json=lambda: {'markdown': '正文'}),
                           Mock(status_code=200, json=lambda: {'properties': {'Name': {
                               'type': 'title', 'title': [{'plain_text': '页面标题'}]}}})]
        result = fetch_notion('https://notion.so/' + 'a' * 32, 'test-token')
        self.assertEqual(result['title'], '页面标题')
        self.assertEqual(get.call_args_list[0].args[0], 'https://api.notion.com/v1/pages/' + 'a' * 32 + '/markdown')
        self.assertEqual(get.call_args_list[0].kwargs['headers']['Notion-Version'], '2026-03-11')


class LocalApiTests(unittest.TestCase):
    def test_import_errors_do_not_expose_credentials_and_cross_origin_is_denied(self):
        with tempfile.TemporaryDirectory() as directory:
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=directory))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            url = 'http://127.0.0.1:%d/api/notion/import' % server.server_port
            try:
                response = requests.post(url, json={'source': {'title': '测试', 'markdown': '公式 $`x=1`$'}}, timeout=5)
                self.assertEqual(response.status_code, 200)
                self.assertIn('$x=1$', response.json()['markdown'])
                response = requests.post(url, json={'source': {'markdown': 'text', 'truncated': True}}, timeout=5)
                self.assertEqual(response.status_code, 400)
                response = requests.post(url, json={'source': {'markdown': 'text'}},
                                         headers={'Origin': 'https://unrelated.example'}, timeout=5)
                self.assertEqual(response.status_code, 403)
                with patch('serve.requests.get', return_value=Mock(status_code=401)):
                    response = requests.post(url, json={'url': 'https://notion.so/' + 'a' * 32, 'token': 'never-log-me'}, timeout=5)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn('never-log-me', response.text)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
