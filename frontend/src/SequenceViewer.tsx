import React, { useState } from 'react';
import { basisLabel, focusViewport, formatValue, properties, rangeSummary, relativePosition, scales, sourceURL, trackGeometry, type Interval, type Profile, type Result, type Translate } from './model';

type Props = {
  result: Result; selected: number; selection: Interval; viewport: Interval; estimates: boolean;
  tracks: string[]; t: Translate; onSelect: (position: number, extend: boolean) => void;
  onRange: (range: Interval) => void; onViewport: (range: Interval) => void;
  onEstimates: (value: boolean) => void; onTracks: (tracks: string[]) => void;
};
export function SequenceViewer({ result, selected, selection, viewport, estimates, tracks, t, onSelect, onRange, onViewport, onEstimates, onTracks }: Props) {
  const cut = result.annotations.cleavage.value as number | null;
  const length = result.sequence.length;
  const row = result.profiles[selected - 1];
  const summary = rangeSummary(result, selection);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeError, setRangeError] = useState('');
  const intervals = result.regions.intervals;
  const rangeOptions: { key: string; label: string; range: Interval; estimated?: boolean }[] = [
    ...(cut != null ? [{ key: 'SP', label: t('SP領域', 'Signal peptide'), range: [1, cut] as Interval }] : []),
    ...Object.entries(intervals || {}).filter(() => estimates || result.regions.basis !== 'rule_estimate').map(([key, range]) => ({ key, label: `${key} ${t('領域', 'region')}`, range: range as Interval, estimated: result.regions.basis === 'rule_estimate' })),
    ...(cut != null ? [{ key: 'junction', label: t('切断点 ±6', 'Junction ±6'), range: [Math.max(1, cut - 5), Math.min(length, cut + 6)] as Interval }] : []),
    ...(cut != null && cut < length ? [{ key: 'mature', label: t('成熟側のN末端', 'Mature N-terminus'), range: [cut + 1, Math.min(length, cut + result.settings.mature_window)] as Interval }] : []),
  ];
  function setRange(event: React.FormEvent) {
    event.preventDefault();
    const a = Number(rangeStart || selection[0]), b = Number(rangeEnd || selection[1]);
    if (![a, b].every(n => Number.isInteger(n) && n >= 1 && n <= length) || a > b) {
      setRangeError(t(`1〜${length}の整数で、開始位置 ≤ 終了位置にしてください。`, `Use integers from 1 to ${length}, with start ≤ end.`)); return;
    }
    setRangeError(''); onRange([a, b]); setRangeStart(''); setRangeEnd('');
  }
  const width = viewport[1] - viewport[0] + 1;
  function pan(direction: number) {
    const start = Math.max(1, Math.min(length - width + 1, viewport[0] + direction * Math.max(1, Math.floor(width * .8))));
    onViewport([start, start + width - 1]);
  }
  const visible = result.profiles.slice(viewport[0] - 1, viewport[1]);
  const groups: Profile[][] = [];
  if (width <= 180) for (let i = 0; i < visible.length; i += 20) groups.push(visible.slice(i, i + 20));
  return <>
    <section className="panel sequence-panel" aria-labelledby="sequence-title">
      <div className="panel-heading"><div><h2 id="sequence-title">{t('配列と切断点', 'Sequence & cleavage')}</h2><p>{t('前駆体の位置は1始まり。切断点の直前は−1、直後は＋1です。', 'Precursor coordinates are 1-based. The cleavage boundary separates −1 and +1.')}</p></div>
        <label className="checkbox"><input type="checkbox" checked={estimates} onChange={e => onEstimates(e.target.checked)} />{t('規則による領域推定を表示', 'Show rule-estimated regions')}</label>
      </div>
      <div className="overview-label"><span>{t('入力配列の全体像', 'Full input overview')}</span><span>{length} aa · {t('クリックで表示位置を移動', 'Click to navigate')}</span></div>
      <svg className="overview" viewBox="0 0 1000 52" role="img" aria-label={t('全配列と表示範囲', 'Full sequence and visible interval')} onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const position = Math.round(((e.clientX - rect.left) / rect.width * 1000 - 12) / 976 * (length - 1)) + 1;
        onViewport(focusViewport([Math.max(1, Math.min(length, position)), Math.max(1, Math.min(length, position))], length));
      }}>
        <rect x="12" y="12" width="976" height="15" fill="#e9edf0" />
        {cut != null && <rect x="12" y="12" width={976 * cut / length} height="15" fill="#dce8ee" />}
        {Object.entries(intervals || {}).filter(() => estimates || result.regions.basis !== 'rule_estimate').map(([key, [a, b]]) => <rect key={key} x={12 + 976 * (a - 1) / length} y="12" width={976 * (b - a + 1) / length} height="15" className={`region-fill region-${key}`} />)}
        <rect x={12 + 976 * (viewport[0] - 1) / length} y="8" width={Math.max(2, 976 * width / length)} height="23" fill="none" stroke="#2a5876" strokeWidth="2" />
        {cut != null && <line x1={12 + 976 * cut / length} x2={12 + 976 * cut / length} y1="5" y2="32" stroke="#a74735" strokeWidth="2" />}
        <text x="12" y="46" fontSize="12">1</text><text x="988" y="46" textAnchor="end" fontSize="12">{length}</text>
      </svg>
      <div className="sequence-controls"><div className="button-group" aria-label={t('領域を選択', 'Select interval')}>
        {rangeOptions.map(option => <button key={option.key} aria-pressed={selection[0] === option.range[0] && selection[1] === option.range[1]} title={`${option.range.join('–')}${option.estimated ? ' · ' + basisLabel('rule_estimate', t) : ''}`} onClick={() => onRange(option.range)}>{option.label}{option.estimated && <span className="estimate-mark">*</span>}</button>)}
        <button onClick={() => { onRange([1, length]); onViewport([1, length]); }}>{t('全配列', 'Full input')}</button>
      </div>
      <form className="range-form" onSubmit={setRange}><label>{t('開始', 'Start')}<input aria-label={t('選択範囲の開始位置', 'Selection start')} type="number" min="1" max={length} placeholder={String(selection[0])} value={rangeStart} onChange={e => setRangeStart(e.target.value)} /></label><span>–</span><label>{t('終了', 'End')}<input aria-label={t('選択範囲の終了位置', 'Selection end')} type="number" min="1" max={length} placeholder={String(selection[1])} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} /></label><button type="submit">{t('範囲を選択', 'Select range')}</button></form></div>
      {rangeError && <p className="error" role="alert">{rangeError}</p>}
      {cut == null && <p className="notice">{result.annotations.has_sp.value === false ? t('SPなしの注釈です。配列全体の物性を表示しています。', 'Annotated as no SP. Full-sequence descriptors are shown.') : t('切断位置の情報がありません。入力注釈を追加すると、SP領域と切断点前後を確認できます。', 'Cleavage is unknown. Add an annotation to inspect SP and junction intervals.')}</p>}
      {cut === length && <p className="notice">{t('成熟側の配列が入力にありません。＋1以降は確認できません。', 'The mature sequence is absent; +1 and later positions are unavailable.')}</p>}
      {intervals && estimates && result.regions.basis === 'rule_estimate' && <p className="region-note">* {t('N/H/Cは疎水性に基づく探索的な領域推定です。TSignalの領域予測とは別の方法です。', 'N/H/C are exploratory hydropathy-based boundaries, independent of TSignal.')}</p>}
      <div className="viewport-controls"><span>{t('表示位置', 'Visible positions')}: <b>{viewport.join('–')}</b> / {length}</span><div className="button-group"><button disabled={viewport[0] === 1} onClick={() => pan(-1)} aria-label={t('前の範囲', 'Previous interval')}>←</button><button disabled={viewport[1] === length} onClick={() => pan(1)} aria-label={t('次の範囲', 'Next interval')}>→</button><button onClick={() => onViewport(focusViewport(selection, length))}>{t('選択範囲に合わせる', 'Fit selection')}</button><button onClick={() => onViewport([1, Math.min(length, 70)])}>{t('N末端へ', 'N-terminus')}</button></div></div>
      {groups.length > 0 ? <div className={`residue-view ${estimates && result.regions.basis === 'rule_estimate' ? 'estimated' : ''}`} aria-label={t('残基を選択。Shiftを押しながらクリックで範囲を選択。', 'Select a residue. Shift-click to extend the selection.')}>
        {groups.map(group => <div className="residue-row" key={group[0].position}><span className="row-coordinate">{group[0].position}</span><div className="residues">{group.map(p => {
          const rel = relativePosition(p.position, cut);
          const inRange = p.position >= selection[0] && p.position <= selection[1];
          return <button key={p.position} className={`residue region-${estimates || result.regions.basis !== 'rule_estimate' ? p.region : 'unknown'}${inRange ? ' in-range' : ''}${selected === p.position ? ' selected' : ''}${p.position === cut ? ' cleavage-edge' : ''}`} aria-pressed={selected === p.position} aria-label={`${p.position} ${p.residue}${rel != null ? ` (${rel > 0 ? '+' : ''}${rel})` : ''}`} onClick={e => onSelect(p.position, e.shiftKey)}>
            <span className="residue-position">{p.position}</span><b>{p.residue}</b><span className={`residue-relative${rel === -3 || rel === -1 || rel === 1 ? ' key-site' : ''}`}>{rel != null && Math.abs(rel) <= 6 ? `${rel > 0 ? '+' : ''}${rel}` : '·'}</span>
          </button>;
        })}</div><span className="row-coordinate end">{group.at(-1)!.position}</span></div>)}
      </div> : <p className="notice">{t('広い範囲をグラフで表示しています。残基文字を読むには、範囲を180残基以内に絞ってください。', 'Wide interval shown as tracks. Narrow to 180 residues or fewer to show residue letters.')}</p>}
      <div className="track-selector"><span>{t('物性トラック', 'Property tracks')}</span>{properties.slice(0, 6).map(key => <label className="checkbox" key={key}><input type="checkbox" checked={tracks.includes(key)} onChange={e => onTracks(e.target.checked ? [...tracks, key] : tracks.filter(k => k !== key))} />{t(scales[key].ja, scales[key].en)}</label>)}</div>
      <div id="profile-tracks">{tracks.map(key => <PropertyTrack key={key} result={result} property={key} viewport={viewport} selected={selected} selection={selection} onSelect={onSelect} t={t} />)}</div>
      {tracks.length === 0 && <p className="notice">{t('表示する物性を上のチェックボックスで選んでください。', 'Select at least one property track above.')}</p>}
      <p className="muted">{t('各残基の尺度値を表示しています。縦軸は入力配列全体を基準に固定し、移動・拡大で変わりません。クリックで残基を選択できます。', 'Tracks show raw residue coefficients. Y-axes remain fixed to the full input when navigating. Click to select a residue.')}</p>
    </section>
    <div className="inspection-grid">
      <section className="panel"><div className="panel-heading"><h2>{t('選択残基', 'Selected residue')}</h2><span className="coordinate-value">{selected} · <b>{row.residue}</b>{relativePosition(selected, cut) != null && <span> ({Number(relativePosition(selected, cut)) > 0 ? '+' : ''}{relativePosition(selected, cut)})</span>}</span></div>
        <dl className="value-list">{properties.slice(0, 6).map(key => <div key={key}><dt>{t(scales[key].ja, scales[key].en)}</dt><dd>{formatValue(row[key])}<small>{t('尺度値', 'scale units')}</small></dd></div>)}</dl>
        {row.structure ? <div className="structure-note"><h3>{t('外部の構造注釈', 'Imported structure annotation')}</h3><dl className="value-list">{Object.entries(row.structure).filter(([key]) => !['basis', 'source'].includes(key)).map(([key, value]) => <div key={key}><dt>{key === 'rsa' ? t('相対溶媒露出度', 'Relative solvent accessibility') : key === 'disorder' ? t('無秩序の注釈', 'Disorder annotation') : key === 'secondary_structure' ? t('二次構造', 'Secondary structure') : key}</dt><dd>{formatValue(value)}</dd></div>)}</dl><p>{String(row.structure.source)} · {basisLabel(String(row.structure.basis), t)}</p></div> : <p className="muted">{t('この残基の構造注釈はありません。露出度や実際の剛直性は、この配列尺度からは分かりません。', 'No structural annotation for this residue. Exposure and physical rigidity cannot be obtained from these coefficients.')}</p>}
      </section>
      <section className="panel"><div className="panel-heading"><h2>{t('選択範囲の集計', 'Selected interval summary')}</h2><span className="coordinate-value">{selection.join('–')} · {selection[1] - selection[0] + 1} aa</span></div>
        <p className="muted">{t('画面で選んだ範囲の算術平均。保存された領域別指標は「指標一覧」で確認できます。', 'Arithmetic means for the selected interval. Stored region descriptors are in Metrics.')}</p>
        <dl className="value-list">{properties.slice(0, 6).map(key => <div key={key}><dt>{t(scales[key].ja, scales[key].en)}<small>{t('平均', 'mean')}</small></dt><dd>{formatValue(summary[key])}<small>{t('尺度値', 'scale units')}</small></dd></div>)}</dl>
        <details><summary>{t('選択範囲の配列', 'Selected sequence')}</summary><code className="sequence-text">{result.sequence.slice(selection[0] - 1, selection[1])}</code></details>
      </section>
    </div>
  </>;
}

