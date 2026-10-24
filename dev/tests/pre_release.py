"""公開前の自動テストを、まとめて実行する（必須。1つでも失敗したら公開しない）。
    python3 dev/tests/pre_release.py
実行するもの（この順）：MANIFEST の照合、版のそろい具合、MANIFEST・版の検査そのものの試験、計算・セーブ・文言の試験、画面操作の試験。
どれかが失敗しても最後まで実行し、失敗した一覧を出して終了コード1で終わる。Node.js と Playwright（Chromium）が必要で、無ければ失敗とする（省略しない）。
公開後の画面での確認（release_check.py）と、人による実機確認は、これとは別（docs/RELEASE_CHECKLIST.md）。"""
import subprocess, sys, time
sys.dont_write_bytecode = True
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
PY = [sys.executable, '-I']
STEPS = [
    ('verify_manifest.py',  PY + ['dev/tools/verify_manifest.py']),
    ('version_check.py',    PY + ['dev/tests/version_check.py']),
    ('manifest_tests.py',   PY + ['dev/tests/manifest_tests.py']),
    ('run_tests.js',        ['node', 'dev/tests/run_tests.js']),
    ('v020_tests.js',       ['node', 'dev/tests/v020_tests.js']),
    ('savecode_tests.js',   ['node', 'dev/tests/savecode_tests.js']),
    ('text_lint.js',        ['node', 'dev/tests/text_lint.js']),
    ('ui_smoke.py',         PY + ['dev/tests/ui_smoke.py', 'public/index.html']),
]

def main():
    failed = []
    for name, cmd in STEPS:
        t0 = time.time()
        print(f'--- {name}', flush=True)
        try:
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
            code, out = r.returncode, r.stdout + r.stderr
        except OSError as e:
            code, out = 127, f'実行できない：{e}'
        tail = '\n'.join(out.rstrip().splitlines()[-3:])
        print(tail)
        print(f'    → {"成功" if code == 0 else "失敗（終了コード " + str(code) + "）"}（{time.time() - t0:.0f} 秒）', flush=True)
        if code != 0: failed.append(name)
    print()
    print('公開前の自動テスト：すべて成功' if not failed else f'公開前の自動テスト：{len(failed)} 件失敗 → {", ".join(failed)}')
    return 1 if failed else 0

if __name__ == '__main__':
    sys.exit(main())
