import json, subprocess, time
from pathlib import Path
B='/Users/charanrathore/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64'
OUT=Path(__file__).parent

def browser(*args):
    p=subprocess.run([B,'--session','intellirag-audit','--json',*args],capture_output=True,text=True,timeout=40)
    r=json.loads(p.stdout)
    if not r.get('success'): raise RuntimeError(r.get('error'))
    return r.get('data',{})
def ev(js): return browser('eval',js).get('result')
ev('''window.__audit=[]; const oldFetch=window.fetch.bind(window); window.fetch=async(...args)=>{ const r=await oldFetch(...args); if(String(args[0]).includes('/api/query')) r.clone().text().then(t=>window.__audit.push(t)); return r; }; true''')
cases=json.loads((OUT/'golden.json').read_text())
questions=[g['question'] for g in cases['gold']]+cases['adversarial']
questions += ['How do you stop a Redis cache stampede?', 'How do you stop a Redis cache stampede?', 'Should I not use Redis for a cache stampede?', 'What does the Redis guide say about quantum elephants?', 'Which runbooks discuss retry and backoff?', 'What is the incident commander password?']
results=[]
for i,q in enumerate(questions):
    before=ev('window.__audit.length')
    browser('fill','[data-tour="tour-composer"] textarea',q)
    browser('press','Enter')
    end=time.time()+35
    while time.time()<end:
        if ev('window.__audit.length')>before: break
        time.sleep(.4)
    raw=ev('window.__audit.at(-1)') if ev('window.__audit.length')>before else ''
    events=[]
    for line in (raw or '').splitlines():
        if line.startswith('data: '):
            try: events.append(json.loads(line[6:]))
            except ValueError: pass
    done=next((e for e in events if e.get('type')=='done'),{})
    sources=next((e for e in events if e.get('type')=='sources'),{})
    results.append({'question':q,'done':done,'sources':sources,'errors':[e for e in events if e.get('type')=='error']})
    (OUT/'live-queries.json').write_text(json.dumps(results,indent=2))
    print(json.dumps({'case':i+1,'question':q,'model':done.get('model'),'coverage':done.get('coverage'),'refused':done.get('refused'),'cacheHit':done.get('cacheHit'),'sources':[c['slug'] for c in sources.get('chunks',[])]}),flush=True)
    if i in [0,7,len(questions)-1]: browser('screenshot',str(OUT/f'query-{i+1}.png'))
print('Completed visible browser cases:',len(results),flush=True)