function PropertyTrack({ result, property, viewport, selected, selection, onSelect, t }: { result: Result; property: string; viewport: Interval; selected: number; selection: Interval; onSelect: Props['onSelect']; t: Translate }) {
  const scale = scales[property];
  const { values, lo, hi, x, y, points, ticks } = trackGeometry(result, property, viewport);
  const cut = result.annotations.cleavage.value as number | null;
  const a = Math.max(viewport[0], selection[0]), b = Math.min(viewport[1], selection[1]);
  const url = sourceURL(scale.code || '');
  return <div className="property-track"><div className="track-heading"><h3 style={{ color: scale.color }}>{t(scale.ja, scale.en)}</h3><span>{scale.source}{url && <> · <a href={url} target="_blank" rel="noreferrer">{scale.code}</a></>} · {t('尺度値', 'scale units')}</span><span className="track-selected">{selected} {result.sequence[selected - 1]}: <b>{formatValue(values[selected - 1])}</b></span></div><div className="mobile-axis">{t('縦軸', 'Y-axis')}: {formatValue(lo)} – {formatValue(hi)}</div>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 135" preserveAspectRatio="none" role="img" aria-label={`${t(scale.ja, scale.en)} ${viewport.join('–')}`} onClick={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const p = Math.round(viewport[0] + ((e.clientX - rect.left) / rect.width * 1000 - 58) / 918 * (viewport[1] - viewport[0]));
      onSelect(Math.max(viewport[0], Math.min(viewport[1], p)), e.shiftKey);
    }}>
      <title>{`${t(scale.ja, scale.en)} · ${scale.source} · ${t('残基位置', 'residue positions')} ${viewport.join('–')}`}</title>
      <rect width="1000" height="135" fill="white" />
      {a <= b && <rect x={Math.max(58, x(a) - 3)} width={Math.max(6, x(b) - x(a) + 6)} y="24" height="78" fill="#e8f0f5" />}
      {[lo, (hi + lo) / 2, hi].map(v => <g key={v}><line x1="58" x2="976" y1={y(v)} y2={y(v)} stroke="#e3e8ed" /><text x="48" y={y(v) + 4} textAnchor="end" fontSize="12" fill="#526273">{formatValue(v)}</text></g>)}
      {lo < 0 && hi > 0 && <line x1="58" x2="976" y1={y(0)} y2={y(0)} stroke="#b3bfc9" strokeDasharray="3 3" />}
      <polyline points={points} stroke={scale.color} strokeWidth="1.7" fill="none" />
      {cut != null && cut >= viewport[0] && cut < viewport[1] && <g><line x1={x(cut + .5)} x2={x(cut + .5)} y1="18" y2="103" stroke="#a74735" strokeDasharray="4 3" /><text x={Math.min(928, x(cut + .5) + 5)} y="15" fontSize="11" fill="#a74735">−1 │ +1</text></g>}
      {selected >= viewport[0] && selected <= viewport[1] && <circle cx={x(selected)} cy={y(values[selected - 1])} r="4" fill={scale.color} stroke="white" />}
      {ticks.map(n => <g key={n}><line x1={x(n)} x2={x(n)} y1="104" y2="108" stroke="#8092a1" /><text x={x(n)} y="124" textAnchor="middle" fontSize="12" fill="#526273">{n}</text></g>)}
    </svg><div className="mobile-ruler">{ticks.map(n => <span key={n}>{n}</span>)}</div><p className="track-note">{t(scale.note, scale.noteEn)}</p>
  </div>;
}
