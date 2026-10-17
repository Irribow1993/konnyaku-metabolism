"""METABOLISM v0.1.0 画面操作テスト（ヘッドレス Chromium）

    python3 tests/ui_smoke.py [index.html のパス] [スクリーンショット保存先]

実際のブラウザエンジンで画面を開き、タップ操作・表示切替・酵素の解放・セーブ移行・停止時の表示を確認する。
人間による実機でのプレイ体験の確認を代替するものではない。
"""
import asyncio, json, os, sys, time, re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
# 画面テストは ?debug=1 で開く（state を読むための窓口は、debug のときだけ有効。v0.1.0）
ARG = sys.argv[1] if len(sys.argv) > 1 else str(ROOT.parent / 'public' / 'index.html')
URL = (ARG if ARG.startswith('http') else Path(ARG).resolve().as_uri()) + '?debug=1'
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
FIX = json.loads((ROOT / 'tests/fixtures/v1_saves.json').read_text(encoding='utf-8'))

fails = 0
def ok(cond, msg):
    global fails
    print(('  ✔ ' if cond else '  ✘ ') + msg)
    if not cond: fails += 1

ALL = ['glc', 'g6p', 'f6p', 'f16bp', 'dhap', 'gap', 'bpg13', 'pg3', 'pg2', 'pep', 'pyr', 'atp', 'adp', 'nad', 'nadh']
def save_v2(amounts, rp=0, levels=None, totals=None):
    base = {k: 0 for k in ALL}; base.update({"atp": 80, "adp": 20, "nad": 200})
    base.update(amounts)
    return json.dumps({"saveVersion": 2, "t": 120, "amounts": base, "levels": levels or {}, "rp": rp,
                       "totals": totals or {"pyrProduced": 50, "glcSupplied": 100}, "milestones": {}, "log": [],
                       "lastSaved": int(time.time() * 1000)})

