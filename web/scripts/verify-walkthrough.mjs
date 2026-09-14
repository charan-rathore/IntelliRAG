import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser=process.env.AGENT_BROWSER||'/Users/charanrathore/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64';
const session=process.env.BROWSER_SESSION||'intelli-story';
const url=process.env.INTELLIRAG_URL||'http://localhost:8080';
function run(...args){const r=JSON.parse(execFileSync(browser,['--session',session,'--json',...args],{encoding:'utf8',timeout:45000}));assert.equal(r.success,true,JSON.stringify(r));return r.data?.result??r.data;}
const ev=s=>run('eval',s);const wait=ms=>new Promise(r=>setTimeout(r,ms));
run('set','viewport','1440','1000');run('open',url+'/walkthrough');await wait(1500);
assert.match(ev('document.querySelector("h1").innerText'),/One issue/);
const metadata=ev('(()=>{const v=document.querySelector("video");return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error?.message}})()');
assert.ok(metadata.duration>50&&metadata.duration<70,JSON.stringify(metadata));assert.equal(metadata.width,1440);assert.equal(metadata.height,1000);assert.ok(!metadata.error);
run('click','nav[aria-label="Video chapters"] button:first-child');await wait(1200);assert.ok(ev('document.querySelector("video").currentTime')>0);
ev('document.querySelectorAll("nav button")[3].click()');await wait(500);assert.ok(ev('document.querySelector("video").currentTime')>20);
ev('document.querySelector("video").pause()');run('screenshot','/private/tmp/intelli-walkthrough-desktop.png');
run('set','viewport','390','844');run('open',url+'/walkthrough');await wait(800);assert.ok(ev('document.documentElement.scrollWidth<=innerWidth'));assert.ok(ev('[...document.querySelectorAll("nav button")].every(b=>b.getBoundingClientRect().height>=44)'));
run('screenshot','/private/tmp/intelli-walkthrough-mobile.png');
const errors=run('errors').errors||[];assert.deepEqual(errors,[]);
const result={url,metadata,playback:true,chapterSeek:true,mobileOverflow:false,touchTargets:true,errors};writeFileSync('/private/tmp/intelli-walkthrough-verification.json',JSON.stringify(result,null,2));console.log(result);
