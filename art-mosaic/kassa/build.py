# Index.html → константа INDEX_HTML в Code.gs и app/index.html (GitHub Pages)
import json, os
import pathlib
d = str(pathlib.Path(__file__).resolve().parent.parent) + '/'
h = open(d + 'kassa/Index.html', encoding='utf-8').read()
s = open(d + 'kassa/Code.gs', encoding='utf-8').read(); i = s.index('const INDEX_HTML = ')
open(d + 'kassa/Code.gs', 'w', encoding='utf-8').write(s[:i] + 'const INDEX_HTML = ' + json.dumps(h, ensure_ascii=False) + ';\n')
os.makedirs(d + 'app', exist_ok=True)
open(d + 'app/index.html', 'w', encoding='utf-8').write(h.replace('<base target="_top">\n', ''))
print('built')
