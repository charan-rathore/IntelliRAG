import subprocess,json,time,sys
from pathlib import Path
B='/Users/charanrathore/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64'
def run(*args):
 p=subprocess.run([B,'--session','intellirag-production','--json',*args],capture_output=True,text=True,timeout=45);r=json.loads(p.stdout)
 if not r.get('success'):raise RuntimeError(r)
 return r.get('data',{}).get('result')
run('open','https://intellirag-live-own-track.vercel.app/')
run('fill','input[placeholder="GitHub repo, blob, or markdown URL"]','https://github.com/brianc/node-postgres/issues/3745')
run('find','role','button','click','--name','Fetch & index','--exact')
for _ in range(45):
 if run('eval','document.querySelector("select")?.value')=='url:github.com/brianc/node-postgres/issues/3745':break
 time.sleep(.5)
assert run('eval','document.querySelector("select")?.value')=='url:github.com/brianc/node-postgres/issues/3745'
print('Upstream issue imported and selected on final Vercel deployment',flush=True)
subprocess.run([sys.executable,'audit/issue-tests.py','intellirag-production','node-postgres'],check=True)