def fresh_v1(name):
    d = dict(FIX[name]); d['lastSaved'] = int(time.time() * 1000)     # 不在時進行が起きないようにする
    return json.dumps(d)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errors = []

        async def open_page(save_json=None):
            pg = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)   # CSP 違反などもエラーとして数える
            await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
            if save_json:
                await pg.add_init_script("if (!sessionStorage.getItem('seeded')) { localStorage.setItem('metabolism.save.v1', %s); sessionStorage.setItem('seeded', '1'); }" % json.dumps(save_json))
            await pg.goto(URL)
            await pg.wait_for_timeout(600)
            return pg

        async def shot(pg, name, full=False):
            if SHOT: await pg.screenshot(path=os.path.join(SHOT, name + '.png'), full_page=full)
        st = lambda pg, expr: pg.evaluate(f'() => {{ const s = window.__METABOLISM_DEBUG__.state; return {expr}; }}')

        print('[A] 初回起動（全体表示のみ）')
        pg = await open_page()
        ok(await pg.is_visible('#goal-text'), '「次の目標」が表示される')
        ok(not await pg.is_visible('#viewswitch'), '研究前は表示切替が出ない（全体表示のみ）')
        for _ in range(3):
            await pg.tap('#btn-glc'); await pg.wait_for_timeout(150)
        await pg.tap('#flow .node.tap'); await pg.wait_for_timeout(6000)
        pyr = await pg.text_content('#flow .node >> nth=2 >> .n-val')
        ok(pyr not in ('0', '微量'), f'ピルビン酸が生成される（{pyr}）')
        txt = await pg.text_content('#flow')
        ok('グルコース' in txt and '/秒' in txt and 'ピルビン酸 ' in txt and '中間体' in txt and '換算' not in txt and '2分子に割る' not in txt,
           '速さは「グルコース ○/秒」「ピルビン酸 ○/秒」、各段に「中間体」。換算や割る説明は常時表示しない')
        ok((await pg.text_content('#g-atp-v')).startswith('ATP の割合'), 'ATP ゲージは「ATP の割合」')
        ok('ピルビン酸の生成' in await pg.text_content('.earn'), '研究ポイントの出どころ（ピルビン酸の生成）を表示')
        await shot(pg, 'A_macro')
        await pg.tap('text=回収期 ⓘ'); await pg.wait_for_timeout(200)
        ok('GAP' in await pg.text_content('#sheet-body'), '用語カードが開く')
        await pg.tap('#sheet-close')
        await pg.close()

        print('[B] 0.1 のセーブデータからの移行（実データ）')
        v1 = FIX['nadStall']
        pg = await open_page(fresh_v1('nadStall'))
        sv = await st(pg, '({ v: s.saveVersion, tp: ("tp" in s.amounts), C: MB.Sim.carbon(s), tri: s.amounts.gap + s.amounts.dhap, fbp: s.amounts.f16bp, g: s.totals.glcSupplied })')
        ok(sv['v'] == 6 and not sv['tp'], '読み込み時に最新版（v6）へ移行（tp 項目なし）')
        C1 = 6 * v1['amounts']['glc'] + 3 * v1['amounts']['tp'] + 3 * v1['amounts']['pyr'] + 6 * (sv['g'] - v1['totals']['glcSupplied'])
        ok(abs(sv['C'] - C1) < 1e-6, f"移行後も炭素が保存される（{sv['C']:.3f} = {C1:.3f}）")
        ok(abs(sv['tri'] + 2 * sv['fbp'] - v1['amounts']['tp']) < 1.0,
           f"0.1 の TP {v1['amounts']['tp']:.1f} は、三炭糖リン酸 {sv['tri']:.1f} ＋ F1,6BP {sv['fbp']:.1f}×2 に分かれた（アルドラーゼの逆反応）")
        ok(await pg.is_visible('#stall'), '0.1 で止まっていた細胞は、0.2 でも停止カードが出る')
        await pg.tap('nav.tabs button[data-tab=log]'); await pg.wait_for_timeout(150)
        ok('0.2 への移行' in await pg.text_content('#log'), '記録タブに移行による再分配の説明がある（0.2 審査 Q1）')
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(150)
        t = await pg.text_content('#stall-text')
        ok('取り戻せ' not in t and ('場合があります' in t or 'とは限りません' in t or '再開できません' in t), '停止時の説明は断定しない')
        await shot(pg, 'B_migrated')
        await pg.close()

        print('[C] 研究タブ（内部観察の条件）')
        pg = await open_page(save_v2({"glc": 50}, rp=100, totals={"pyrProduced": 100, "glcSupplied": 100}))
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        req = await pg.text_content('#upgrades-obs .upg-req')
        ok('500' in req and await pg.is_disabled('#upgrades-obs button'), f'条件を満たすまで「内部を観察する」は研究できない（{req.strip()}）')
        ok(not await pg.is_visible('#enz-head'), '酵素の研究は、内部観察の前は表示されない')
        await pg.tap('#upgrades .upg >> nth=0 >> button'); await pg.wait_for_timeout(150)
        ok('Lv 1' in await pg.text_content('#upgrades .upg >> nth=0 >> .upg-lv'), '通常の研究は購入できる')
        await pg.close()

        print('[D] 内部の解析・酵素の同定・表示切替')
        pg = await open_page(save_v2({"glc": 300}, rp=5000, levels={"glut": 2}, totals={"pyrProduced": 600, "glcSupplied": 300}))
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-obs button'); await pg.wait_for_timeout(300)
        ok(await pg.is_visible('#enz-head'), '内部の解析を研究すると、酵素の欄が現れる')
        names = await pg.eval_on_selector_all('#upgrades-enz .upg-name', 'els => els.map(e => e.textContent)')
        ok('？？？（解析中）' in names[0] and '？？？（解析中）' in names[9] and all('解析待ち' in n for n in names[1:9]),
           '最初は両端（HK・PK）だけが「解析中」、ほかは「解析待ち」。名前は伏せる')
        ok(await pg.is_disabled('#upgrades-enz .upg >> nth=1 >> button'), '解析待ちの酵素は即時同定できない')
        lab = await pg.text_content('#upgrades-enz .upg >> nth=0 >> button')
        ok('今すぐ同定する' in lab and 'RP' in lab, f'解析中の酵素に「今すぐ同定する」（{lab.strip()}）')
        for idx in [0, 9, 1, 8, 2]:            # HK → PK → PGI → ENO → PFK-1 の順に即時同定
            await pg.tap(f'#upgrades-enz .upg >> nth={idx} >> button'); await pg.wait_for_timeout(250)
        ided = await st(pg, '["hk","pk","pgi","eno","pfk"].map(k => MB.Sim.isIdentified(s, k))')
        ok(all(ided), '解析中の酵素を順に即時同定できる（HK・PK・PGI・ENO・PFK-1）')
        ok('ENZYME IDENTIFIED' in await pg.text_content('#toast'), '同定の通知「ENZYME IDENTIFIED」')
        await pg.tap('nav.tabs button[data-tab=log]'); await pg.wait_for_timeout(150)
        ok('ホスホフルクトキナーゼ-1（PFK-1）を同定した' in await pg.text_content('#log'), '記録タブに「○○を同定した」')
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(200)
        ok(await pg.is_visible('#viewswitch'), '細胞タブに表示切替が現れる')
        same = await pg.evaluate("""() => {
          const s = window.__METABOLISM_DEBUG__.state; const before = JSON.stringify(s);
          document.querySelector('#viewswitch [data-view=micro]').click();
          const mid = JSON.stringify(s);
          document.querySelector('#viewswitch [data-view=macro]').click();
          document.querySelector('#viewswitch [data-view=micro]').click();
          return before === mid && mid === JSON.stringify(s);
        }""")
        ok(same, '表示を切り替えても state は1ビットも変わらない（実ブラウザで確認）')
        p0 = await st(pg, 'MB.Sim.analysisProgress(s, "aldo")')
        await pg.wait_for_timeout(4000)
        p1 = await st(pg, 'MB.Sim.analysisProgress(s, "aldo")')
        ok(p1 > p0, f'細胞を回していると、解析中の ALDO の進捗が伸びる（{p0*100:.1f}% → {p1*100:.1f}%）')
        rows = await pg.eval_on_selector_all('#chain .enz', 'els => els.filter(e => !e.hidden).map(e => e.textContent)')
        ok(len([r for r in rows if r.strip()]) == 10, '内部表示に10の酵素の行がある（0.3 で追加した LDH の行は、NAD⁺ の再生を研究するまで表示しない）')
        ok(sum('解析中' in r for r in rows) == 2 and '解析中' in rows[3] and '解析中' in rows[7], '解析中の2つ（ALDO・PGAM）に「解析中 ○%」')
        ok(sum(r.strip().startswith(str(i + 1)) and '？？？' in r and '解析中' not in r for i, r in enumerate(rows)) == 3, '解析待ちの3つは「？？？」のみ')
        ok('ホスホフルクトキナーゼ' in rows[2] and '不可逆' in rows[2] and 'u/秒' in rows[2], 'PFK-1 の行：名前・「不可逆」・速度')
        ok('調節' in rows[0], 'HK の行に「調節」の印（実在の調節）')
        ok('Q/K' in rows[1], 'PGI の行に平衡からの距離（Q/K）')
        await shot(pg, 'D_micro')
        await pg.tap('#chain .enz >> nth=2'); await pg.wait_for_timeout(200)
        card = await pg.text_content('#sheet-body')
        ok('ΔG°′' in card and 'この版では省略' in card, 'PFK-1 のカード：ΔG°′ と、省略している調節')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(100)
        await pg.tap('#chain .enz >> nth=8'); await pg.wait_for_timeout(200)
        card = await pg.text_content('#sheet-body')
        ok('−2.8' in card and '+1.7' in card, 'エノラーゼのカード：採用値と文献値の相違')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(100)
        await pg.tap('#chain .enz >> nth=0'); await pg.wait_for_timeout(200)
        ok('グルコキナーゼ' in await pg.text_content('#sheet-body'), 'HK のカード：アイソザイム（グルコキナーゼ）の注記')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(100)
        await pg.tap('.legend .badge-anz'); await pg.wait_for_timeout(200)
        ok('解析順序はゲーム上の表現です' in await pg.text_content('#sheet-body'), '用語カード「解析と同定」に、解析順序がゲーム上の表現である旨')
        await pg.tap('#sheet-close')
        await pg.close()

        print('[D2] 0.2.1（v3）のセーブからの移行')
        fx3 = json.loads((ROOT / 'tests/fixtures/v3_saves.json').read_text(encoding='utf-8'))['someEnzymes']
        fx3['lastSaved'] = int(time.time() * 1000)
        pg = await open_page(json.dumps(fx3))
        k = await st(pg, '({ v: s.saveVersion, id: Object.keys(s.knowledge.identified).sort(), an: MB.Sim.analyzing(s) })')
        ok(k['v'] == 6 and k['id'] == ['hk', 'pfk', 'pk'] and k['an'] == ['pgi', 'eno'], f"v3 で解放済みの HK・PFK-1・PK は同定済みとして引き継がれる（解析中 {k['an']}）")
        await pg.close()

        print('[E] 停止：ATP 枯渇・回収期に回せる物質なし')
        pg = await open_page(save_v2({"glc": 50, "atp": 0, "adp": 100, "nad": 100, "nadh": 100}, rp=50))
        await pg.wait_for_timeout(800)
        t = await pg.text_content('#stall-text')
        ok('再開できません' in t, '再開できないことを正直に伝える')
        ok(not await pg.is_visible('#btn-stall-nad'), '効果のない NAD⁺ 補充ボタンは出さない')
        await pg.close()

        print('[F] 停止：NAD⁺ 枯渇（ATP は残る）')
        pg = await open_page(save_v2({"glc": 50, "atp": 60, "adp": 40, "nad": 0.5, "nadh": 199.5, "dhap": 40, "gap": 2, "f16bp": 30}, rp=5))
        await pg.wait_for_timeout(800)
        t = await pg.text_content('#stall-text')
        ok('このゲームのモデル' in t and '場合があります' in t, 'ATP 枯渇の見通しを「このゲームのモデルでの挙動」として説明し、補充の効果は断定しない')
        await shot(pg, 'F_stall_nad')
        await pg.close()

        print('[H] NAD⁺ 補充の価格（細胞ごと）と、遅くなった細胞の入れ替え')
        sv = json.loads(save_v2({"glc": 80, "nad": 20, "nadh": 180, "dhap": 30, "gap": 1, "f16bp": 20}, rp=500,
                                levels={"nadsalv": 5}, totals={"pyrProduced": 300, "glcSupplied": 200}))
        sv['saveVersion'] = 3; sv['cell'] = {"nadBought": 2, "startedAt": 0}
        pg = await open_page(json.dumps(sv))
        await pg.wait_for_timeout(800)
        ok(await pg.is_visible('#stall') and '買うたびに上がります' in await pg.text_content('#stall-text'), '回収期が遅くなると、補充の価格と細胞の入れ替えを案内する')
        await shot(pg, 'H_slow')
        lab = await pg.text_content('#btn-stall-nad')
        ok('52 RP' in lab and '3 回目' in lab, f'補充ボタンに価格と「この細胞で何回目か」（{lab}）')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(150)
        ok('この細胞で 2 回（累計 5 回）' in await pg.text_content('#upgrades'), '研究タブに「この細胞で 2 回（累計 5 回）」')
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(150)
        await pg.tap('#btn-culture'); await pg.wait_for_timeout(300)
        after = await st(pg, '({ n: s.cell.nadBought, total: s.levels.nadsalv, rp: s.rp, cost: MB.Sim.upgradeCost(s, "nadsalv") })')
        ok(after['n'] == 0 and after['total'] == 5 and after['cost'] == 20 and after['rp'] >= 499, f"新しい細胞で価格が 20 RP に戻り、累計回数と RP は保持（{after}）")
        await shot(pg, 'H_after_newcell')
        await pg.close()

        print('[G] 詳細タブと速さの表示の整合')
        pg = await open_page(save_v2({"glc": 500, "nad": 200}, levels={"pay": 2, "prep": 2}))
        await pg.wait_for_timeout(6000)
        rates = await pg.eval_on_selector_all('#flow .s-rate', 'els => els.map(e => e.textContent)')
        pay_shown = float(re.search(r'ピルビン酸 ([\d.]+) /秒', ' '.join(rates)).group(1))
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(250)
        rows = await pg.eval_on_selector_all('#res-body tr', 'els => els.map(e => e.textContent)')
        pyr_rate = float(re.search(r'\+([\d.]+)/秒', [r for r in rows if r.startswith('Pyr')][0]).group(1))
        ok(abs(pay_shown - pyr_rate) <= 0.02 + 0.03 * pyr_rate, f'回収期の「ピルビン酸 {pay_shown} /秒」＝ 詳細タブのピルビン酸の増加 {pyr_rate} /秒')
        chk = await pg.text_content('#check')
        ok(chk.count('✓') == 2 and '✗' not in chk, '保存量の検算が ✓')
        ok('K_game' in await pg.text_content('#defs'), '反応の定義に K_game')
        ok('1 u ＝ 0.1 mM' in await pg.text_content('#tab-detail') and 'ちょうど2倍' in await pg.text_content('#tab-detail'), '単位系と、速さの表示の定義')
        await shot(pg, 'G_detail', full=True)
        await pg.close()

        print('[I] 研究の効果の表示（倍率・いまの細胞・研究しなかった場合との比較）')
        pg = await open_page(save_v2({"glc": 400}, rp=500, levels={"glut": 3}, totals={"pyrProduced": 100, "glcSupplied": 300}))
        await pg.wait_for_timeout(4000)
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        cards = await pg.text_content('#upgrades')
        ok('準備期の5つの酵素の速さ ×1.0→×1.5' in cards.replace(' ', '') or '準備期の5つの酵素の速さ×1.0→×1.5' in cards.replace(' ', ''), '研究カードは倍率で表示（準備期の5つの酵素の速さ ×1.0 → ×1.5）')
        ok('グルコースの自動取り込み' in cards and '個/秒' in cards, '輸送体は「グルコースの自動取り込み ○ → ○ 個/秒」')
        now = await pg.text_content('.nowcell')
        ok('グルコース' in now and 'ピルビン酸' in now and '研究ポイント' in now, f'研究タブの上に「いまの細胞」（{now.strip()}）')
        await pg.tap('#upgrades .upg >> nth=2 >> button'); await pg.wait_for_timeout(400)   # 回収期の酵素
        t = await pg.text_content('#toast')
        ok('研究の効果（' in t and '研究しなかった場合' in t, f'買った直後に「研究しなかった場合」との比較を通知（{t.strip()[:60]}…）')
        await pg.wait_for_timeout(5000)
        ok(await pg.is_visible('#toast.show'), '長い通知は5秒たっても表示されている（読み切れる長さ）')
        await pg.tap('#toast'); await pg.wait_for_timeout(400)
        ok(not await pg.is_visible('#toast.show'), '通知はタップで閉じられる')
        await pg.tap('nav.tabs button[data-tab=log]'); await pg.wait_for_timeout(200)
        ok('研究しなかった場合' in await pg.text_content('#log'), '同じ内容が記録タブにも残る')
        await shot(pg, 'I_effect')
        await pg.close()

        # ================= 0.3 =================
        fx4 = json.loads((ROOT / 'tests/fixtures/v4_saves.json').read_text(encoding='utf-8'))
        def v4(name, **kw):
            d = json.loads(json.dumps(fx4[name])); d['lastSaved'] = int(time.time() * 1000)
            for k, v in kw.items():
                if k == 'amounts': d['amounts'].update(v)
                else: d[k] = v
            return json.dumps(d)

        print('[J] 0.2.3（v4）の実データからの移行と、嫌気的条件の表示')
        pg = await open_page(v4('allIdentified45min'))
        k = await st(pg, '({ v: s.saveVersion, rp: s.rp, n: s.levels.nadsalv, c: s.totals.cultures, id: Object.keys(s.knowledge.identified).length, lac: s.amounts.lac, ldh: s.levels.enz_ldh })')
        src = fx4['allIdentified45min']
        ok(k['v'] == 6 and k['n'] == src['levels']['nadsalv'] and k['c'] == src['totals']['cultures'] and k['id'] == 10 and k['lac'] == 0 and k['ldh'] == 0,
           f"v4 → v6：補充の累計 {k['n']} 回・細胞 {k['c']} 回・同定 {k['id']} 件を保持、乳酸 0・LDH 未同定")
        ok('ANAEROBIC' in await pg.text_content('#env'), 'ヘッダに ENV ANAEROBIC')
        await pg.tap('#env'); await pg.wait_for_timeout(200)
        body = await pg.text_content('#sheet-body')
        ok('このゲームでは、酸素を利用したミトコンドリアでのNADH再酸化を利用できない条件としてモデル化しています。' in body and '酸素がある細胞でも乳酸はつくられます' in body,
           '用語カード：嫌気的条件の補足と、乳酸は酸素存在下でもつくられること')
        await shot(pg, 'J_env_card')
        await pg.tap('#sheet-close')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        ok(await pg.is_visible('#regen-head'), '10酵素を同定済みなので、研究タブに「NAD⁺ の再生」の欄が出る')
        await pg.close()

        print('[K] 条件を満たしていないときの「NAD⁺ の再生」')
        pg = await open_page(v4('allIdentified45min', levels=dict(fx4['allIdentified45min']['levels'], nadsalv=0)))
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        req = await pg.text_content('#upgrades-regen .upg-req')
        ok('✓ 解糖系の10の酵素をすべて同定する' in req and '・ NAD⁺ を一度でも補充する' in req and await pg.is_disabled('#upgrades-regen .upg >> nth=0 >> button'),
           '条件の一覧に、満たした条件（✓）とまだの条件（・）が出る。満たすまで研究できない')
        ok('まだの条件：NAD⁺ を一度でも補充する' in await pg.text_content('#goal-hint'), '「次の目標」のヒントにも、まだの条件が出る')
        await pg.locator('#upgrades-regen').scroll_into_view_if_needed()
        await shot(pg, 'K_conditions')
        await pg.close()

        print('[L] NAD⁺ 不足の細胞で「NAD⁺ の再生」→ LDH の解析 → 同定 → NAD⁺ が戻る')
        pg = await open_page(v4('allIdentified45min', rp=3000, amounts={"nad": 3.0, "nadh": 197.0, "glc": 120, "gap": 3, "dhap": 60, "f16bp": 40, "pyr": 30, "atp": 40, "adp": 60}))
        await pg.wait_for_timeout(1200)
        ok(await pg.is_visible('#stall') and '嫌気的条件' in await pg.text_content('#stall-text') and 'まだ解放されていません' in await pg.text_content('#stall-text'),
           '停止カード：嫌気的条件で、NADH を NAD⁺ に戻す経路はまだ解放されていない')
        await shot(pg, 'L1_before_stall')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-regen .upg >> nth=0 >> button'); await pg.wait_for_timeout(300)
        t = await pg.text_content('#sheet-body')
        ok(await pg.is_visible('#sheet') and '研究開始' in await pg.text_content('#sheet-title') and 'NADH を再び NAD⁺ へ戻す反応があれば、解糖系を続けることができる' in t and '唯一の方法ではない' in t,
           '研究開始のカード：NAD⁺ は使い捨てではない／唯一の方法ではない')
        await shot(pg, 'L2_research_start')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(150)
        nm = await pg.text_content('#upgrades-regen .upg >> nth=1 >> .upg-name')
        ok('？？？（解析中）' in nm, f'LDH は名前を伏せて「解析中」（{nm}）')
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(200)
        await pg.evaluate("document.querySelector('#viewswitch [data-view=macro]').click()"); await pg.wait_for_timeout(200)
        dest = await pg.text_content('#flow')
        ok('解析中' in dest, 'ピルビン酸の行き先の箱に「解析中 ○%」')
        await pg.evaluate("document.querySelector('#viewswitch [data-view=micro]').click()"); await pg.wait_for_timeout(300)
        rows = await pg.eval_on_selector_all('#chain .enz', 'els => els.filter(e => !e.hidden).map(e => e.textContent)')
        ok(len(rows) == 11 and '分岐' in rows[10] and '解析中' in rows[10] and 'ピルビン酸の行き先' in rows[10], '内部表示：ピルビン酸の後ろに分岐の行（？？？ 解析中・ピルビン酸の行き先を解析中）')
        await pg.locator('#chain .enz.branch:not(.tr)').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await shot(pg, 'L3_micro_analyzing')
        nad0 = await st(pg, 's.amounts.nad / (s.amounts.nad + s.amounts.nadh)')
        pk0 = await st(pg, 's.flux.pk || 0')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-regen .upg >> nth=1 >> button'); await pg.wait_for_timeout(500)
        ok(await pg.is_visible('#event'), 'LDH を同定すると、全画面の強調演出が出る（通常の同定は通知だけ）')
        ev = await pg.text_content('#event')
        ok('ENZYME IDENTIFIED' in ev and 'LACTATE DEHYDROGENASE' in ev and '乳酸デヒドロゲナーゼ' in ev and 'Pyruvate + NADH' in ev and 'Lactate + NAD⁺' in ev and 'NADH を NAD⁺ へ戻す経路が見つかった。' in ev,
           '演出：ENZYME IDENTIFIED／LACTATE DEHYDROGENASE／乳酸デヒドロゲナーゼ／式／一文')
        await shot(pg, 'L4_event')
        await pg.tap('#ev-go'); await pg.wait_for_timeout(300)
        ok(await pg.is_visible('#tab-cell') and await pg.is_visible('#regen'), '「細胞の NAD⁺ を見る」で細胞タブへ。NAD⁺ の循環の表示が現れる')
        await pg.wait_for_timeout(4000)
        nad4 = await st(pg, 's.amounts.nad / (s.amounts.nad + s.amounts.nadh)')
        await pg.wait_for_timeout(16000)
        nad1 = await st(pg, 's.amounts.nad / (s.amounts.nad + s.amounts.nadh)')
        pk1 = await st(pg, 's.flux.pk || 0')
        back = float(await pg.text_content('#rg-back')); use = float(await pg.text_content('#rg-use'))
        ok(nad4 > nad0 + 0.05 and nad1 > nad0 + 0.1 and back > 0, f'演出の直後から NAD⁺ が実際に戻る（NAD⁺ の割合 {nad0*100:.1f}% → 4 秒後 {nad4*100:.1f}% → 20 秒後 {nad1*100:.1f}%）')
        ok(pk1 > 5 * max(pk0, 0.05) and abs(back - use) < 0.15 * use, f'回収期が再び進む（ピルビン酸 {pk0:.2f} → {pk1:.2f} /秒）。NAD⁺ → NADH {use} ／ NADH → NAD⁺ {back} /秒がつり合う（循環）')
        ok(not await pg.is_visible('#stall'), '停止カードが消える')
        await pg.wait_for_timeout(400)
        await shot(pg, 'L5_after_cell')
        await pg.evaluate("document.querySelector('#viewswitch [data-view=macro]').click()"); await pg.wait_for_timeout(1500)
        dest = await pg.text_content('#flow')
        ok('乳酸' in dest and 'LDH' in dest and 'NAD⁺ 再生' in dest, '全体表示：ピルビン酸 → LDH → 乳酸（NAD⁺ 再生）')
        await shot(pg, 'L6_after_macro')
        g = await st(pg, '({ tot: s.amounts.nad + s.amounts.nadh, exp: MB.Sim.expectedConservation(s).nicotinamide })')
        ok(abs(g['tot'] - g['exp']) < 1e-6, f"NAD⁺+NADH は期待値のまま（{g['tot']:.4f}）。再生であって新しくつくっていない")
        await pg.tap('#chain .enz.branch:not(.tr)', timeout=1000) if False else None
        await pg.evaluate("document.querySelector('#viewswitch [data-view=micro]').click()"); await pg.wait_for_timeout(300)
        await pg.tap('#chain .enz.branch:not(.tr)'); await pg.wait_for_timeout(200)
        card = await pg.text_content('#sheet-body')
        ok('H⁺ は一定' in card and '-25.1' in card and '合計は変わらない' in card, 'LDH のカード：ΔG°′ −25.1、H⁺ の簡略化、NAD⁺ の収支')
        await pg.tap('#sheet-close')

        print('[M] LDH を一時停止して比べる')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-regen .ldh-toggle'); await pg.wait_for_timeout(200)
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(200)
        n0 = await st(pg, 's.amounts.nad / (s.amounts.nad + s.amounts.nadh)')
        await pg.wait_for_timeout(8000)
        n1 = await st(pg, 's.amounts.nad / (s.amounts.nad + s.amounts.nadh)')
        ok(n1 < n0 and await pg.is_visible('#rg-off') and float(await pg.text_content('#rg-back')) < 0.01, f'停止すると NAD⁺ がふたたび減っていく（{n0*100:.1f}% → {n1*100:.1f}%）。「LDH 一時停止中」')
        await pg.locator('#regen').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await shot(pg, 'M_ldh_off')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-regen .ldh-toggle'); await pg.wait_for_timeout(200)
        ok(not await st(pg, '!!(s.switches && s.switches.ldhOff)'), '再開できる')
        await shot(pg, 'M_research_regen')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(250)
        chk = await pg.text_content('#check')
        ok(chk.count('✓') == 2 and '✗' not in chk and '外部からの補充' in chk, '詳細タブ：保存量の検算 ✓、外部からの補充の有無')
        ok('Lac' in ' '.join(await pg.eval_on_selector_all('#res-body tr', 'els => els.map(e => e.textContent)')), '詳細タブの物質一覧に乳酸')
        await pg.close()

        # ================= 0.4 =================
        fx5 = json.loads((ROOT / 'tests/fixtures/v5_saves.json').read_text(encoding='utf-8'))
        def v5(name, **kw):
            d = json.loads(json.dumps(fx5[name])); d['lastSaved'] = int(time.time() * 1000)
            for k2, v in kw.items(): d[k2] = v
            return json.dumps(d)

        print('[N] 0.3（v5）の実データからの移行と、乳酸の蓄積の観察')
        src5 = fx5['lactate75min']
        pg = await open_page(v5('lactate75min', rp=5000))
        k = await st(pg, '({ v: s.saveVersion, lac: s.amounts.lac, out: s.amounts.lacOut, ldh: s.levels.enz_ldh, mct: s.levels.tr_mct, acc: s.milestones.lac_accum != null })')
        ok(k['v'] == 6 and k['ldh'] == src5['levels']['enz_ldh'] and k['mct'] == 0 and k['out'] == 0 and k['lac'] > 10000,
           f"v5 → v6：LDH Lv{k['ldh']} を保持、0.3 で溜まった乳酸 {k['lac']:.0f} もそのまま、細胞外 0・MCT 未同定")
        ok(k['acc'], '読み込んだ直後に「乳酸が細胞の中にたまり続けている」が記録される（LDH が働いていて乳酸が多いため）')
        stt = await pg.text_content('#status-text')
        ok(not await pg.is_visible('#stall') and 'たまり続けている' in await pg.text_content('#lp-hint'), f'乳酸がたまっても停止や罰則はない（状態表示「{stt.strip()}」）。「乳酸の出入り」欄に「たまり続けている」')
        ok(await pg.is_visible('#lacpanel') and not await pg.is_visible('#extra') and 'まだ解放されていない' in await pg.text_content('#lp-hint'),
           '「乳酸の出入り」欄：細胞の中の乳酸と生成の速さ。出口はまだ解放されていない')
        ok('ゲーム独自の単位' in await pg.text_content('#lacpanel'), '0.4.1：「乳酸の出入り」欄に、u はゲーム独自の単位で実際の乳酸濃度ではない旨')
        await pg.tap('#lacpanel [data-term=unit]'); await pg.wait_for_timeout(200)
        ok('実際の細胞内の濃度' in await pg.text_content('#sheet-body'), '0.4.1：用語カード「量の単位 u」が開く')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(100)
        await pg.locator('#lacpanel').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await shot(pg, 'N1_lactate_accum')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        ok(await pg.is_visible('#tr-head') and '細胞膜の輸送' in await pg.text_content('#tr-head'), '研究タブに「細胞膜の輸送（輸送体）」の欄（酵素とは別）')

        print('[O] 「乳酸の行き先」→ MCT の解析 → 同定 → 細胞外への道')
        await pg.tap('#upgrades-tr .upg >> nth=0 >> button'); await pg.wait_for_timeout(300)
        ok(await pg.is_visible('#sheet') and '研究開始：乳酸の行き先' in await pg.text_content('#sheet-title'), '研究開始のカード「乳酸の行き先」')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(150)
        nm = await pg.text_content('#upgrades-tr .upg >> nth=1 >> .upg-name')
        ok('輸送体' in nm and '？？？（解析中）' in nm, f'MCT は「輸送体 ？？？（解析中）」（{nm}）')
        await pg.locator('#upgrades-tr').scroll_into_view_if_needed()
        await shot(pg, 'O1_research_transport')
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(200)
        await pg.evaluate("document.querySelector('#viewswitch [data-view=micro]').click()"); await pg.wait_for_timeout(300)
        rows = await pg.eval_on_selector_all('#chain .enz', 'els => els.filter(e => !e.hidden).map(e => e.textContent)')
        ok(len(rows) == 12 and '膜' in rows[11] and '輸送体' in rows[11] and '解析中' in rows[11] and '細胞膜を越えられるか' in rows[11], '内部表示：乳酸の後ろに「膜」の行（輸送体 ？？？ 解析中）')
        await pg.locator('#chain .enz.tr').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await shot(pg, 'O2_micro_analyzing')
        lac0 = await st(pg, 's.amounts.lac')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-tr .upg >> nth=1 >> button'); await pg.wait_for_timeout(500)
        ok(await pg.is_visible('#event-mct'), 'MCT を同定すると、全画面の演出（TRANSPORT SYSTEM UNLOCKED）')
        ev = await pg.text_content('#event-mct')
        need = ['TRANSPORT SYSTEM UNLOCKED', '細胞外への道が開かれた。', '乳酸とH⁺を細胞膜の外へ運ぶ輸送経路が成立した。', '細胞内で完結していた代謝は、外部環境との物質交換へと広がっていく。', 'EXTRACELLULAR SPACE', '細胞外環境・細胞間代謝', '今後のアップデートで解放予定']
        ok(all(t in ev for t in need) and 'どちら向きにも運ぶ' in ev, '演出の文：提案書の表示文案どおり＋「ポンプではなく、どちら向きにも運ぶ」の注記')
        await pg.wait_for_timeout(400)
        await shot(pg, 'O3_event')
        await pg.tap('#ev-go-mct'); await pg.wait_for_timeout(400)
        ok(await pg.is_visible('#tab-cell') and await pg.is_visible('#extra') and 'EXTRACELLULAR' in await pg.text_content('#extra') and '今後のアップデートで解放予定' in await pg.text_content('#extra'),
           '細胞タブに EXTRACELLULAR の領域（操作できない予告）')
        ok(await pg.locator('#extra button, #extra input').count() == 1, 'EXTRACELLULAR の領域には操作の部品がない（用語カードを開く見出しのみ）')
        await pg.wait_for_timeout(15000)
        k = await st(pg, '({ lac: s.amounts.lac, out: s.amounts.lacOut, mct: s.flux.mct, ldh: s.flux.ldh, cum: s.totals.extent.mct, clr: s.totals.extent.lac_clear })')
        txt = await pg.text_content('#lacpanel')
        ok(k['lac'] < lac0 * 0.98 and k['mct'] > 2 * k['ldh'] and k['out'] > 0 and '排出（MCT）' in txt and '累積の排出' in txt,
           f"15 秒で細胞内の乳酸 {lac0:.0f} → {k['lac']:.0f}（排出 {k['mct']:.1f} > 生成 {k['ldh']:.1f} /秒）。細胞の外 {k['out']:.0f}")
        for lab in ['細胞の中の乳酸', '生成（LDH）', '排出（MCT）', '累積の排出', '細胞のすぐ外の乳酸', '周りへ運び去られた累計']:
            if lab not in txt: ok(False, '表示がない：' + lab)
        ok(True, '§4.3：細胞内の乳酸・生成速度・排出速度・累積排出量（＋細胞外・運び去られた累計）を表示')
        await pg.locator('#lacpanel').scroll_into_view_if_needed(); await pg.wait_for_timeout(300)
        await shot(pg, 'O4_after_cell')
        await pg.evaluate("document.querySelector('#viewswitch [data-view=macro]').click()"); await pg.wait_for_timeout(1500)
        fl = await pg.text_content('#flow')
        vb = await pg.get_attribute('#flow', 'viewBox')
        ok('EXTRACELLULAR' in fl and 'MCT' in fl and '細胞膜' in fl and vb.endswith('484'), '全体図：乳酸 → MCT → 細胞膜 → EXTRACELLULAR')
        await pg.evaluate("window.scrollTo(0, 0)"); await pg.wait_for_timeout(200)
        await pg.locator('#flow').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await shot(pg, 'O5_macro')
        if SHOT:
            await pg.set_viewport_size({'width': 390, 'height': 1500}); await pg.wait_for_timeout(300)
            await pg.evaluate("window.scrollTo(0, 0)"); await pg.wait_for_timeout(200)
            await pg.screenshot(path=os.path.join(SHOT, 'O5b_macro_full.png'), clip={'x': 0, 'y': 0, 'width': 390, 'height': 1100})
            await pg.set_viewport_size({'width': 390, 'height': 844}); await pg.wait_for_timeout(200)
        await pg.evaluate("document.querySelector('#viewswitch [data-view=micro]').click()"); await pg.wait_for_timeout(300)
        await pg.tap('#chain .enz.tr'); await pg.wait_for_timeout(200)
        card = await pg.text_content('#sheet-body')
        ok('乳酸濃度と H⁺ 勾配' in card and '輸送自体は双方向性' in card, '0.4.1：MCT のカード：正味の輸送方向は乳酸濃度と H⁺ 勾配で決まる／MCT4 も輸送自体は双方向性')
        await shot(pg, 'O6_mct_card')
        ok('輸送体' in card and '酵素ではない' in card and '双方向' in card and 'ATP は使わない' in card and '1.58' in card and 'MCT4' in card and '電気的に中性' in card,
           'MCT のカード：輸送体（酵素ではない）・双方向・ATP を使わない・平衡 K 1.58・MCT4 を参考・電気的に中性')
        await pg.tap('#sheet-close')

        print('[P] MCT の一時停止と、新しい細胞での取り込み（双方向）')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-tr .ldh-toggle'); await pg.wait_for_timeout(200)
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(200)
        a0 = await st(pg, 's.amounts.lac'); await pg.wait_for_timeout(6000); a1 = await st(pg, 's.amounts.lac')
        ok(a1 > a0 and await pg.is_visible('#lp-off'), f'MCT を止めると、乳酸がふたたび細胞の中にたまる（{a0:.0f} → {a1:.0f}）')
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades-tr .ldh-toggle'); await pg.wait_for_timeout(200)
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(5000)
        out0 = await st(pg, 's.amounts.lacOut')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(200)
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.tap('#btn-culture2'); await pg.wait_for_timeout(1500)
        k = await st(pg, '({ lac: s.amounts.lac, out: s.amounts.lacOut, mct: s.flux.mct })')
        txt = await pg.text_content('#lacpanel')
        ok(k['out'] > 0 and k['mct'] < 0 and '取り込み（MCT）' in txt and '両方向' in txt,
           f"新しい細胞：細胞の外に残った乳酸（{out0:.0f} → {k['out']:.0f}）が MCT で中へ（{k['mct']:.2f} /秒）。表示も「取り込み」")
        await pg.locator('#lacpanel').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await shot(pg, 'P_newcell_import')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(250)
        chk = await pg.text_content('#check')
        ok('運び去られた乳酸の炭素' in chk and '✗' not in chk, '詳細タブ：系の外へ運び去られた乳酸の炭素を表示、保存量の検算 ✓')
        defs = await pg.text_content('#defs')
        ok('輸送の平衡 K' in defs and '1.58' in defs, '詳細タブ：MCT の輸送の平衡')
        await pg.close()

        ok(not errors, 'JavaScript エラーなし' + (f'：{errors}' if errors else ''))
        await b.close()

asyncio.run(main())
print(f'\n{fails} 件失敗' if fails else '\nすべて成功')
sys.exit(1 if fails else 0)
