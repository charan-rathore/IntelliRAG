"""Charts for the README from the current frozen runs (clean and with distractors).
Usage: python plot_current.py RUN_DIR  (expects RUN_DIR and RUN_DIR-distractors)"""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent
run = Path(sys.argv[1])
clean = json.loads((run / 'results.json').read_text())
noisy = json.loads(Path(str(run) + '-distractors').joinpath('results.json').read_text())
assert clean['datasetHash'] == noisy['datasetHash']
arms = [('bm25', 'Plain BM25', '#9a9a8f'), ('intellirag', 'IntelliRAG (default)', '#2f6f45'), ('intelliragCoveragePacking', 'IntelliRAG, coverage packing', '#c69457')]
rows = lambda d: [r for r in d['results'] if r['answerable']]
recall = lambda d, a: np.array([r[a]['metrics']['evidenceRecall'] for r in rows(d)])
refused = lambda d: sum(1 for r in d['results'] if not r['answerable'] and not r['intellirag']['ids'])

GREEN, GRAY, INK, MUTED = '#2f6f45', '#c4bfb1', '#1c1c19', '#6b6b63'
plt.rcParams.update({'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False, 'axes.spines.left': False,
                     'svg.fonttype': 'none', 'font.family': 'DejaVu Sans', 'axes.edgecolor': '#d9d6cc', 'xtick.color': MUTED, 'ytick.color': INK})

b_clean, i_clean = recall(clean, 'bm25').mean() * 100, recall(clean, 'intellirag').mean() * 100
b_noisy, i_noisy = recall(noisy, 'bm25').mean() * 100, recall(noisy, 'intellirag').mean() * 100
fig = plt.figure(figsize=(14, 6.8))
fig.text(0.03, 0.94, f'Add unrelated documents and plain search loses evidence. IntelliRAG keeps it: {i_noisy:.0f}% vs {b_noisy:.0f}%.', fontsize=15, weight='bold', color=INK)
fig.text(0.03, 0.895, f'Share of the evidence each answer needs that actually reached it. {len(rows(clean))} questions about the p-queue README, same 1,400-token budget, no model.', fontsize=11, color=MUTED)
ax = fig.add_axes([0.04, 0.12, 0.24, 0.64])
groups = ['README only', 'README + 3 unrelated docs']
for k, (b, i) in enumerate([(b_clean, i_clean), (b_noisy, i_noisy)]):
    ax.bar(k - 0.18, b, 0.34, color=GRAY); ax.bar(k + 0.18, i, 0.34, color=GREEN)
    ax.text(k - 0.18, b + 2, f'{b:.0f}%', ha='center', color=MUTED, fontsize=12)
    ax.text(k + 0.18, i + 2, f'{i:.0f}%', ha='center', color=GREEN, fontsize=13, weight='bold')
ax.set_xticks([0, 1], ['README\nonly', 'README + 3\nunrelated docs']); ax.set_yticks([]); ax.set_ylim(0, 105)
ax.legend(handles=[plt.Rectangle((0, 0), 1, 1, color=GRAY), plt.Rectangle((0, 0), 1, 1, color=GREEN)], labels=['Plain keyword search (BM25)', 'IntelliRAG'], frameon=False, loc='lower left', bbox_to_anchor=(0, 1.0), ncol=1, fontsize=10)

ax2 = fig.add_axes([0.62, 0.12, 0.36, 0.7])
qs = rows(noisy)
b, i = recall(noisy, 'bm25') * 100, recall(noisy, 'intellirag') * 100
order = np.argsort(i - b)
for y, k in enumerate(order):
    ax2.plot([b[k], i[k]], [y, y], color='#e2ded2', lw=3, zorder=1)
    ax2.scatter(b[k], y, s=70, color=GRAY, zorder=2); ax2.scatter(i[k], y, s=90, color=GREEN, zorder=3)
q_labels = [r.get('question', r['id'])[:58] + ('…' if len(r.get('question', r['id'])) > 58 else '') for r in qs]
ax2.set_yticks(range(len(qs)), [q_labels[k] for k in order], fontsize=9)
ax2.set_xlim(-5, 105); ax2.set_xticks([0, 50, 100], ['none', 'half', 'all']); ax2.set_xlabel('Evidence that reached the answer, with the unrelated docs added', color=MUTED)
ax2.grid(axis='x', color='#eeebe2'); ax2.tick_params(axis='y', length=0)
ax2.set_title('Question by question. Grey: plain search. Green: IntelliRAG. One dot: both the same.', fontsize=11, color=INK, loc='left')
fig.text(0.03, 0.015, f"Measured {clean['at'][:10]} from frozen runs in eval/repo-support/runs. It also refused {refused(clean)} of 5 questions the README can't answer.", fontsize=9, color=MUTED)
fig.savefig(root / 'retrieval-results.svg')

stages = [('keywordMs', 'Find matching passages'), ('rerankMs', 'Rank them'), ('assembleMs', 'Pack the context')]
fig, ax = plt.subplots(figsize=(11, 4.2))
meds = []
for k, (key, label) in enumerate(stages):
    vals = [r['intellirag']['stages'].get(key, 0) for r in clean['results'] if r['intellirag'].get('stages')]
    meds.append(np.median(vals))
    ax.barh(k, np.median(vals), color=GREEN, height=0.5)
    ax.text(np.median(vals) + 0.08, k, f'{np.median(vals):.1f} ms', va='center', fontsize=11, color=INK)
ax.set_yticks(range(3), [s[1] for s in stages]); ax.invert_yaxis(); ax.set_xticks([])
fig.text(0.02, 0.93, f'Search takes about {sum(meds):.0f} ms per question, before any model runs.', fontsize=14, weight='bold', color=INK)
fig.text(0.02, 0.86, f"Median of {len(clean['results'])} questions on a laptop CPU. Network, database, embeddings and the model are not included.", fontsize=10, color=MUTED)
fig.subplots_adjust(left=0.2, top=0.78, bottom=0.08)
fig.savefig(root / 'stage-latency.svg')
print('ok')
