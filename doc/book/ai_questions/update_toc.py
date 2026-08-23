"""questions.md의 ## / ### 헤딩을 읽어 목차를 다시 생성한다.

사용법:
    python3 update_toc.py [파일명]      # 기본값 questions.md

- 기존 '## 목차' 블록은 지우고 출처 blockquote 아래에 새로 넣는다.
- 앵커는 GitHub 방식(소문자화, 공백→하이픈, 문장부호 제거)으로 만든다.
- 같은 앵커가 두 번 생기면 경고를 출력한다.
"""
import re, sys
from collections import Counter

path = sys.argv[1] if len(sys.argv) > 1 else 'questions.md'
lines = open(path, encoding='utf-8').read().split('\n')

def slug(t):
    s = ''.join(c for c in t.lower() if c.isalnum() or c in ' -_')
    return s.strip().replace(' ', '-')

toc, slugs = ['## 목차', ''], []
for ln in lines:
    m = re.match(r'^(#{2,3}) (.+)$', ln)
    if not m or m.group(2).strip() == '목차':
        continue
    level, title = m.group(1), m.group(2).strip()
    indent = '' if level == '##' else '  '
    toc.append(f'{indent}- [{title}](#{slug(title)})')
    slugs.append(slug(title))
toc.append('')

start = next((i for i, l in enumerate(lines) if l.strip() == '## 목차'), None)
if start is not None:
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith('## '))
    lines = lines[:start] + lines[end:]

# 첫 번째 섹션(## ) 바로 앞에 삽입한다. 출처 blockquote 유무와 무관하게 동작한다.
at = next((i for i, l in enumerate(lines) if l.startswith('## ')), len(lines))
open(path, 'w', encoding='utf-8').write('\n'.join(lines[:at] + toc + lines[at:]))

dups = [s for s, c in Counter(slugs).items() if c > 1]
print(f'목차 항목 {len(slugs)}개 갱신')
print('⚠️ 중복 앵커: ' + ', '.join(dups) if dups else '✅ 앵커 중복 없음')
