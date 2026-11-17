"""Build index.html from the sources in src/ and the data in data/.

The page is fully self-contained (styles, code, timetable and background map are inline),
so it works offline once the service worker has cached it.

    python3 tools/assemble.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def inline_json(rel):
    # compact and safe inside <script>: never let "</" close the tag early
    data = json.loads(read(rel))
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


HEAD = """<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1B273A">
<meta name="description" content="Къде са влаковете на софийското метро сега, по официалното разписание на ЦГМ.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Метро София">
<style>
:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
"""

SW = """<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
</script>
"""

html = (
    HEAD
    + read('src/head.html')
    + '</head>\n<body>\n'
    + read('src/body.html')
    + '<script type="application/json" id="basemap-data">' + inline_json('data/basemap.json') + '</script>\n'
    + '<script type="application/json" id="metro-data">' + inline_json('data/metro.json') + '</script>\n'
    + '<script>\n' + read('src/app.js') + '</script>\n'
    + SW
    + '</body>\n</html>\n'
)
(ROOT / 'index.html').write_text(html, encoding='utf-8')
print('index.html', len(html.encode('utf-8')), 'bytes')
