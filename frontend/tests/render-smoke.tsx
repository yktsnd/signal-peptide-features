import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { App } from '../src/App';
import { ResearchWorkspace } from '../src/Workspace';
const fixtures=JSON.parse(readFileSync(process.env.GUI_FIXTURES!,'utf8'));
const t=(ja:string,en:string)=>ja;
let count=0;
function render(analysis:any,view:any={},name='検証配列'){
 const record={analysis,metadata:{name,organism:'',accession:''},view};
 const html=renderToStaticMarkup(<ResearchWorkspace record={record} history={[record]} t={t} onEdit={()=>{}} onRestore={()=>{}} onOpen={()=>{}}/>);
 assert(!/NaN|Infinity/.test(html)); count++; return html;
}
const input=renderToStaticMarkup(<App/>);assert.match(input,/シグナルペプチドの特徴を調べる/);assert(!input.includes('SEQUENCE → CONTEXT → INSIGHT'));assert(!input.includes('カード'));
const known=render(fixtures.known);assert.match(known,/19 · <b>D<\/b>/);assert(known.includes('(+1)'));assert.equal((known.match(/class="property-track"/g)||[]).length,3);
assert(known.includes('sequence-map') && known.indexOf('sequence-map')<known.indexOf('tracks-panel'));assert(known.includes('result-outcome'));assert(known.includes('sequenceviewer-button-plus1'));
const metric=render(fixtures.known,{tab:'metrics',scope:'SP'});assert.match(metric,/割合（0–1）/);assert.match(metric,/値は配列から計算/);assert(!metric.includes('class="property-track"'));
const all=render(fixtures.known,{tab:'metrics',scope:''});assert(all.includes('251 / 251'));
const index=render(fixtures.known,{tab:'index'});assert.match(index,/分類の索引/);assert(!index.includes('関連する記述指標の数'));
const evidence=render(fixtures.known,{tab:'evidence'});assert.match(evidence,/実装SHA256/);assert.match(evidence,/peptides.py/);assert.match(evidence,/KYTJ820101/);
const hidden=render(fixtures.known,{showEst:false});assert(!hidden.includes('class="residue region-N'));assert(!hidden.includes('class="region-fill region-N'));
for(const key of ['unknown','sp_only','no_sp','one','structure']) {const html=render(fixtures[key]);if(key==='unknown'||key==='sp_only'||key==='no_sp')assert(!html.includes('sequenceviewer-button-plus1'));}
const long=render(fixtures.long);assert((long.match(/class="residue /g)||[]).length<=180);
const wide=render(fixtures.long,{viewport:[1,10000],selection:[1,10000]});assert(!wide.includes('class="residue '));assert.match(wide,/残基が読める大きさに拡大/);
const safe=render(fixtures.known,{},'<script>alert(1)</script>');assert(safe.includes('&lt;script&gt;'));assert(!safe.includes('<script>alert(1)</script>'));
const fallback=render(fixtures.known,{viewport:[-1,99999],selection:[20,1],selected:9999});assert.match(fallback,/19 · <b>D<\/b>/);
console.log(`Server-render checks passed: input and ${count} result states, all tabs, missing annotations, structural annotations, 10,000 residues, restoration and escaping.`);
