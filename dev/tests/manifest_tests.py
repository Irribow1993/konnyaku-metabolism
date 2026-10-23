"""MANIFEST の作成・照合と、版のそろい具合の検査そのものを確かめる（共通仕様 Phase 1A）。
    python3 dev/tests/manifest_tests.py
リポジトリを一時フォルダに写して、その中で版や公開ファイルをわざと食い違わせ、検査が失敗することを確かめる。
リポジトリ自体は変更しない。"""
import re, shutil, subprocess, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
passed = failed = 0

def ok(cond, name):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print('  ✘', name)

def run(work, *args):
    r = subprocess.run([sys.executable, *args], cwd=work, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr

def fresh():
    work = Path(tempfile.mkdtemp(prefix='mf-'))
    for d in ('public', 'docs', 'dev'):
        shutil.copytree(ROOT / d, work / d)
    for f in ('CHANGELOG.md', 'README.md'):
        shutil.copy(ROOT / f, work / f)
    return work

def sub(work, rel, old, new, count=1):
    p = work / rel; s = p.read_text(encoding='utf-8')
    assert old in s, (rel, old)
    p.write_text(s.replace(old, new, count), encoding='utf-8')

VC = 'dev/tests/version_check.py'; VM = 'dev/tools/verify_manifest.py'; MM = 'dev/tools/make_manifest.py'
cur = re.search(r'id="ver">([^<]+)<', (ROOT / 'public/index.html').read_text(encoding='utf-8')).group(1)
nxt = 'v%d.%d.%d' % (lambda a, b, c: (a, b, c + 1))(*map(int, cur[1:].split('.')))

print('[M1] 今のリポジトリ')
w = fresh()
ok(run(w, VC)[0] == 0, 'version_check が成功する')
ok(run(w, VM)[0] == 0, 'verify_manifest が成功する')
sys.path.insert(0, str(w / 'dev/tools'))
import make_manifest
ok('\n'.join(make_manifest.lines()) + '\n' == (ROOT / f'docs/MANIFEST_{cur}.sha256').read_text(encoding='utf-8'),
   f'make_manifest の出力が記録済みの MANIFEST_{cur} と1バイトも違わない')

print('[M2] 最新の MANIFEST の選び方（SemVer の数値順）')
w = fresh()
src = (w / f'docs/MANIFEST_{cur}.sha256').read_text(encoding='utf-8')
(w / 'docs/MANIFEST_v0.2.10.sha256').write_text(src, encoding='utf-8')
(w / 'docs/MANIFEST_v0.2.9.sha256').write_text('0' * 64 + '  public/index.html\n', encoding='utf-8')
code, out = run(w, VM)
ok(code == 0 and 'v0.2.10 のまま' in out, '辞書順では最後にならない v0.2.10 が選ばれる')
(w / 'docs/MANIFEST_v0.2.10.sha256').unlink()
code, out = run(w, VM)
ok(code == 1 and 'v0.2.9 の記録と異なる' in out, 'v0.2.9 が最新なら v0.2.9 で照合する')
(w / 'docs/MANIFEST_v0.2.9.sha256').unlink()
code, out = run(w, VM, 'v0.2.1')
ok(code == 1 and 'v0.2.1 の記録と異なる' in out, '版を指定すると古い版で照合できる')
ok(run(w, VM, 'v9.9.9')[0] != 0, '無い版を指定すると失敗する')

print('[M3] make_manifest が作らない場合')
w = fresh()
before = {f.name: f.read_bytes() for f in (w / 'docs').glob('MANIFEST_*')}
code, out = run(w, MM, cur)
ok(code != 0 and '書き換えない' in out, '同じ版の MANIFEST がすでにあると作らない')
ok({f.name: f.read_bytes() for f in (w / 'docs').glob('MANIFEST_*')} == before, '既存の MANIFEST は1バイトも変わらない')
code, out = run(w, MM, nxt)
ok(code != 0 and '作らない' in out, '表示の版と違う版では作らない')
ok(run(w, MM, nxt[1:])[0] != 0 and run(w, MM)[0] != 0, '書式が違う・引数なしでは作らない')
sub(w, 'public/index.html', f'id="ver">{cur}<', 'id="ver">v0.0.1<')
code, out = run(w, MM, 'v0.0.1')
ok(code != 0 and '新しくない' in out, '記録済みより古い版では作らない')

print('[M4] 版の食い違いを1か所ずつ起こす')
cases = [
    ('public/index.html', f'id="ver">{cur}<', f'id="ver">{nxt}<', 'index.html id="ver"'),
    ('public/index.html', f'id="about-ver">{cur}<', f'id="about-ver">{nxt}<', 'index.html id="about-ver"'),
    ('public/js/ui.js', f"VERSION = '{cur}'", f"VERSION = '{nxt}'", 'ui.js'),
    ('CHANGELOG.md', f'## {cur}（', f'## {nxt}（', 'CHANGELOG.md'),
    ('README.md', f'― {cur}', f'― {nxt}', 'README.md'),
    ('docs/RELEASE_CHECKLIST.md', f'METABOLISM {cur}）', f'METABOLISM {nxt}）', 'RELEASE_CHECKLIST.md'),
    ('docs/DEPLOY.md', f'ヘッダに「{cur}」', f'ヘッダに「{nxt}」', 'DEPLOY.md'),
    ('docs/KNOWN_LIMITATIONS.md', f'既知の制約（{cur}）', f'既知の制約（{nxt}）', 'KNOWN_LIMITATIONS.md'),
]
for rel, old, new, label in cases:
    w = fresh(); sub(w, rel, old, new)
    code, out = run(w, VC)
    ok(code == 1 and re.search(r'✘ [^\n]*' + re.escape(label.split()[0]), out) is not None, f'{label} だけ違うと失敗し、その場所を示す')
w = fresh(); (w / f'docs/MANIFEST_{nxt}.sha256').write_text((w / f'docs/MANIFEST_{cur}.sha256').read_text(encoding='utf-8'), encoding='utf-8')
code, out = run(w, VC)
ok(code == 1 and '✘ 最新の MANIFEST' in out, 'MANIFEST だけ先の版があると失敗する')
w = fresh(); sub(w, 'public/index.html', f'id="ver">{cur}<', 'id="ver">0.2.2<')
ok(run(w, VC)[0] == 1, '「v」の無い書き方は失敗する')

print('[M5] 版は同じで公開ファイルだけ変える')
for rel in ('public/js/sim.js', 'public/_headers', 'public/ogp.png'):
    w = fresh(); p = w / rel; p.write_bytes(p.read_bytes() + b'\n')
    code, out = run(w, VC)
    ok(code == 1 and 'MANIFEST の照合' not in out and '✘ public/ が' in out, f'{rel} を1バイト変えると失敗する')
w = fresh(); (w / 'public/extra.txt').write_text('x', encoding='utf-8')
ok(run(w, VC)[0] == 1, 'public/ にファイルを足すと失敗する')
w = fresh(); (w / 'public/robots.txt').unlink()
ok(run(w, VC)[0] == 1, 'public/ からファイルを消すと失敗する')

print('[M6] 正しい手順で版を上げると成功する')
w = fresh()
for rel, old, new, _ in cases: sub(w, rel, old, new)
ok(run(w, VC)[0] == 1, 'MANIFEST を作る前は失敗する')
code, out = run(w, MM, nxt)
ok(code == 0 and (w / f'docs/MANIFEST_{nxt}.sha256').exists(), f'{nxt} の MANIFEST を作れる')
ok((w / f'docs/MANIFEST_{cur}.sha256').read_bytes() == (ROOT / f'docs/MANIFEST_{cur}.sha256').read_bytes(), f'{cur} の MANIFEST は変わらない')
code, out = run(w, VC)
ok(code == 0 and f'すべて {nxt} でそろっている' in out, '版をそろえて MANIFEST を作ると成功する')
ok(run(w, VM, cur)[0] == 1, '古い版との照合は失敗する（公開ファイルが変わったため）')

print(f'\n{passed + failed} 項目中 {passed} 成功' + ('' if not failed else f'、{failed} 失敗'))
sys.exit(1 if failed else 0)
