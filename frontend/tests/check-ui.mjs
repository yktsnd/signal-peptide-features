import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)),'..');
const work=mkdtempSync(join(tmpdir(),'sp-gui-'));
const path=existsSync(join(root,'python'))?join(root,'python'):join(root,'src');
function run(cmd,args,env={}){const r=spawnSync(cmd,args,{stdio:'inherit',env:{...process.env,...env}});if(r.status!==0)throw Error(cmd+' failed');}
try {
run(process.env.PYTHON||'python',['-c',`from signal_peptide_features import analyze_sequence
import json, pathlib
sequence='MKKLLLALALAVASASAADPEQKSTV'
results={
'known':analyze_sequence(sequence,cleavage=18,sp_type='Sec/SPI'),
'unknown':analyze_sequence(sequence),
'sp_only':analyze_sequence(sequence[:18],mode='sp',sp_type='Sec/SPI'),
'one':analyze_sequence('M'),
'no_sp':analyze_sequence(sequence,has_sp=False),
'long':analyze_sequence('M'+'L'*9999,cleavage=18),
'structure':analyze_sequence(sequence,cleavage=18,structure=[{'position':19,'residue':'D','source':'test annotation','basis':'model_prediction','rsa':0.6,'disorder':0.2,'secondary_structure':'C'}])}
pathlib.Path(${JSON.stringify(join(work,'all.json'))}).write_text(json.dumps(results))
pathlib.Path(${JSON.stringify(join(work,'known.json'))}).write_text(json.dumps(results['known']))`],{PYTHONPATH:path});
run(process.execPath,['--experimental-strip-types','--test',join(root,'frontend/tests/model.test.mjs')],{GUI_FIXTURE:join(work,'known.json')});
await build({entryPoints:[join(root,'frontend/tests/render-smoke.tsx')],bundle:true,platform:'node',format:'cjs',outfile:join(work,'render.cjs'),logLevel:'warning'});
run(process.execPath,[join(work,'render.cjs')],{GUI_FIXTURES:join(work,'all.json')});
} finally {rmSync(work,{recursive:true,force:true});}
