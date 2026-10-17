"""METABOLISM v0.1.0 公開前チェック（実ブラウザ・ヘッドレス Chromium）

    python3 dev/tools/serve.py 8787 &      # Cloudflare Pages と同じヘッダー（CSP など）を付けて配信
    python3 dev/tests/release_check.py http://127.0.0.1:8787/ [スクリーンショット保存先]

?debug なしの「公開時の画面」で、初回起動・遊び方・保存と読み込み・不在時進行・細胞の再構築・
保存できない環境・壊れたセーブ・外部通信の有無・画面サイズごとの表示を確認する。
state は読まず、画面と localStorage（セーブ）だけを見る。
"""
import asyncio, json, os, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
KEY = 'metabolism.save.v1'
fails = 0
def ok(c, m):
    global fails
    print(('  ✔ ' if c else '  ✘ ') + m)
    if not c: fails += 1

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errors, foreign = [], []
        async def ctx_page(vp=(390, 844), touch=True, init=None, scale=2):
            ctx = await b.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=scale, has_touch=touch, is_mobile=touch and vp[0] < 900)
            if init: await ctx.add_init_script(init)
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
            pg.on('request', lambda r: foreign.append(r.url) if not r.url.startswith(BASE) and not r.url.startswith('data:') else None)
            return ctx, pg
        async def shot(pg, name, full=False):
            if SHOT: await pg.screenshot(path=os.path.join(SHOT, name + '.png'), full_page=full)
        async def saved(pg):
            return await pg.evaluate(f"() => JSON.parse(localStorage.getItem('{KEY}') || 'null')")

        print('[R1] 初回起動（公開時の画面）')
        ctx, pg = await ctx_page()
        await pg.goto(BASE); await pg.wait_for_timeout(900)
        ok(await pg.title() == 'METABOLISM — 代謝のインクリメンタルゲーム' and (await pg.text_content('#ver')).strip() == 'v0.1.0', 'タイトルとバージョン v0.1.0')
        ok(await pg.is_visible('#sheet') and '遊び方' in await pg.text_content('#sheet-title'), '初回は「遊び方」が自動で開く')
        body = await pg.text_content('#sheet-body')
        ok(all(k in body for k in ['グルコースを入れる', '研究ポイント', '次の目標', '新しい細胞で再開', '保存', '単純化']), '遊び方：基本の操作・タブ・保存・単純化への案内')
        await shot(pg, 'R1_intro')
        await pg.tap('#sheet-close'); await pg.wait_for_timeout(200)
        ok(await pg.evaluate('typeof window.__METABOLISM_DEBUG__') == 'undefined', '開発者向けの窓口（__METABOLISM_DEBUG__）は公開時の画面にない')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(200)
        ok(not await pg.is_visible('#dbg-line') and '計算の健全性' not in await pg.text_content('#tab-detail'), '計算の健全性（開発者向けの表示）は出ない')
        for t in ['howto', 'simplify', 'saveinfo']:
            await pg.tap(f'.about-actions [data-term={t}]'); await pg.wait_for_timeout(150)
            ok(await pg.is_visible('#sheet'), f'詳細タブ「このゲームについて」から {t} が開く')
            await pg.tap('#sheet-close'); await pg.wait_for_timeout(100)
        cr = await pg.text_content('#credits')
        ok('こんにゃくお爺さん' in cr and 'GNU General Public License v3.0' in cr and 'CC BY-NC-SA 4.0' in cr and 'Claude' in cr, '詳細タブに作者・制作・ライセンス（GPL-3.0／CC BY-NC-SA 4.0）')
        r = await pg.request.get(BASE + 'LICENSE.txt')
        ok(r.status == 200 and 'GNU GENERAL PUBLIC LICENSE' in await r.text(), 'LICENSE.txt（GPL-3.0 の全文）が配信される')

        await shot(pg, 'R1_detail_about')
        await pg.tap('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(150)
        await pg.tap('#btn-help'); await pg.wait_for_timeout(150)
        ok(await pg.is_visible('#sheet') and '遊び方' in await pg.text_content('#sheet-title'), 'ヘッダの「?」で遊び方がいつでも開く')
        await pg.tap('#sheet-close')

        print('[R2] 遊ぶ → 自動保存 → 読み込み直し')
        for _ in range(4): await pg.tap('#btn-glc'); await pg.wait_for_timeout(120)
        await pg.wait_for_timeout(11500)                         # 自動保存（約10秒ごと）
        s1 = await saved(pg)
        ok(s1 is not None and s1['saveVersion'] == 6 and s1['totals']['glcSupplied'] >= 40 and s1['t'] > 8, f"約10秒で自動保存される（v{s1 and s1['saveVersion']}・経過 {s1 and round(s1['t'])} 秒・グルコース {s1 and s1['totals']['glcSupplied']}）")
        await pg.reload(); await pg.wait_for_timeout(900)
        ok(not await pg.is_visible('#sheet'), '2回目からは遊び方は自動で開かない')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(150)
        await pg.tap('#btn-save'); await pg.wait_for_timeout(200)
        ok('保存しました' in await pg.text_content('#toast'), '「今すぐ保存」で保存できる')
        s2 = await saved(pg)
        ok(s2['t'] >= s1['t'] and s2['totals']['glcSupplied'] == s1['totals']['glcSupplied'] and s2['rp'] >= s1['rp'], f"読み込み直しても続きから（経過 {round(s1['t'])} → {round(s2['t'])} 秒、RP {s1['rp']:.1f} → {s2['rp']:.1f}）")

        print('[R3] 研究の購入と細胞の再構築（公開時の画面で）')
        d = json.loads(json.dumps(s2)); d['rp'] = 500; d['lastSaved'] = int(time.time() * 1000)
        await pg.evaluate(f"localStorage.setItem('{KEY}', {json.dumps(json.dumps(d))})"); await pg.reload(); await pg.wait_for_timeout(800)
        await pg.tap('nav.tabs button[data-tab=research]'); await pg.wait_for_timeout(200)
        await pg.tap('#upgrades .upg >> nth=0 >> button'); await pg.wait_for_timeout(300)
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(150)
        pg.once('dialog', lambda dl: asyncio.ensure_future(dl.accept()))
        await pg.tap('#btn-culture2'); await pg.wait_for_timeout(600)
        ok(await pg.is_visible('#tab-cell'), '「新しい細胞で再開」（確認つき）のあと、細胞タブに戻る')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(150)
        await pg.tap('#btn-save'); await pg.wait_for_timeout(200)
        s3 = await saved(pg)
        ok(s3['levels']['glut'] == 1 and s3['totals']['cultures'] == (s2['totals'].get('cultures', 0) + 1) and s3['amounts']['pyr'] < 5 and s3['cell']['nadBought'] == 0 and s3['rp'] < 500,
           f"研究（輸送体 Lv{s3['levels']['glut']}）が保存され、新しい細胞で物質が初期化（ピルビン酸 {s3['amounts']['pyr']:.2f}）、再構築 {s3['totals']['cultures']} 回")
        await ctx.close()

        print('[R4] 不在時の進行')
        d = json.loads(json.dumps(s3)); d['lastSaved'] = int(time.time() * 1000) - 3600 * 1000; d['amounts']['glc'] = 300
        ctx, pg = await ctx_page(init=f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('{KEY}', {json.dumps(json.dumps(d))}); sessionStorage.setItem('seeded','1'); }}")
        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        ok('留守のあいだの 1:00:00 を進めました' in await pg.text_content('#toast'), '1時間ぶりに開くと「留守のあいだの 1:00:00 を進めました」')
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(150); await pg.tap('#btn-save'); await pg.wait_for_timeout(200)
        s4 = await saved(pg)
        ok(s4['t'] - d['t'] >= 3599 and s4['totals']['pyrProduced'] > d['totals']['pyrProduced'], f"経過 +{round(s4['t'] - d['t'])} 秒、ピルビン酸 +{s4['totals']['pyrProduced'] - d['totals']['pyrProduced']:.0f}")
        pg.once('dialog', lambda dl: asyncio.ensure_future(dl.accept()))
        await pg.tap('#btn-wipe'); await pg.wait_for_timeout(500)
        s5 = await saved(pg)
        ok((s5 is None or s5['t'] < 5) and '最初からになりました' in await pg.text_content('#toast'), '「すべて最初から」で消える（確認のダイアログつき）')
        await ctx.close()

        print('[R5] 壊れたセーブ・保存できない環境')
        ctx, pg = await ctx_page(init=f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('{KEY}', '{{broken json'); sessionStorage.setItem('seeded','1'); }}")
        n0 = len(errors)
        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        ok(len(errors) == n0 and await pg.is_visible('#btn-glc') and '0' in await pg.text_content('#hud-rp'), '壊れたセーブでもエラーにならず、最初から始まる')
        await ctx.close()
        ctx, pg = await ctx_page(init="Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; Storage.prototype.getItem = function () { throw new Error('SecurityError'); };")
        n0 = len(errors)
        await pg.goto(BASE); await pg.wait_for_timeout(800)
        if await pg.is_visible('#sheet'): await pg.tap('#sheet-close'); await pg.wait_for_timeout(150)   # 保存できないので、遊び方は毎回出る
        await pg.tap('#btn-glc'); await pg.wait_for_timeout(3000)
        await pg.tap('nav.tabs button[data-tab=detail]'); await pg.wait_for_timeout(150); await pg.tap('#btn-save'); await pg.wait_for_timeout(200)
        ok(len(errors) == n0 and 'この環境では保存できません' in await pg.text_content('#toast'), '保存できない環境（プライベートブラウズ等）でも遊べ、「この環境では保存できません」と知らせる')
        await ctx.close()

        print('[R6] 画面サイズ（スマートフォン・タブレット・PC）')
        sizes = [('phone_390x844', (390, 844), True), ('phone_small_360x640', (360, 640), True), ('phone_landscape_844x390', (844, 390), True),
                 ('tablet_768x1024', (768, 1024), True), ('pc_1280x800', (1280, 800), False), ('pc_1920x1080', (1920, 1080), False)]
        fx = json.loads((Path(__file__).parent / 'fixtures/v6_saves.json').read_text(encoding='utf-8'))['afterMct65min']
        fx['lastSaved'] = int(time.time() * 1000)
        for name, vp, touch in sizes:
            ctx, pg = await ctx_page(vp=vp, touch=touch, scale=1 if not touch else 2,
                                     init=f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('{KEY}', {json.dumps(json.dumps(fx))}); sessionStorage.setItem('seeded','1'); }}")
            await pg.goto(BASE); await pg.wait_for_timeout(1000)
            m = await pg.evaluate("""() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
              bar: document.querySelector('.bar').getBoundingClientRect().height, pill: document.querySelector('#rp-pill').getBoundingClientRect(),
              tabs: document.querySelector('nav.tabs').getBoundingClientRect(), feed: document.querySelector('#btn-glc').getBoundingClientRect(),
              minBtn: Math.min(...[...document.querySelectorAll('nav.tabs button, #btn-glc')].map(e => e.getBoundingClientRect().height)) })""")
            ok(m['sw'] <= m['iw'] and m['bar'] <= 52 and m['pill']['height'] <= 36 and m['pill']['right'] <= m['iw'] and m['tabs']['bottom'] <= vp[1] + 1 and m['minBtn'] >= 40,
               f"{name}：横にはみ出さない（幅 {m['sw']}/{m['iw']}）、ヘッダ1行（{m['bar']:.0f}px・研究ポイントの表示 {m['pill']['height']:.0f}px）、下のタブと投与ボタンが画面内・押しやすい高さ（{m['minBtn']:.0f}px）")
            await shot(pg, 'R6_' + name)
            for t in ['research', 'detail']:
                await pg.click(f'nav.tabs button[data-tab={t}]'); await pg.wait_for_timeout(250)
                sw = await pg.evaluate('document.documentElement.scrollWidth')
                if sw > vp[0]: ok(False, f'{name}：{t} タブで横にはみ出す（{sw}）')
            if name == 'pc_1280x800':
                await pg.click('nav.tabs button[data-tab=cell]'); await pg.wait_for_timeout(200)
                await pg.click('#btn-glc'); await pg.wait_for_timeout(200)
                await pg.click('#chain .enz.on >> nth=0') if await pg.is_visible('#chain') else await pg.click('#flow [data-term=pyr]')
                await pg.wait_for_timeout(200)
                ok(await pg.is_visible('#sheet'), 'PC：マウスのクリックで操作でき、説明カードが開く')
                await pg.keyboard.press('Tab'); await pg.wait_for_timeout(100)
                ok(await pg.evaluate('document.activeElement && document.activeElement.tagName') in ('BUTTON', 'A'), 'PC：Tab キーでボタンに移動できる（操作部品はすべて button 要素）')
            await ctx.close()

        print('[R7] 外部通信・エラー')
        ok(not foreign, '外部への通信が1件もない（読み込むのは自サイトのファイルだけ）' + (f'：{foreign[:5]}' if foreign else ''))
        ok(not errors, 'JavaScript エラー・CSP 違反なし' + (f'：{errors[:5]}' if errors else ''))
        await b.close()

asyncio.run(main())
print(f'\n{fails} 件失敗' if fails else '\nすべて成功')
sys.exit(1 if fails else 0)
