"""Bar chart of the learning eval (runs/clean and runs/distractors). Usage: python plot.py"""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root = Path(__file__).resolve().parent
GREEN, GRAY, INK, MUTED = '#2f6f45', '#c4bfb1', '#1c1c19', '#6b6b63'
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False, 'axes.spines.bottom': False, 'svg.fonttype': 'none', 'font.family': 'DejaVu Sans'})
fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.6), sharey=True)
for ax, name in zip(axes, ['clean', 'distractors']):
    d = json.loads((root / 'runs' / name / 'results.json').read_text())
    arms = d['arms']
    labels = [a['arm'].replace('… ', '+ ') for a in arms]
    held = [a['heldOutWordings'] * 100 for a in arms]
    orig = [a['originals'] * 100 for a in arms]
    y = range(len(arms))
    ax.barh([i + 0.2 for i in y], held, 0.38, color=GREEN, label='reworded questions it never saw')
    ax.barh([i - 0.2 for i in y], orig, 0.38, color=GRAY, label='the questions people rated')
    for i, (h, o) in enumerate(zip(held, orig)):
        ax.text(h + 1, i + 0.2, f'{h:.1f}%', va='center', fontsize=8.5, color='#2f6f45')
        ax.text(o + 1, i - 0.2, f'{o:.1f}%', va='center', fontsize=8.5, color='#55554e')
    ax.set_yticks(list(y), labels); ax.invert_yaxis(); ax.set_xlim(0, 100); ax.set_xticks([]); ax.tick_params(axis='y', length=0)
    ax.set_title('Clean corpus' if name == 'clean' else 'With distractor documents')
fig.legend(*axes[0].get_legend_handles_labels(), frameon=False, loc='lower right', ncol=2, fontsize=9)
fig.text(0.02, 0.95, 'Rating answers teaches it: unseen rewordings 50% → 55% answered, rated questions 71% → 81%.', fontsize=13, weight='bold', color=INK)
fig.text(0.02, 0.905, '14 questions, each reworded 3 ways. Learn from some wordings, test on the others (3 folds). Keyword only, no model.', fontsize=10, color=MUTED)
fig.text(0.01, 0.01, 'Keyword only, no model. Refusals stayed 3/6 in every arm. Data: eval/learning/runs.', fontsize=8.5)
fig.tight_layout(rect=(0, 0.04, 1, 0.88)); fig.savefig(root / 'learning.svg')
