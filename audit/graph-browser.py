import json, subprocess, sys
from pathlib import Path
B='/Users/charanrathore/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64'
base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8080'
session=sys.argv[2] if len(sys.argv)>2 else 'graph-verified'
def run(*args):
 p=subprocess.run([B,'--session',session,'--json',*args],capture_output=True,text=True,timeout=60)
 r=json.loads(p.stdout)
 if not r.get('success'): raise RuntimeError(r)
 d=r.get('data',{}); return d.get('result',d)
def ev(js): return run('eval',js)
def click(name): return run('find','role','button','click','--name',name,'--exact')
run('set','viewport','1440','1000');run('open',base);ev('localStorage.removeItem("intellirag.graph-edits.v1")');run('reload');run('wait','1200')
run('find','label','Find a source or term','fill','Redis')
click('Expand graph ↗'); click('Redis Cache Stampede and TTL Guide, document')
r={'base':base,'sourceVisible':ev('document.querySelector("[data-tour=tour-graph]").innerText.includes("redis-cache.md")')}
run('find','label','Display label','fill','Redis review workspace');click('Save label')
r['labelSaved']=ev('JSON.parse(localStorage.getItem("intellirag.graph-edits.v1")).labels.some(n=>n.label==="Redis review workspace")')
run('select','[data-tour=tour-graph] form select','doc:postgres-indexes')
run('find','label','Connection label','fill','review alongside');click('Save connection')
r['edgeSaved']=ev('document.querySelector("[data-tour=tour-graph]").innerText.includes("review alongside · user_edited")')
ev('document.querySelector("[data-tour=tour-graph]").scrollTop=0');run('screenshot',str(Path(__file__).parent/(session+'-desktop.png')))
run('reload');run('wait','1200');run('find','label','Find a source or term','fill','Redis review workspace');click('Expand graph ↗')
r['survivesReload']=ev('document.querySelector("[data-tour=tour-graph]").innerText.includes("Redis review workspace")')
click('Close explorer');run('set','viewport','390','844');click('Trace');click('Expand graph ↗')
r['noMobileOverflow']=ev('document.documentElement.scrollWidth<=innerWidth')
run('screenshot',str(Path(__file__).parent/(session+'-mobile.png')))
click('Reset my edits');r['resetSaved']=ev('JSON.parse(localStorage.getItem("intellirag.graph-edits.v1")).edges.length===0')
r['browserErrors']=run('errors').get('errors',[])
Path(__file__).with_name(session+'-results.json').write_text(json.dumps(r,indent=2))
print(json.dumps(r,indent=2))
assert all(r[k] for k in ['sourceVisible','labelSaved','edgeSaved','survivesReload','noMobileOverflow','resetSaved']) and not r['browserErrors']
