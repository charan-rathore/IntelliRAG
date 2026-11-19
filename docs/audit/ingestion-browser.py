import json,subprocess,time
from pathlib import Path
B='/Users/charanrathore/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64'; out=Path(__file__).parent

def run(*args):
 p=subprocess.run([B,'--session','intellirag-audit','--json',*args],capture_output=True,text=True,timeout=60);r=json.loads(p.stdout)
 if not r.get('success'):raise RuntimeError(r)
 return r.get('data',{}).get('result')
run('fill','input[placeholder="Title"]','AUDIT 2026-09-09 Lyra runbook')
run('fill','textarea[placeholder="Paste markdown…"]','# AUDIT 2026-09-09 Lyra runbook\n\n## Ownership\nProject Lyra is maintained by the MENA Analytics team. The incident lead is Asha Rao.\n\n## Recovery\nWhen Lyra queue lag exceeds 90 seconds, pause new imports and run lyra recover --safe. The retry budget is exactly 7 attempts. Never delete the audit ledger.\n\n## Dependencies\nLyra writes its ledger to PostgreSQL and uses Redis only for transient cache entries. The ledger retention is 45 days.')
run('find','role','button','click','--name','Chunk & store','--exact');time.sleep(2)
run('screenshot',str(out/'ingested-lyra.png'))
(out/'ingest-paste.txt').write_text(run('eval','document.body.innerText'))
print('Pasted runbook indexed through UI',flush=True)
run('fill','input[placeholder="GitHub repo, blob, or markdown URL"]','https://github.com/charan-rathore/IntelliRAG/issues/2')
run('find','role','button','click','--name','Fetch & index','--exact')
for _ in range(55):
 text=run('eval','document.body.innerText')
 if 'Fetching' not in text and 'Fetching…' not in text and 'Fetch & index' in text:break
 time.sleep(1)
(out/'ingest-issue.txt').write_text(text)
run('screenshot',str(out/'ingested-issue.png'))
print('GitHub issue import completed; evidence saved',flush=True)
