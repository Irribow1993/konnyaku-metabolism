"""METABOLISM 0.3 自動プレイの推移グラフ： python3 tools/plot_03.py <autoplay JSON> <出力フォルダ>"""
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
S = d['series']; T = d['before']['ldhIdentified']
def win(a, b): return [x for x in S if T + a <= x['t'] < T + b]
w = win(-900, 1200); m = lambda x: (x['t'] - T) / 60
def marks(ax):
    ax.axvline(0, color='#0b0b0b', lw=1.2); ax.text(0.15, ax.get_ylim()[1] * 0.97, 'LDH 同定', va='top', fontsize=9, color='#0b0b0b')
    for t in d['refillTimes']:
        if -900 <= t - T < 1200: ax.axvline((t - T) / 60, color='#8a8a85', lw=0.8, ls=(0, (3, 3)))
    for t in d['cellTimes']:
        if -900 <= t - T < 1200: ax.axvline((t - T) / 60, color='#8a8a85', lw=0.8, ls=(0, (1, 2)))

fig, axs = plt.subplots(4, 1, figsize=(8.5, 11), sharex=True)
ax = axs[0]
ax.plot([m(x) for x in w], [x['nad'] for x in w], color=C1, lw=2, label='NAD⁺')
ax.plot([m(x) for x in w], [x['nadh'] for x in w], color=C2, lw=2, label='NADH')
ax.set_ylabel('量（u）'); ax.set_ylim(0, None); ax.set_title('NAD⁺ と NADH（破線＝NAD⁺ 補充、点線＝新しい細胞）', loc='left', fontsize=11)
ax.legend(loc='center left', frameon=False); marks(ax)
ax = axs[1]
ax.plot([m(x) for x in w], [x['pyr'] for x in w], color=C1, lw=2, label='ピルビン酸')
ax.set_ylabel('量（u）'); ax.set_ylim(0, None); ax.set_title('ピルビン酸の量（LDH 獲得前は行き先がなく溜まる）', loc='left', fontsize=11); marks(ax)
ax = axs[2]
ax.plot([m(x) for x in w], [x['lac'] for x in w], color=C3, lw=2, label='乳酸')
ax.set_ylabel('量（u）'); ax.set_ylim(0, None); ax.set_title('乳酸の量（出口は未実装のため蓄積）', loc='left', fontsize=11); marks(ax)
ax = axs[3]
ax.plot([m(x) for x in w], [x['gapdh'] for x in w], color=C1, lw=2, label='GAPDH（NAD⁺ → NADH）')
ax.plot([m(x) for x in w], [x['pk'] for x in w], color=C2, lw=2, label='PK（ピルビン酸の生成＝解糖系の流れ）', ls=(0, (6, 2)))
ax.plot([m(x) for x in w], [x['ldh'] for x in w], color=C3, lw=2, label='LDH（NADH → NAD⁺、乳酸の生成）')
ax.set_ylabel('速さ（u/秒）'); ax.set_title('反応の速さ（定常では GAPDH ＝ PK ＝ LDH）', loc='left', fontsize=11)
ax.legend(loc='upper left', frameon=False, fontsize=9); marks(ax)
ax.set_xlabel('LDH 同定からの時間（分）')
fig.suptitle(f"LDH 獲得前後の推移（自動プレイ・方針 {d['policy']}・LDH 同定 {T//60}分{T%60:02d}秒）", x=0.02, ha='left', fontsize=12)
fig.tight_layout(); fig.savefig(os.path.join(out, f"trend_{d['policy']}.png"), dpi=150); plt.close(fig)

# 10分ごとの補充・新しい細胞
mins = d['minutes']; bins = list(range(0, mins, 10))
rf = [sum(1 for t in d['refillTimes'] if b * 60 <= t < (b + 10) * 60) for b in bins]
cl = [sum(1 for t in d['cellTimes'] if b * 60 <= t < (b + 10) * 60) for b in bins]
fig, ax = plt.subplots(figsize=(8.5, 3.6))
x = range(len(bins)); bw = 0.38
b1 = ax.bar([i - bw / 2 - 0.01 for i in x], rf, bw, color=C1, label='NAD⁺ 補充（回）')
b2 = ax.bar([i + bw / 2 + 0.01 for i in x], cl, bw, color=C2, label='新しい細胞（回）')
for bars in (b1, b2):
    for r in bars:
        if r.get_height(): ax.text(r.get_x() + r.get_width() / 2, r.get_height() + 0.08, int(r.get_height()), ha='center', fontsize=8, color='#52514e')
ax.axvline(T / 600 - 0.5, color='#0b0b0b', lw=1.2); ax.text(T / 600 - 0.45, max(rf + cl) * 0.95, 'LDH 同定', fontsize=9)
ax.set_xticks(list(x)); ax.set_xticklabels([f'{b}〜{b+10}分' for b in bins], fontsize=8.5)
ax.set_ylabel('回数'); ax.legend(frameon=False, loc='upper right'); ax.grid(axis='x', visible=False)
ax.set_title(f"10分ごとの NAD⁺ 補充と細胞の再構築（方針 {d['policy']}）", loc='left', fontsize=11)
fig.tight_layout(); fig.savefig(os.path.join(out, f"refills_{d['policy']}.png"), dpi=150); plt.close(fig)
print('ok', d['policy'])
