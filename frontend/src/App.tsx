import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, executionMode } from './browser-api';
import { ResearchWorkspace } from './Workspace';
import { Guide } from './Guide';
import { UsageSettings } from './UsageSettings';
import { track, trackView, usageContext } from './telemetry';
import { bucket } from '../../telemetry/contract.mjs';
import { parseInput, validateResult, type Metadata, type Result, type Translate, type Interval } from './model';

export type View = { selected?: number; selection?: Interval; viewport?: Interval; tracks?: string[]; showEst?: boolean; scope?: string; property?: string; process?: string; query?: string; tab?: string };
export type RecordEntry = { analysis: Result; metadata: Metadata; view?: View };
const demo = 'MKKLLLALALAVASASAADPEQKSTV';
const emptyMetadata = { name: '', organism: '', accession: '' };
export function FileButton({ label, accept, onFile }: { label: string; accept: string; onFile: (file: File) => void }) {
  return <label className="file-button">{label}<input data-ux="app-input-001" type="file" accept={accept} aria-label={label} onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); e.currentTarget.value = ''; }} /></label>;
}
function errorLabel(error: unknown, t: Translate) {
  const raw = String(error).replace(/^Error:\s*/, '');
  const known: [string, string, string][] = [
    ['canonical', '標準の20種類のアミノ酸で配列を入力してください。', 'Use the 20 canonical amino acids.'],
    ['invalid amino', '配列に対応していない文字があります。標準の20種類のアミノ酸を使ってください。', 'The sequence contains unsupported amino-acid symbols.'],
    ['cleavage must', '切断位置は、配列に含まれる残基番号を整数で指定してください。', 'Cleavage must be an integer within the input.'],
    ['boundaries must', 'N/H/Cの境界は、N末端 < H末端 < SP末端の順にしてください。', 'Use N end < H end < SP end.'],
    ['SP-only input', 'SPのみの入力では、配列の末端が切断位置になります。', 'SP-only input must end at the cleavage boundary.'],
    ['maximum sequence', '配列は10,000残基以内で入力してください。', 'The maximum length is 10,000 residues.'],
    ['has_sp=false conflicts', 'SPなしの指定と、切断位置またはSPの種類が矛盾しています。', 'The no-SP annotation conflicts with the cleavage or type.'],
  ];
  const found = known.find(([fragment]) => raw.includes(fragment)); return found ? t(found[1], found[2]) : raw;
}
export function App() {
  const [lang, setLang] = useState('ja');
  const t: Translate = (ja, en) => lang === 'ja' ? ja : en;
  const [sequence, setSequence] = useState(''), [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [mode, setMode] = useState('precursor'), [cut, setCut] = useState(''), [type, setType] = useState('');
  const [hasSP, setHasSP] = useState(''), [nEnd, setNEnd] = useState(''), [hEnd, setHEnd] = useState('');
  const [estimate, setEstimate] = useState(true), [windowSize, setWindowSize] = useState(10);
  const [structure, setStructure] = useState<unknown>(null), [prediction, setPrediction] = useState<unknown>(null);
  const [record, setRecord] = useState<RecordEntry | null>(null), [history, setHistory] = useState<RecordEntry[]>([]);
  const [recordRevision, setRecordRevision] = useState(0);
  const previousView = useRef<View | undefined>(undefined);
  const currentAnalysis = useRef<Result | null>(null);
  const updateView = useCallback((view: View) => { trackView(previousView.current,view,currentAnalysis.current); previousView.current=view; setRecord(current => current ? { ...current, view } : current); }, []);
  const [editing, setEditing] = useState(true), [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false), [jobState, setJobState] = useState(''), [error, setError] = useState('');
  const [status, setStatus] = useState<boolean | null>(null), [statusChecked, setStatusChecked] = useState(false);
  const jobRef = useRef<string | null>(null), resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { let active = true; apiFetch('/api/status').then(r => { if (!r.ok) throw Error('status'); return r.json(); }).then(r => { if (active) setStatus(r.tsignal_configured === true); }).catch(() => { if (active) setStatus(null); }).finally(() => { if (active) setStatusChecked(true); }); return () => { active = false; }; }, []);
  useEffect(() => { document.documentElement.lang = lang; usageContext({lang,execution:executionMode,screen:guide?'help':editing?'input':record?.view?.tab||'sequence'}); }, [lang,editing,guide]);
  useEffect(() => { if (!editing && record) resultRef.current?.focus(); }, [recordRevision, editing]);
  useEffect(() => { track('annotation_changed','annotations',{known_cut:!!cut,estimated:estimate}); },[cut,type,hasSP,nEnd,hEnd,estimate,windowSize]);
  function remember(entry: RecordEntry) {
    const fingerprint = (r: RecordEntry) => JSON.stringify({ ...r.analysis, created_at: undefined });
    setHistory(items => [...items.filter(item => fingerprint(item) !== fingerprint(entry)), entry].slice(-8));
  }
  function restore(entry: RecordEntry) {
    const r = entry.analysis; currentAnalysis.current=r; previousView.current=undefined;
    setRecord(entry); setRecordRevision(n => n + 1); setMetadata(entry.metadata); setSequence(r.sequence); setMode(r.mode || 'precursor');
    setCut(r.annotations.cleavage.basis === 'provided' && r.mode !== 'sp' ? String(r.annotations.cleavage.value || '') : '');
    setType(r.annotations.type.basis === 'provided' ? String(r.annotations.type.value || '') : '');
    setHasSP(r.annotations.has_sp.basis === 'provided' ? r.annotations.has_sp.value ? 'yes' : 'no' : '');
    setNEnd(r.regions.basis === 'provided' ? String(r.regions.intervals?.N[1] || '') : '');
    setHEnd(r.regions.basis === 'provided' ? String(r.regions.intervals?.H[1] || '') : '');
    setEstimate(r.settings?.estimate ?? true); setWindowSize(r.settings?.mature_window || 10); setPrediction(r.prediction);
    const rows = r.profiles.filter(p => p.structure).map(p => ({ position: p.position, residue: p.residue, ...p.structure }));
    setStructure(rows.length ? rows : null); setEditing(false); setGuide(false); setError('');
  }
  function startNew() {
    setSequence(''); setMetadata(emptyMetadata); setCut(''); setType(''); setHasSP(''); setNEnd(''); setHEnd('');
    setStructure(null); setPrediction(null); setMode('precursor'); setEstimate(true); setWindowSize(10); setEditing(true); setGuide(false); setError('');
  }
  async function open(file: File, kind: string) {
    try {
      const text = await file.text();
      if (kind === 'fasta') { parseInput(text); setSequence(text); setPrediction(null); setStructure(null); const name = text.trim().startsWith('>') ? text.trim().split(/\r?\n/)[0].slice(1) : ''; if (name) setMetadata(m => ({ ...m, name })); track('import_completed','import',{kind:'fasta',outcome:'success'}); return; }
      const data = JSON.parse(text);
      if (kind === 'result') {
        const analysis = validateResult(data.analysis || data), meta = data.metadata || emptyMetadata;
        const entry = { analysis, metadata: { name: typeof meta.name === 'string' ? meta.name : '', organism: typeof meta.organism === 'string' ? meta.organism : '', accession: typeof meta.accession === 'string' ? meta.accession : '' }, view: data.view };
        restore(entry); remember(entry);
      } else if (kind === 'structure') { if (!Array.isArray(data)) throw Error(t('構造注釈は配列形式のJSONで読み込んでください。', 'Structure annotations must be a JSON array.')); setStructure(data); }
      else setPrediction(data);
      track('import_completed','import',{kind:['result','structure'].includes(kind)?kind:'prediction',outcome:'success'}); setError('');
    } catch (e) { track('import_failed','import',{kind:['fasta','result','structure'].includes(kind)?kind:'prediction',error:'validation',outcome:'failed'}); setError(errorLabel(e, t)); }
  }
  async function run(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true); const started=performance.now(); track('analysis_started','analysis',{scope:mode,bucket:bucket(sequence.replace(/^>.*$/gm,'').replace(/\s/g,'').length),known_cut:!!cut,availability:status===true?'available':status===false?'unavailable':'unknown',outcome:'requested'});
    try {
      const body = { sequence: parseInput(sequence), mode, cleavage: mode === 'sp' ? null : cut ? Number(cut) : null, sp_type: type || null,
        has_sp: hasSP === '' ? null : hasSP === 'yes', boundaries: nEnd || hEnd ? [Number(nEnd), Number(hEnd)] : null,
        estimate, mature_window: windowSize, structure, prediction };
      const response = await apiFetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json(); if (!response.ok) throw Error(value.detail); jobRef.current = value.id;
      for (;;) {
        const response = await apiFetch(`/api/jobs/${value.id}`), job = await response.json();
        if (!response.ok) throw Error(job.detail); setJobState(String(job.state));
        if (job.state === 'failed') throw Error(job.error); if (job.state === 'cancelled') { track('analysis_cancelled','analysis',{outcome:'cancelled',duration_ms:Math.min(3600000,performance.now()-started)}); break; }
        if (job.state === 'complete') {
          const analysis = validateResult(job.result); currentAnalysis.current=analysis; previousView.current=undefined; track('analysis_completed','analysis',{outcome:'success',duration_ms:Math.min(3600000,performance.now()-started),known_cut:analysis.annotations.cleavage.value!=null}); const name = metadata.name || (sequence.trim().startsWith('>') ? sequence.trim().split(/\r?\n/)[0].slice(1) : '');
          const entry = { analysis, metadata: { ...metadata, name } }; setRecord(entry); setRecordRevision(n => n + 1); remember(entry); setEditing(false); break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (e) { track('analysis_failed','analysis',{outcome:'failed',error:'unknown',duration_ms:Math.min(3600000,performance.now()-started)}); setError(errorLabel(e, t)); }
    finally { setBusy(false); setJobState(''); jobRef.current = null; }
  }
  const cleanSequence = sequence.replace(/^>.*$/gm, '').replace(/\s/g, '');
  return <>
    <header className="site-header"><a data-ux="app-a-002" className="site-brand" href="#" onClick={e => { e.preventDefault(); if (!busy) { setGuide(false); setEditing(!record); } }}><span className="brand-mark" aria-hidden="true">SP</span><span>Signal Peptide Explorer<small>{t('配列・切断点・物性の解析', 'Sequence, cleavage and property analysis')}</small></span></a><nav aria-label={t('サイトメニュー', 'Site navigation')}><button data-ux="app-button-003" className="header-link" disabled={busy} onClick={startNew}>{t('新しい解析', 'New analysis')}</button><button data-ux="app-button-004" className="header-link" disabled={busy} onClick={() => setGuide(!guide)}>{guide ? t('解析に戻る', 'Back to analysis') : t('使い方・計算方法', 'Help & methods')}</button><button data-ux="app-button-005" className="language-button" onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}>{lang === 'ja' ? 'English' : '日本語'}</button></nav></header>
    <main>{error && <div className="error page-error" role="alert">{error}</div>}
      {guide ? <div className="guide-page"><h1>{t('使い方と計算方法', 'Help & methods')}</h1><Guide t={t} /></div> : editing ? <div className="input-layout">
        <section className="input-main"><div className="page-title"><h1>{t('一配列を解析する', 'Analyze one sequence')}</h1><p>{t('前駆体配列を入力し、SP領域と切断点前後の物性を確認します。', 'Enter a precursor sequence to inspect signal-peptide and junction properties.')}</p></div>
          <form onSubmit={run} className="input-form"><fieldset disabled={busy}><label className="field-label" htmlFor="sequence-input">{t('アミノ酸配列またはFASTA', 'Amino-acid sequence or FASTA')}</label><textarea data-ux="app-textarea-006" id="sequence-input" value={sequence} onChange={e => { setSequence(e.target.value); if (prediction || structure) { setPrediction(null); setStructure(null); } }} placeholder={t('前駆体の全配列を入力してください\n>protein_name\nMKK…', 'Paste the full precursor sequence\n>protein_name\nMKK…')} spellCheck={false} required />
            <div className="input-file-row"><div className="button-group"><FileButton label={t('FASTAを読み込む', 'Upload FASTA')} accept=".fa,.fasta,.faa,.txt" onFile={f => open(f, 'fasta')} /><button data-ux="app-button-007" type="button" onClick={() => { setSequence(demo); setMetadata({ name: t('人工配列の例', 'Synthetic example'), organism: '', accession: '' }); setCut('18'); setType('Sec/SPI'); setHasSP(''); setNEnd(''); setHEnd(''); setMode('precursor'); setPrediction(null); setStructure(null); }}>{t('人工配列の例', 'Synthetic example')}</button></div><span>{cleanSequence.length ? `${cleanSequence.length} aa` : t('標準20種類のアミノ酸・最大10,000残基', '20 canonical amino acids · up to 10,000 residues')}</span></div>
            <div className="form-row"><label>{t('入力配列の範囲', 'Input scope')}<select data-ux="app-select-008" value={mode} onChange={e => { setMode(e.target.value); setCut(''); }}><option value="precursor">{t('前駆体（成熟側を含む）', 'Precursor, including mature sequence')}</option><option value="sp">{t('シグナルペプチドのみ', 'Signal peptide only')}</option></select></label><label>{t('配列名（任意）', 'Sequence name (optional)')}<input data-ux="app-input-009" value={metadata.name} maxLength={240} onChange={e => setMetadata(m => ({ ...m, name: e.target.value }))} placeholder={t('結果を識別する名前', 'A name for the result')} /></label></div>
            {mode === 'sp' && <p className="notice">{t('入力の末端をSPの終端として扱います。成熟側の＋1以降は解析に含まれません。', 'The input terminus defines the SP boundary. Mature +1 and later residues are absent.')}</p>}
            <div className={`prediction-status ${status === true ? 'available' : ''}`} role="status"><b>{t('自動注釈（TSignal）', 'Automatic annotation (TSignal)')}</b><p>{!statusChecked ? t('接続状態を確認中です。', 'Checking availability.') : status === true ? t('利用できます。未入力の切断位置とSPの種類を予測します。', 'Available. Missing cleavage and SP-type annotations are predicted.') : status === false ? t('現在は利用できません。切断位置が分かる場合は下で入力してください。未入力でも、配列全体の物性は解析できます。', 'Currently unavailable. Provide a known cleavage position below, or analyze full-sequence properties without it.') : t('接続状態を確認できません。解析時に再確認します。', 'Availability could not be checked. It will be checked again during analysis.')}</p></div>
            <details className="form-details" open={status === false || !!cut || !!type}><summary data-ux="app-summary-010">{t('切断位置・SPの注釈', 'Cleavage & SP annotations')}<span>{t('分かる項目だけ入力', 'Fill only known fields')}</span></summary><div className="form-row"><label>{t('切断位置：この残基の直後', 'Cleavage: after this residue')}<input data-ux="app-input-011" type="number" min="1" max={cleanSequence.length || 10000} value={cut} disabled={mode === 'sp'} onChange={e => setCut(e.target.value)} placeholder={mode === 'sp' ? t('入力配列の末端', 'Input terminus') : t('不明なら空欄', 'Leave blank if unknown')} /></label><label>{t('SPの種類', 'Signal-peptide type')}<select data-ux="app-select-012" value={type} onChange={e => setType(e.target.value)}><option value="">{t('不明・未指定', 'Unknown / unspecified')}</option>{['Sec/SPI', 'Sec/SPII', 'Tat/SPI', 'Tat/SPII', 'Sec/SPIV'].map(x => <option key={x}>{x}</option>)}</select></label></div><p className="muted">{t('例：18を指定すると、18番目が−1、19番目が＋1です。入力した注釈を予測より優先します。', 'For cleavage after 18, residue 18 is −1 and residue 19 is +1. Provided annotations take precedence.')}</p></details>
            <details className="form-details"><summary data-ux="app-summary-013">{t('詳細設定・外部注釈', 'Advanced settings & annotations')}</summary><div className="form-row"><label>{t('SPの有無', 'SP presence')}<select data-ux="app-select-014" value={hasSP} onChange={e => setHasSP(e.target.value)}><option value="">{t('不明・未指定', 'Unknown / unspecified')}</option><option value="yes">{t('あり', 'Present')}</option><option value="no">{t('なし', 'Absent')}</option></select></label><label>{t('成熟側の集計範囲', 'Mature N-terminal window')}<input data-ux="app-input-015" type="number" min="1" max="100" value={windowSize} onChange={e => setWindowSize(Number(e.target.value))} /><small>{t('＋1から数える残基数', 'Residues counted from +1')}</small></label></div>
              <div className="form-row"><label>{t('N領域の末端', 'N-region end')}<input data-ux="app-input-016" type="number" min="1" value={nEnd} onChange={e => setNEnd(e.target.value)} /></label><label>{t('H領域の末端', 'H-region end')}<input data-ux="app-input-017" type="number" min="1" value={hEnd} onChange={e => setHEnd(e.target.value)} /></label></div><label className="checkbox"><input data-ux="app-input-018" type="checkbox" checked={estimate} onChange={e => setEstimate(e.target.checked)} />{t('境界の入力がない場合、N/H/Cを疎水性の規則で推定する', 'Estimate missing N/H/C boundaries with a hydropathy rule')}</label><p className="muted">{t('N/H/Cの推定は探索用です。既知の境界を入力すると、その位置を使います。', 'N/H/C estimates are exploratory. Supplied boundaries are used when available.')}</p>
              <div className="button-group"><FileButton label={t('構造注釈JSONを読み込む', 'Import structure JSON')} accept=".json" onFile={f => open(f, 'structure')} /><FileButton label={t('TSignal予測JSONを読み込む', 'Import TSignal JSON')} accept=".json" onFile={f => open(f, 'prediction')} /></div>
              {structure != null && <p className="loaded-note">{t('構造注釈を読み込み済み', 'Structure annotation loaded')} <button data-ux="app-button-019" type="button" onClick={() => setStructure(null)}>{t('解除', 'Remove')}</button></p>}{prediction != null && <p className="loaded-note">{t('TSignal予測を読み込み済み', 'TSignal prediction loaded')} <button data-ux="app-button-020" type="button" onClick={() => setPrediction(null)}>{t('解除', 'Remove')}</button></p>}
              <details><summary data-ux="app-summary-021">{t('外部注釈の形式', 'Annotation file formats')}</summary><p>{t('構造注釈は、前駆体上の1始まりのposition、residue、source、basis（providedまたはmodel_prediction）を持つ行の配列です。任意でrsa、disorder（0〜1）、secondary_structure（H/E/C）を付けます。', 'Structure JSON is an array with 1-based precursor position, residue, source and basis (provided or model_prediction). Optional: rsa, disorder (0–1), secondary_structure (H/E/C).')}</p></details>
              <div className="form-row"><label>{t('生物種（任意の入力情報）', 'Organism (optional, supplied)')}<input data-ux="app-input-022" value={metadata.organism} maxLength={240} onChange={e => setMetadata(m => ({ ...m, organism: e.target.value }))} /></label><label>{t('アクセッション（任意の入力情報）', 'Accession (optional, supplied)')}<input data-ux="app-input-023" value={metadata.accession} maxLength={120} onChange={e => setMetadata(m => ({ ...m, accession: e.target.value }))} /></label></div>
            </details><div className="form-actions"><button data-ux="app-button-024" className="primary" type="submit" disabled={busy || !sequence.trim()}>{busy ? t('解析中…', 'Analyzing…') : t('解析する', 'Analyze sequence')}</button>{record && <button data-ux="app-button-025" type="button" onClick={() => restore(record)}>{t('前の結果に戻る', 'Back to previous result')}</button>}</div>
          </fieldset></form>
          {busy && <div className="job-progress" role="status"><span className="progress-indicator" aria-hidden="true" /><span>{t('解析を実行しています', 'Analysis in progress')} · {jobState || t('準備中', 'Preparing')}</span><button data-ux="app-button-026" onClick={async () => { if (jobRef.current) await apiFetch(`/api/jobs/${jobRef.current}`, { method: 'DELETE' }); }}>{t('中止', 'Cancel')}</button></div>}
        </section>
        <aside className="input-help"><h2>{t('解析の進め方', 'Workflow')}</h2><ol><li>{t('配列を入力します。＋1を調べる場合は、成熟側まで含めます。', 'Include the mature sequence to inspect +1.')}</li><li>{t('既知の切断位置があれば指定します。', 'Provide a known cleavage position if available.')}</li><li>{t('結果で領域や残基を選び、物性と根拠を確認します。', 'Select residues or intervals to inspect properties and evidence.')}</li></ol><h3>{t('確認できること', 'What you can inspect')}</h3><p>{t('SP領域の物性、切断点前後の残基、領域別のアミノ酸組成。構造注釈があれば、露出度なども併せて確認できます。', 'SP properties, junction residues and composition. Imported structural annotations add information such as exposure.')}</p><h3>{t('解釈の範囲', 'Interpretation limits')}</h3><p>{t('配列物性と、生理学的な機能の予測を区別して表示します。切断効率や分泌量の順位付けは行いません。', 'Descriptors and functional predictions have separate provenance. No efficiency or secretion-yield ranking is produced.')}</p><div className="reopen-box"><FileButton label={t('保存した解析JSONを開く', 'Open saved analysis JSON')} accept=".json" onFile={f => open(f, 'result')} /><p>{t('結果と表示範囲を復元できます。', 'Restore a result and its view settings.')}</p></div><p className="privacy-note">{executionMode === 'browser' ? t('物性の計算はブラウザー内で行います。TSignalの自動予測を使うときは、配列を予測サーバーに送ります。', 'Descriptors are calculated in your browser. TSignal prediction sends the sequence to the prediction server.') : t('解析は設定されたサーバーで実行します。TSignalは別の専用環境で動きます。', 'Analysis runs on the configured server. TSignal uses a separate inference environment.')}</p></aside>
      </div> : record && <div ref={resultRef} tabIndex={-1} className="result-root"><ResearchWorkspace key={recordRevision} record={record} history={history} t={t} onEdit={() => { restore(record); setEditing(true); }} onRestore={restore} onOpen={f => open(f, 'result')} onView={updateView} /></div>}
    </main><UsageSettings t={t} /><footer className="site-footer"><span>Signal Peptide Explorer · UI 0.5</span><div><a data-ux="app-a-027" href="https://github.com/yktsnd/signal-peptide-features" target="_blank" rel="noreferrer">{t('ソースコード', 'Source code')}</a><button data-ux="app-button-028" className="text-button" onClick={() => setGuide(true)}>{t('計算方法・尺度', 'Methods & scales')}</button></div></footer>
  </>;
}
