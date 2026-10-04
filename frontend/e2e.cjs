/* Browser regression checks run in CI against the packaged native backend. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const folder=await mkdtemp(join(tmpdir(),'sp-explorer-e2e-'));
 const server=spawn(process.env.PYTHON||'python',['-m','uvicorn','signal_peptide_features.server:app','--host','127.0.0.1','--port','18765'],{env:{...process.env,SP_FEATURES_CONFIG:join(folder,'absent.json')}});
 let browser;
 try{
  let ready=false;
  for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:18765/api/status')).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100))}
  assert(ready,'backend did not start');
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18765');
  await page.getByRole('button',{name:'人工配列の例',exact:true}).click();
  await page.getByRole('button',{name:'解析する',exact:true}).click();
  await page.getByRole('heading',{name:'配列と切断点',exact:true}).waitFor();
  assert.match(await page.locator('.inspection-grid .coordinate-value').first().textContent(),/19.*D.*\+1/);
  await page.getByRole('spinbutton',{name:'選択範囲の開始位置',exact:true}).fill('16');
  await page.getByRole('spinbutton',{name:'選択範囲の終了位置',exact:true}).fill('20');
  await page.getByRole('button',{name:'範囲を選択',exact:true}).click();
  assert.match(await page.locator('.inspection-grid .coordinate-value').last().textContent(),/16–20/);
  async function download(name,file){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const value=await pending;await value.saveAs(join(folder,file));}
  await download('解析を保存','analysis.json');
  const saved=JSON.parse(await readFile(join(folder,'analysis.json'),'utf8'));
  assert.deepEqual(saved.view.selection,[16,20]);assert.equal(saved.view.selected,19);assert.equal(saved.analysis.annotations.cleavage.value,18);
  await page.getByRole('button',{name:'指標を探す',exact:true}).click();
  await page.getByRole('button',{name:'切断部位への接近 · 柔軟性参照値',exact:true}).click();
  await page.getByRole('heading',{name:'領域別の指標',exact:true}).waitFor();
  assert.equal(await page.locator('.metric-filters select').nth(1).inputValue(),'flexibility');
  const rows=await page.locator('.metrics-table tbody tr').count();
  assert.equal(parseInt(await page.locator('.filter-status>span').textContent()),rows);
  await page.getByRole('button',{name:'配列・切断点',exact:true}).click();
  assert.equal(await page.locator('.property-track').count(),3);
  assert(await page.getByRole('checkbox',{name:'疎水性',exact:true}).isChecked());
  await page.getByRole('button',{name:'指標一覧',exact:true}).click();
  await page.getByRole('button',{name:'絞り込みを解除',exact:true}).click();
  await page.getByRole('checkbox',{name:'規則で推定した領域を含む',exact:true}).uncheck();
  assert.equal(await page.locator('.metrics-table .basis-tag.rule_estimate').count(),0);
  await page.getByRole('checkbox',{name:'規則で推定した領域を含む',exact:true}).check();
  await page.locator('.metric-filters select').first().selectOption('SP');
  await page.locator('.metrics-table .interval-link').first().click();
  assert.match(await page.locator('.inspection-grid .coordinate-value').last().textContent(),/1–18/);
  await page.getByLabel('保存した解析JSONを開く',{exact:true}).setInputFiles(join(folder,'analysis.json'));
  await page.waitForFunction(()=>document.querySelectorAll('.inspection-grid .coordinate-value')[1]?.textContent.includes('16–20'));
  assert.match(await page.locator('.inspection-grid .coordinate-value').last().textContent(),/16–20/);
  await page.locator('.export-menu summary').click();
  await download('全指標 · CSV','metrics.csv');await download('表示中の物性図 · SVG','figure.svg');await download('解析レポート · HTML','report.html');
  assert.match(await readFile(join(folder,'metrics.csv'),'utf8'),/boundary_basis/);
  const svg=await readFile(join(folder,'figure.svg'),'utf8');assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.match(svg,/−1 │ \+1/);
  const report=await browser.newPage();await report.goto('file://'+join(folder,'report.html'));
  assert.equal(await report.locator('table').last().locator('tbody tr').count(),saved.analysis.metrics.length);await report.close();
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('heading',{name:'Sequence & cleavage',exact:true}).waitFor();
  await page.getByRole('button',{name:'日本語',exact:true}).click();
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.setViewportSize({width:320,height:740});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.pdf({path:join(folder,'view.pdf')});assert((await readFile(join(folder,'view.pdf'))).length>1000);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: range selection, independent filters/tracks, exact counts, provenance, saved-view restoration, exports, report, JA/EN, 390/320px width and PDF.');
 }finally{if(browser)await browser.close();server.kill();await rm(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
