"""公開用ビルド（public/）の SHA-256 を記録した MANIFEST を作る。
    python3 dev/tools/make_manifest.py v0.2.3
docs/MANIFEST_v0.2.3.sha256 を新しく作る。書式は「SHA-256 2つの空白 public/からのパス」を1行ずつ、パスの昇順。
過去の版の MANIFEST は書き換えない（同じ版のファイルがすでにあれば何もせずに終わる）。
版は表示の版（public/index.html の id="ver"）と同じで、記録済みのどの版よりも新しくなければ作らない。"""
import hashlib, re, sys
sys.dont_write_bytecode = True
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_manifest import manifests, semver

def lines():
    files = sorted(str(f.relative_to(ROOT)).replace('\\', '/') for f in (ROOT / 'public').rglob('*') if f.is_file())
    return [f'{hashlib.sha256((ROOT / p).read_bytes()).hexdigest()}  {p}' for p in files]

if __name__ == '__main__':
    if len(sys.argv) != 2 or not re.fullmatch(r'v\d+\.\d+\.\d+', sys.argv[1]):
        sys.exit('使い方：python3 dev/tools/make_manifest.py v<版>（例：v0.2.3）')
    ver = sys.argv[1]
    shown = re.search(r'id="ver">([^<]+)<', (ROOT / 'public/index.html').read_text(encoding='utf-8'))
    if not shown or shown.group(1).strip() != ver:
        sys.exit(f'表示の版（id="ver"）が {shown.group(1) if shown else "見つからない"} なので、{ver} の MANIFEST は作らない')
    out = ROOT / f'docs/MANIFEST_{ver}.sha256'
    if out.exists():
        sys.exit(f'{out.relative_to(ROOT)} はすでにある。過去の MANIFEST は書き換えない')
    old = manifests()
    if old and semver(ver) <= semver(old[-1].name):
        sys.exit(f'{ver} は記録済みの最新 {old[-1].name} より新しくない')
    body = lines()
    out.write_text('\n'.join(body) + '\n', encoding='utf-8')
    print(f'{out.relative_to(ROOT)} を作成（{len(body)} ファイル）')
