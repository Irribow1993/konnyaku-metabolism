"""公開用ビルド（public/）が、記録した版と同じかを確かめる。
    python3 dev/tools/verify_manifest.py          … いちばん新しい版の MANIFEST と照合
    python3 dev/tools/verify_manifest.py v0.2.2   … 版を指定して照合
docs/MANIFEST_v<版>.sha256 に記録した SHA-256 と、public/ の全ファイルを照合する。
終了コード：0＝すべて一致、1＝不一致（または MANIFEST の書式エラー・指定した版が無い）。"""
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

class ManifestError(Exception):
    """MANIFEST の書式が正しくない（トレースバックではなく、どこが悪いかを示すための例外）。"""

def parse(path):
    """MANIFEST を {public/からのパス: SHA-256} にする。1行は「SHA-256（小文字16進64桁）・空白・public/ で始まるパス」。
    書式に合わない行・同じパスの重複・1行も無い MANIFEST は ManifestError（行番号つき）。"""
    rec = {}
    for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        m = re.fullmatch(r'([0-9a-f]{64})\s+(public/\S.*?)\s*', line)
        if not m:
            raise ManifestError(f'{path.name} の {n} 行目が書式に合わない'
                                f'（「SHA-256（小文字16進64桁）・空白・public/ で始まるパス」であること）：{line.strip()[:60]!r}')
        h, p = m.groups()
        if p in rec:
            raise ManifestError(f'{path.name} の {n} 行目：{p} が重複している')
        rec[p] = h
    if not rec:
        raise ManifestError(f'{path.name} に記録が1行も無い')
    return rec

def verify(path):
    rec = parse(path)
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
    try:
        bad, rec, now = verify(target)
    except ManifestError as e:
        sys.exit(f'MANIFEST の書式エラー：{e}')
    for p in bad:
        print('  ✘', p, '（変更・追加・削除）' if p in now and p in rec else '（記録にない・見つからない）')
    print(f'すべて一致（{ver} のまま）' if not bad else f'{len(bad)} 件が {ver} の記録と異なる')
    sys.exit(1 if bad else 0)
