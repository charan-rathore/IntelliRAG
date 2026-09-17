"""Render measured retrieval diagnostics; requires matplotlib and numpy.
Usage: python plot_results.py BEFORE_RESULTS AFTER_RESULTS
"""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent
before, after = [json.loads(Path(p).read_text()) for p in sys.argv[1:3]]
assert before['datasetHash'] == after['datasetHash']
assert before.get('distractors') == after.get('distractors') == False
old = {r['id']: r for r in before['results']}
rows = [r for r in after['results'] if r['answerable']]
labels = ['Plain BM25', 'IntelliRAG before', 'IntelliRAG after']
values = np.array([[r['bm25']['metrics']['evidenceRecall'] for r in rows],
                   [old[r['id']]['intellirag']['metrics']['evidenceRecall'] for r in rows],
                   [r['intellirag']['metrics']['evidenceRecall'] for r in rows]])
rng = np.random.default_rng(42)
resamples = rng.integers(0, len(rows), size=(10000, len(rows)))
deltas = (values[2] - values[1])[resamples].mean(axis=1)
summary = {'answerableCount': len(rows), 'unknownCount': len(after['results'])-len(rows),
  'meanEvidenceRecall': dict(zip(labels, values.mean(axis=1).tolist())),
  'completeEvidenceCount': dict(zip(labels, (values == 1).sum(axis=1).tolist())),
  'pairedAfterMinusBefore': float((values[2]-values[1]).mean()),
  'pairedBootstrap95': np.quantile(deltas,[.025,.975]).tolist(),
  'caveat': 'Exploratory first-party, single-repository diagnostic. Interval resamples questions, not repositories. Not answer accuracy; no LLM ran.',
  'before': before['at'], 'after': after['at']}
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none'})
fig, axes = plt.subplots(1,2,figsize=(12,5),gridspec_kw={'width_ratios':[1,1.5]})
colors=['#657786','#c69457','#288d84']
bars=axes[0].bar(labels,values.mean(axis=1)*100,color=colors,width=.6)
axes[0].bar_label(bars,fmt='%.1f%%',padding=5)
axes[0].set_ylim(0,110);axes[0].set_ylabel('Required evidence anchors retained (%)')
axes[0].set_title(f'Mean evidence recall · {len(rows)} answerable questions')
axes[0].tick_params(axis='x',labelrotation=18)
heat=axes[1].imshow(values.T,vmin=0,vmax=1,cmap='YlGnBu',aspect='auto')
axes[1].set_yticks(range(len(rows)),[r['id'] for r in rows],fontsize=8)
axes[1].set_xticks(range(3),labels,fontsize=9)
axes[1].set_title('Every question, including failures')
fig.colorbar(heat,ax=axes[1],shrink=.8,label='Evidence recall')
fig.suptitle('IntelliRAG repository support diagnostic · pinned p-queue README',fontsize=14)
fig.text(.02,.015,'Measured on 16 Sep 2026. Same corpus, questions and 1,400-token budget. Keyword only; no generation or dense embeddings.',fontsize=9)
fig.tight_layout(rect=[0,.05,1,.94]);fig.savefig(root/'retrieval-results.svg');fig.savefig(root/'retrieval-results.png',dpi=170);plt.close(fig)
stages=['keywordMs','rerankMs','assembleMs']
fig, ax=plt.subplots(figsize=(9,4))
for i,key in enumerate(stages):
    v=np.array([r['intellirag']['stages'][key] for r in after['results']])
    ax.scatter(np.full(len(v),i),v,alpha=.45,color=colors[i],s=25)
    ax.scatter([i],[np.median(v)],color='black',marker='_',s=220,zorder=3)
ax.set_xticks(range(3),['Keyword retrieval','Reranking','Context assembly']);ax.set_ylabel('Milliseconds, local CPU')
ax.set_title('Observed stage time · each dot is one of 20 queries')
fig.text(.02,.015,'Single pass; black line = median. Excludes network, database, embeddings and LLM. Not a production latency benchmark.',fontsize=9)
fig.tight_layout(rect=[0,.06,1,1]);fig.savefig(root/'stage-latency.svg');plt.close(fig)
print(json.dumps(summary,indent=2))
