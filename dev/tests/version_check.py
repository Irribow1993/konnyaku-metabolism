"""版のそろい具合を確かめる（共通仕様 Phase 1A-2）。
    python3 dev/tests/version_check.py
公開する版ごとに、次がすべて同じ版でなければ失敗する（食い違ったときは、最も多くの場所に書かれている版を基準にして、違う場所を示す）。
  - 表示の版：public/index.html の id="ver"・id="about-ver"
  - JS の版：public/js/ui.js の VERSION または APP_VERSION（どちらの名前でもよい）
  - CHANGELOG.md の先頭の版
  - docs/ の最新の MANIFEST（SemVer の数値順）。さらに public/ がその記録と一致すること
  - README.md・docs/RELEASE_CHECKLIST.md・docs/DEPLOY.md・docs/KNOWN_LIMITATIONS.md に書いた版
開発用の検査（text_lint.js・release_check.py）に版が直書きされていないこと（版は public/index.html から導く）。
git のタグ v<版> は公開を確認してから作るので、無くても失敗にしない（あれば、指しているコミットを表示する）。"""
import re, subprocess, sys
from collections import Counter
sys.dont_write_bytecode = True
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'dev/tools'))
from verify_manifest import ManifestError, manifests, semver, verify

def read(p): return (ROOT / p).read_text(encoding='utf-8')
def one(pattern, text):
    m = re.search(pattern, text, re.M)
    return m.group(1).strip() if m else None

def collect():
    html, ui = read('public/index.html'), read('public/js/ui.js')
    ms = manifests()
    return {
        'index.html id="ver"':        one(r'id="ver">([^<]+)<', html),
        'index.html id="about-ver"':  one(r'id="about-ver">([^<]+)<', html),
        'ui.js APP_VERSION':          one(r"const (?:APP_VERSION|VERSION) = '([^']+)'", ui),
        'CHANGELOG.md の先頭':         one(r'^## (v\d+\.\d+\.\d+)', read('CHANGELOG.md')),
        '最新の MANIFEST':             ms[-1].name[len('MANIFEST_'):-len('.sha256')] if ms else None,
        'README.md':                  one(r'^\*\*.*\*\* ― (v\d+\.\d+\.\d+)', read('README.md')),
        'RELEASE_CHECKLIST.md':       one(r'^# 公開チェックリスト（METABOLISM (v\d+\.\d+\.\d+)）', read('docs/RELEASE_CHECKLIST.md')),
        'DEPLOY.md の確認項目':         one(r'ヘッダに「(v\d+\.\d+\.\d+)」', read('docs/DEPLOY.md')),
        'KNOWN_LIMITATIONS.md':       one(r'^# 既知の制約（(v\d+\.\d+\.\d+)）', read('docs/KNOWN_LIMITATIONS.md')),
    }

def main():
    found = collect()
    # 基準は最も多くの場所に書かれている版。食い違った場所に ✘ が付く
    want = Counter(v for v in found.values() if v).most_common(1)[0][0]
    fails = []
    for k, v in found.items():
        ok = v is not None and v == want and semver(v) is not None
        print(('  ✔ ' if ok else '  ✘ ') + f'{k}：{v or "見つからない"}')
        if not ok: fails.append(k)
    ms = manifests()
    if ms and found['最新の MANIFEST'] == want:
        try:
            bad, _, _ = verify(ms[-1])
            print(('  ✔ ' if not bad else '  ✘ ') + f'public/ が {ms[-1].name} と一致' + ('' if not bad else f'（{len(bad)} 件が異なる）'))
            if bad: fails.append('MANIFEST の照合')
        except ManifestError as e:
            print(f'  ✘ MANIFEST の書式エラー：{e}')
            fails.append('MANIFEST の書式')
    # 版を直書きした検査が残っていないか（版上げのたびに書き換え忘れて、公開前の自動テストが失敗する／見逃すのを防ぐ）
    for f in ('dev/tests/text_lint.js', 'dev/tests/release_check.py'):
        hard = [i for i, l in enumerate(read(f).splitlines(), 1)
                if re.search(r'ver"|VERSION|#ver|EXPECTED_VER', l) and re.search(r'v\d+(?:\\?\.\d+){2}', l)]
        print(('  ✔ ' if not hard else '  ✘ ') + f'{f} に版の直書きが無い' + ('' if not hard else f'（{", ".join(map(str, hard))} 行目）'))
        if hard: fails.append(f + ' の版の直書き')
    try:
        tag = subprocess.run(['git', 'rev-parse', '--short', f'{want}^{{commit}}'], cwd=ROOT,
                             capture_output=True, text=True).stdout.strip()
    except OSError: tag = ''
    print(f'  ・ git タグ {want}：' + (f'{tag} を指している' if tag else 'まだ無い（公開を確認してから作る）'))
    print(f'すべて {want} でそろっている' if not fails else f'{len(fails)} 件が {want} とそろっていない')
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
