"""METABOLISM 0.4 自動プレイの推移グラフ： python3 tools/plot_04.py <autoplay_04 JSON> <出力フォルダ>"""
import json, sys, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
for f in font_manager.findSystemFonts():
    if 'NotoSansCJK-Regular' in f: font_manager.fontManager.addfont(f)
plt.rcParams.update({'font.family': ['Noto Sans CJK JP', 'DejaVu Sans'], 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.edgecolor': '#8a8a85', 'axes.labelcolor': '#52514e', 'xtick.color': '#52514e', 'ytick.color': '#52514e',
                     'axes.grid': True, 'grid.color': '#e6e5e0', 'grid.linewidth': 0.8, 'figure.facecolor': '#fcfcfb', 'axes.facecolor': '#fcfcfb'})
C1, C2, C3 = '#2a78d6', '#eb6834', '#1baf7a'          # 検証済みの基準パレット（分類色・明るい面）
d = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
T = d['mctIdentified']; L = d['ldhIdentified']
w = [x for x in d['series'] if L - 120 <= x['t'] < T + 1500]; m = lambda x: (x['t'] - T) / 60
def marks(ax):
    ax.axvline(0, color='#0b0b0b', lw=1.2); ax.text(0.2, ax.get_ylim()[1] * 0.96, 'MCT 同定', va='top', fontsize=9)
    ax.axvline((L - T) / 60, color='#8a8a85', lw=0.9, ls=(0, (3, 3))); ax.text((L - T) / 60 + 0.2, ax.get_ylim()[1] * 0.96, 'LDH 同定', va='top', fontsize=9, color='#52514e')
    if d.get('lacAccumObserved'): ax.axvline((d['lacAccumObserved'] - T) / 60, color='#8a8a85', lw=0.9, ls=(0, (1, 2)))
    if d.get('balance'): ax.axvline((d['balance'] - T) / 60, color='#8a8a85', lw=0.9, ls=(0, (1, 2)))
fig, axs = plt.subplots(3, 1, figsize=(8.5, 9.5), sharex=True)
ax = axs[0]
ax.plot([m(x) for x in w], [x['lac'] for x in w], color=C1, lw=2, label='細胞の中の乳酸')
ax.plot([m(x) for x in w], [x['lacOut'] for x in w], color=C2, lw=2, label='細胞のすぐ外の乳酸')
ax.set_ylabel('量（u）'); ax.set_ylim(0, None); ax.legend(loc='center left', frameon=False)
ax.set_title('乳酸の量（点線＝「たまり続けている」の観察／つり合いの到達）', loc='left', fontsize=11); marks(ax)
ax = axs[1]
ax.plot([m(x) for x in w], [x['ldh'] for x in w], color=C1, lw=2, label='生成（LDH）')
ax.plot([m(x) for x in w], [x['mct'] for x in w], color=C2, lw=2, label='排出（MCT。負なら取り込み）')
ax.plot([m(x) for x in w], [x['clr'] for x in w], color=C3, lw=2, ls=(0, (6, 2)), label='周りへ運び去られる')
ax.set_ylabel('速さ（u/秒）'); ax.legend(loc='upper right', frameon=False, fontsize=9)
ax.set_title('乳酸の出入りの速さ（同定直後は、たまっていた乳酸が一気に出ていく）', loc='left', fontsize=11); marks(ax)
ax = axs[2]
ax.plot([m(x) for x in w], [x['nadFrac'] * 100 for x in w], color=C1, lw=2, label='NAD⁺ の割合（%）')
ax.plot([m(x) for x in w], [x['ldhQK'] * 100 for x in w], color=C2, lw=2, label='LDH の Q/K（×100。1 に近いほど平衡に近い）')
ax.set_ylim(0, 105); ax.legend(loc='center right', frameon=False, fontsize=9)
ax.set_title('解糖系・NAD⁺ の循環への影響（NAD⁺ は保たれ、LDH は平衡から遠ざかる）', loc='left', fontsize=11); marks(ax)
ax.set_xlabel('MCT 同定からの時間（分）')
fig.suptitle(f"MCT 獲得前後の推移（自動プレイ・方針 {d['policy']}・MCT 同定 {T//60}分{T%60:02d}秒）", x=0.02, ha='left', fontsize=12)
fig.tight_layout(); fig.savefig(os.path.join(out, f"mct_trend_{d['policy']}.png"), dpi=150); plt.close(fig)
print('ok', d['policy'])
