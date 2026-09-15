import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const url=process.env.INTELLIRAG_URL||'http://localhost:8080';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
try {const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'networkidle'});
const composer=page.getByRole('textbox',{name:'Ask a question about your documents'});await composer.waitFor();const inView=async()=>{const r=await composer.boundingBox();assert.ok(r&&r.y>=0&&r.y+r.height<=page.viewportSize().height)};await inView();
assert.equal(await page.locator('aside[aria-label="Source management"]').count(),0);assert.equal(await page.locator('aside[aria-label="Retrieval diagnostics"]').count(),0);
assert.equal(await page.locator('[data-tour="tour-graph"]').count(),1);assert.ok(await page.locator('[data-tour="tour-graph"] svg g[role="button"]').count()>6);assert.ok(await page.locator('[data-tour="tour-graph"] svg line').count()>0);
await page.getByRole('button',{name:'Sources',exact:true}).click();await page.getByRole('button',{name:'Evidence',exact:true}).click();assert.ok(await page.locator('aside[aria-label="Source management"]').isVisible());assert.ok(await page.locator('aside[aria-label="Retrieval diagnostics"]').isVisible());await inView();await composer.fill('Does this source support my question?');await page.screenshot({path:'/private/tmp/intelli-restored-workspace.png'});
await page.getByRole('button',{name:'Sources',exact:true}).click();await page.getByRole('button',{name:'Evidence',exact:true}).click();await inView();
await page.setViewportSize({width:390,height:844});await inView();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'Sources',exact:true}).click();assert.ok(await page.getByRole('dialog',{name:'Sources'}).isVisible());await page.getByRole('button',{name:'Close dialog'}).click();await inView();await page.screenshot({path:'/private/tmp/intelli-restored-mobile.png'});assert.deepEqual(errors,[]);const result={url,composerAlwaysVisible:true,sideToggles:true,landingGraphWithEdges:true,mobileDialog:true,mobileOverflow:false,errors};writeFileSync('/private/tmp/intelli-workspace-verification.json',JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close()}
