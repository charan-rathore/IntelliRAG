import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8080/pilot/index.html',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
 const slides=await page.locator('.slide').count();assert.equal(slides,10);
 const overflow=await page.locator('.slide').evaluateAll(slides=>slides.map((s,i)=>({slide:i+1,overflow:s.scrollHeight>s.clientHeight+1})).filter(s=>s.overflow));assert.deepEqual(overflow,[]);
 await page.locator('#s1').screenshot({path:'/private/tmp/intelli-pilot-cover.png'});await page.locator('#s7').screenshot({path:'/private/tmp/intelli-pilot-scorecard.png'});
 await page.pdf({path:new URL('../public/pilot/intellirag-pilot.pdf',import.meta.url).pathname,printBackground:true,preferCSSPageSize:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);writeFileSync('/private/tmp/intelli-pilot-verification.json',JSON.stringify({slides,overflow,errors,mobileOverflow:false},null,2));console.log({slides,overflow,errors});
} finally {await browser.close();}
