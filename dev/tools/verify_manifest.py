"""公開用ビルド（public/）が、記録した版と同じかを確かめる。
    python3 dev/tools/verify_manifest.py          … いちばん新しい版の MANIFEST と照合
    python3 dev/tools/verify_manifest.py v0.2.2   … 版を指定して照合
docs/MANIFEST_v<版>.sha256 に記録した SHA-256 と、public/ の全ファイルを照合する。"""
import hashlib, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent

def semver(s):
    """'v0.2.10'・'MANIFEST_v0.2.10.sha256' → (0, 2, 10)。数として比べるので v0.2.10 は v0.2.9 より新しい。"""
    m = re.search(r'v(\d+)\.(\d+)\.(\d+)', s)
    return tuple(map(int, m.groups())) if m else None

def manifests():
    """docs/ の MANIFEST_v<版>.sha256 を、版の古い順に（ファイル名の辞書順ではなく SemVer の数値順）。"""
    found = [f for f in (ROOT / 'docs').glob('MANIFEST_v*.sha256')
             if re.fullmatch(r'MANIFEST_v\d+\.\d+\.\d+\.sha256', f.name)]
    return sorted(found, key=lambda f: semver(f.name))

def verify(path):
    rec = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.strip():
            h, p = line.split(None, 1); rec[p.strip()] = h
    now = {str(f.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(f.read_bytes()).hexdigest()
           for f in sorted((ROOT / 'public').rglob('*')) if f.is_file()}
    return sorted(set([p for p in rec if now.get(p) != rec[p]] + [p for p in now if p not in rec])), rec, now

if __name__ == '__main__':
    all_m = manifests()
    if len(sys.argv) > 1:
        target = ROOT / f'docs/MANIFEST_{sys.argv[1]}.sha256'
        if not target.exists(): sys.exit(f'{target.relative_to(ROOT)} が無い')
    elif all_m: target = all_m[-1]
    else: sys.exit('docs/ に MANIFEST が無い')
    ver = target.name[len('MANIFEST_'):-len('.sha256')]
    bad, rec, now = verify(target)
    for p in bad:
        print('  ✘', p, '（変更・追加・削除）' if p in now and p in rec else '（記録にない・見つからない）')
    print(f'すべて一致（{ver} のまま）' if not bad else f'{len(bad)} 件が {ver} の記録と異なる')
    sys.exit(1 if bad else 0)
