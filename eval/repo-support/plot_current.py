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

plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False, 'svg.fonttype': 'none', 'font.family': 'DejaVu Sans'})
fig, axes = plt.subplots(1, 2, figsize=(12.5, 5.2), gridspec_kw={'width_ratios': [1, 1.25]})
x = np.arange(2); w = 0.26
for i, (a, label, c) in enumerate(arms):
    vals = [recall(clean, a).mean() * 100, recall(noisy, a).mean() * 100]
    b = axes[0].bar(x + (i - 1) * w, vals, w, color=c, label=label)
    axes[0].bar_label(b, fmt='%.1f%%', padding=3, fontsize=9)
axes[0].set_xticks(x, ['Clean corpus', '+ distractor documents'])
axes[0].set_ylim(0, 105); axes[0].set_ylabel('Required evidence that reached the answer (%)')
axes[0].set_title(f'{len(rows(clean))} answerable questions, same 1,400-token budget')
axes[0].legend(frameon=False, loc='lower left', fontsize=9)

ids = [r['id'] for r in rows(noisy)]
grid = np.array([recall(noisy, 'bm25'), recall(noisy, 'intellirag')]).T
axes[1].imshow(grid, vmin=0, vmax=1, cmap='YlGn', aspect='auto')
axes[1].set_yticks(range(len(ids)), ids, fontsize=9); axes[1].set_xticks([0, 1], ['Plain BM25', 'IntelliRAG'])
for (i, j), v in np.ndenumerate(grid):
    axes[1].text(j, i, f'{v:.0%}', ha='center', va='center', fontsize=8, color='white' if v > 0.6 else '#1c1c19')
axes[1].set_title('Every question with distractors, including failures')
fig.suptitle('Repository-support evidence recall · pinned p-queue README', fontsize=13)
fig.text(0.01, 0.01, f"Measured {clean['at'][:10]}. Keyword only, no model. IntelliRAG refused {refused(clean)}/5 unanswerable questions (clean) and {refused(noisy)}/5 (distractors).", fontsize=8.5)
fig.tight_layout(rect=(0, 0.04, 1, 0.95))
fig.savefig(root / 'retrieval-results.svg'); fig.savefig(root / 'retrieval-results.png', dpi=110)

stages = [('keywordMs', 'Keyword retrieval', '#9a9a8f'), ('rerankMs', 'Reranking', '#c69457'), ('assembleMs', 'Context assembly', '#2f6f45')]
fig, ax = plt.subplots(figsize=(10, 4.2))
for i, (k, label, c) in enumerate(stages):
    vals = [r['intellirag']['stages'].get(k, 0) for r in clean['results'] if r['intellirag'].get('stages')]
    ax.scatter(np.full(len(vals), i) + np.random.default_rng(i).uniform(-0.08, 0.08, len(vals)), vals, color=c, alpha=0.55)
    ax.hlines(np.median(vals), i - 0.18, i + 0.18, color='#1c1c19', linewidth=2)
ax.set_xticks(range(3), [s[1] for s in stages]); ax.set_ylabel('Milliseconds, local CPU')
ax.set_title(f"Observed stage time · each dot is one of {len(clean['results'])} queries")
fig.text(0.01, 0.01, f"Measured {clean['at'][:10]}, single pass; black line = median. Excludes network, database, embeddings and LLM.", fontsize=8.5)
fig.tight_layout(rect=(0, 0.05, 1, 1)); fig.savefig(root / 'stage-latency.svg')
print('ok')
