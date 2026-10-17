"""公開用ビルド（public/）が、固定した v0.1.0 最終候補と同じかを確かめる。
    python3 dev/tools/verify_manifest.py
docs/MANIFEST_v0.1.0.sha256 に記録した SHA-256（RC2） と、public/ の全ファイルを照合する。"""
import hashlib, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
rec = {}
for line in (ROOT / 'docs/MANIFEST_v0.1.0.sha256').read_text(encoding='utf-8').splitlines():
    if line.strip():
        h, p = line.split(None, 1); rec[p.strip()] = h
now = {str(f.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(f.read_bytes()).hexdigest()
       for f in sorted((ROOT / 'public').rglob('*')) if f.is_file()}
bad = [p for p in rec if now.get(p) != rec[p]] + [p for p in now if p not in rec]
for p in sorted(set(bad)):
    print('  ✘', p, '（変更・追加・削除）' if p in now and p in rec else '（記録にない・見つからない）')
print('すべて一致（v0.1.0 最終候補 RC2 のまま）' if not bad else f'{len(set(bad))} 件が記録と異なる')
sys.exit(1 if bad else 0)
