export type Metric = {
  id: string; value: number | string; property: string; scope: string; range: number[];
  basis: string; boundary_basis: string | null; definition: string; source: string;
  unit: string; source_verification: string; label_ja: string; processes: string[];
};
export type Profile = {
  position: number; residue: string; relative: number | null; region: string;
  structure?: Record<string, unknown>; [key: string]: unknown;
};
export type Result = {
  mode: string; settings: { estimate: boolean; mature_window: number }; schema_version: string;
  sequence: string; sequence_sha256: string; created_at?: string;
  software?: { name: string; version: string; implementation_sha256: string };
  execution?: string;
  annotations: Record<string, { value: unknown; basis: string; method?: string }>;
  regions: { intervals: Record<string, number[]> | null; basis: string; method: string | null };
  metrics: Metric[]; profiles: Profile[]; warnings: string[]; prediction: unknown;
  matrix: { processes: Record<string, string>; relations: Record<string, string[]> };
  references?: { source: string; sha256: string; retrieved: string; tables: string[] };
};
export type Interval = [number, number];
export type Metadata = { name: string; organism: string; accession: string };
export type Translate = (ja: string, en: string) => string;
export const properties = ['hydrophobicity', 'charge', 'polarity', 'volume', 'helix', 'flexibility', 'identity', 'composition'];
export const scales: Record<string, { ja: string; en: string; source: string; code?: string; color: string; note: string; noteEn: string }> = {
  hydrophobicity: { ja: '疎水性', en: 'Hydropathy', source: 'Kyte–Doolittle', code: 'KYTJ820101', color: '#25628b', note: '各残基の疎水性尺度。膜通過の確率を表す値ではありません。', noteEn: 'Residue hydropathy coefficients; not a translocation probability.' },
  charge: { ja: '電荷の簡易指標', en: 'Charge proxy', source: 'K + R − D − E', color: '#865329', note: 'K・Rは＋1、D・Eは−1、その他は0。pHや末端の電荷は含みません。', noteEn: 'K/R: +1, D/E: −1, others: 0. Excludes pH and terminal charges.' },
  polarity: { ja: '極性', en: 'Polarity', source: 'Grantham', code: 'GRAR740102', color: '#4d6a60', note: '残基の極性尺度。溶媒への露出度は別の構造注釈で確認します。', noteEn: 'Residue polarity coefficients. Exposure requires separate structural annotations.' },
  volume: { ja: '残基体積尺度', en: 'Residue volume scale', source: 'Grantham', code: 'GRAR740103', color: '#716239', note: '原著の残基体積尺度。立体構造中の空間占有を直接測定する値ではありません。', noteEn: 'The source residue-volume scale; not a measurement of spatial occupancy in a structure.' },
  helix: { ja: 'ヘリックス形成傾向', en: 'Helix propensity', source: 'Chou–Fasman', code: 'CHOP780201', color: '#755c83', note: '残基ごとの参照尺度。配列の二次構造予測とは区別して扱います。', noteEn: 'Residue reference coefficients; distinct from a sequence secondary-structure prediction.' },
  flexibility: { ja: '柔軟性参照値', en: 'Flexibility reference', source: 'Vihinen', code: 'VINM940101', color: '#397e78', note: '残基ごとの柔軟性参照尺度。＋1の実際の剛直性や露出度には構造情報が必要です。', noteEn: 'Residue flexibility coefficients. Actual +1 rigidity and exposure require structural information.' },
  identity: { ja: '残基の種類', en: 'Residue identity', source: 'Sequence', color: '#444', note: '', noteEn: '' },
  composition: { ja: 'アミノ酸組成', en: 'Composition', source: 'Sequence', color: '#444', note: '', noteEn: '' },
};
export function sourceURL(source: string): string | null {
  const code = source.match(/KYTJ820101|CHOP780201|GRAR740102|GRAR740103|VINM940101/)?.[0];
  return code ? `https://www.genome.jp/entry/aaindex:${code}` : null;
}
export function basisLabel(key: string | null | undefined, t: Translate) {
  const labels: Record<string, [string, string]> = {
    sequence: ['配列から計算', 'Sequence calculation'], provided: ['入力注釈', 'Provided annotation'],
    model_prediction: ['モデル予測', 'Model prediction'], rule_estimate: ['規則による領域推定', 'Rule-estimated region'],
    missing: ['情報なし', 'Unavailable'],
  };
  return labels[key || 'missing'] ? t(...labels[key || 'missing']) : key;
}
export function scopeLabel(scope: string, t: Translate) {
  const labels: Record<string, [string, string]> = {
    whole: ['入力配列全体', 'Full input'], SP: ['SP領域', 'Signal peptide'], N: ['N領域', 'N-region'],
    H: ['H領域', 'H-region'], C: ['C領域', 'C-region'], junction_SP: ['切断点の前6残基以内', 'Up to 6 residues before cleavage'],
    mature_N: ['成熟側のN末端', 'Mature N-terminus'], junction: ['切断点の前後', 'Cleavage junction'], structure: ['外部の構造注釈', 'Imported structure annotation'],
  };
  return labels[scope] ? t(...labels[scope]) : scope;
}
export function metricUnit(m: Metric, t: Translate) {
  if (m.id.endsWith('.length')) return t('残基', 'residues');
  if (m.id.includes('.fraction_') || ['rsa', 'disorder'].includes(m.property)) return t('割合（0–1）', 'fraction (0–1)');
  if (m.id.endsWith('.entropy')) return 'bits';
  if (m.property === 'identity') return m.id.endsWith('.identity') ? t('残基', 'residue') : t('該当 1／非該当 0', 'yes 1 / no 0');
  if (m.id.endsWith('.charge_sum')) return t('残基数の差', 'count difference');
  if (m.property === 'secondary_structure') return 'H / E / C';
  return t('尺度値', 'scale units');
}
export function metricDefinition(m: Metric, t: Translate) {
  if (m.id.endsWith('.length')) return t('指定範囲に含まれる残基数。', m.definition);
  if (m.id.includes('.fraction_')) return t(`${m.id.split('.fraction_')[1]}に該当する残基数を、範囲の残基数で割った割合。`, m.definition);
  if (m.id.endsWith('.charge_sum')) return t('範囲内のKとRの数からDとEの数を引いた値。pHや末端を含む正味電荷とは異なります。', m.definition);
  if (m.id.endsWith('.entropy')) return t('残基の割合から計算したShannonエントロピー。組成の多様さを表します。', m.definition);
  if (m.id.endsWith('.hydrophobic_moment')) return t('1残基あたり100度の仮想的なヘリックスにKD尺度を配置し、ベクトル和の大きさを残基数で割った値。実際のヘリックス構造を確認した値ではありません。', m.definition);
  if (m.scope === 'structure') return t('外部から読み込んだ構造注釈。元の構造状態と予測方法に依存します。', m.definition);
  if (m.id.endsWith('.identity')) return t('切断点からの相対位置にある残基。SP末端は−1、成熟側の先頭は＋1です。', m.definition);
  if (m.id === 'junction.small_neutral') return t('−3と−1の両方がA・G・S・Cに含まれる場合に1。Sec/SPIに対する記述的な規則で、切断確率を表す値ではありません。', m.definition);
  return t('指定範囲の残基尺度を足し、残基数で割った平均値。', m.definition);
}
export function warningLabel(w: string, t: Translate) {
  const messages: Record<string, string> = {
    'Sequence coefficients do not measure cleavage efficiency, secretion yield, or physical rigidity.': '配列の参照尺度から、切断効率・分泌量・実際の剛直性を直接求めることはできません。',
    'Matrix links are exploratory interpretations, not validated physiological scores.': '生理学的な分類は指標を探すための索引です。関連の強さや機能の予測値は示していません。',
    'Mature-side residues are unavailable; +1 and exposure cannot be inferred.': '成熟側の配列が入力にないため、＋1の残基とその周辺は確認できません。',
    'SP endpoint is unknown; SP, N/H/C and junction metrics are unavailable.': '切断位置が不明のため、SP領域と切断点前後の集計はありません。配列全体の物性は確認できます。',
    'Supplied SP annotation conflicts with predicted no-SP; input retained.': '入力注釈とTSignalのSPなし予測が食い違います。入力注釈を優先しています。',
  };
  if (w.startsWith('Supplied ') && w.includes('differs')) return t('入力注釈とTSignalの予測が食い違います。入力を優先し、元の予測も記録しています。', w);
  if (w.startsWith('Predicted ') && w.includes('suppressed')) return t('SPなしという入力を優先し、予測の切断点・種類を解析から除いています。', w);
  return t(messages[w] || w, w);
}
export function parseInput(text: string) {
  const cleaned = text.trim();
  if (!cleaned.startsWith('>')) return cleaned;
  if (cleaned.split(/\r?\n/).filter(line => line.startsWith('>')).length !== 1) throw Error('一度に解析できるのは一配列です。複数配列は、一つずつ解析して比較してください。');
  return cleaned.split(/\r?\n/).slice(1).join('');
}
export function validateResult(r: Result): Result {
  if (r?.schema_version !== '1.0' || !/^[ACDEFGHIKLMNPQRSTVWY]{1,10000}$/.test(r.sequence) ||
      !Array.isArray(r.profiles) || r.profiles.length !== r.sequence.length || !Array.isArray(r.metrics) ||
      !r.annotations?.cleavage || !r.annotations?.type || !r.annotations?.has_sp || !r.regions || !r.matrix?.processes || !r.matrix?.relations ||
      !Array.isArray(r.warnings) || r.warnings.some(w => typeof w !== 'string') || !/^[a-f0-9]{64}$/.test(r.sequence_sha256) ||
      !r.settings || !Number.isInteger(r.settings.mature_window) || r.settings.mature_window < 1 || r.settings.mature_window > 100) throw Error('解析ファイルの形式が対応していません。');
  if (r.profiles.some((p, i) => p.position !== i + 1 || p.residue !== r.sequence[i] || properties.slice(0, 6).some(key => typeof p[key] !== 'number' || !Number.isFinite(p[key]))) ||
      r.metrics.some(m => typeof m.id !== 'string' || typeof m.source !== 'string' || !Array.isArray(m.processes) ||
        typeof m.definition !== 'string' || typeof m.label_ja !== 'string' || typeof m.scope !== 'string' || typeof m.property !== 'string' ||
        !['number', 'string'].includes(typeof m.value) || (typeof m.value === 'number' && !Number.isFinite(m.value)) ||
        !Array.isArray(m.range) || m.range.length !== 2 || m.range[0] > m.range[1] || m.range.some(n => !Number.isInteger(n) || n < 1 || n > r.sequence.length))) throw Error('解析ファイルの残基位置が配列と一致しません。');
  const cut = r.annotations.cleavage.value;
  if (cut != null && (!Number.isInteger(cut) || Number(cut) < 1 || Number(cut) > r.sequence.length)) throw Error('解析ファイルの切断位置が範囲外です。');
  for (const interval of Object.values(r.regions.intervals || {})) if (!Array.isArray(interval) || interval.length !== 2 || interval[0] > interval[1] || interval.some(n => !Number.isInteger(n) || n < 1 || n > r.sequence.length)) throw Error('解析ファイルの領域位置が範囲外です。');
  return r;
}
export function relativePosition(position: number, cut: number | null) {
  return cut == null ? null : position <= cut ? position - cut - 1 : position - cut;
}
export function clampInterval(a: number, b: number, length: number): Interval {
  return [Math.max(1, Math.min(length, Math.min(a, b))), Math.max(1, Math.min(length, Math.max(a, b)))];
}
export function focusViewport(interval: Interval, length: number): Interval {
  const width = Math.min(length, Math.max(40, interval[1] - interval[0] + 13));
  const left = Math.max(1, Math.min(length - width + 1, Math.floor((interval[0] + interval[1] - width + 1) / 2)));
  return [left, left + width - 1];
}
export function filterMetrics(result: Result, filters: { scope: string; property: string; process: string; query: string; estimates: boolean }) {
  const q = filters.query.trim().toLowerCase();
  return result.metrics.filter(m => (filters.estimates || (m.basis !== 'rule_estimate' && m.boundary_basis !== 'rule_estimate')) &&
    (!filters.scope || m.scope === filters.scope) && (!filters.property || m.property === filters.property) &&
    (!filters.process || m.processes.includes(filters.process)) &&
    (!q || `${m.id} ${m.label_ja} ${m.source} ${m.definition}`.toLowerCase().includes(q)));
}
export function rangeSummary(result: Result, interval: Interval) {
  const rows = result.profiles.slice(interval[0] - 1, interval[1]);
  return Object.fromEntries(properties.slice(0, 6).map(key => [key, rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length]));
}
export function trackGeometry(result: Result, property: string, viewport: Interval) {
  const values = result.profiles.map(p => Number(p[property]));
  let lo = Math.min(...values), hi = Math.max(...values);
  if (lo === hi) { lo -= .5; hi += .5; }
  const x = (p: number) => 58 + (p - viewport[0]) / Math.max(1, viewport[1] - viewport[0]) * 918;
  const y = (v: number) => 99 - (v - lo) / (hi - lo) * 70;
  const points = result.profiles.slice(viewport[0] - 1, viewport[1]).map(p => `${x(p.position).toFixed(2)},${y(Number(p[property])).toFixed(2)}`).join(' ');
  const ticks = [...new Set([viewport[0], ...[.25, .5, .75].map(f => Math.round(viewport[0] + (viewport[1] - viewport[0]) * f)), viewport[1]])];
  return { values, lo, hi, x, y, points, ticks };
}
export function exportedTracks(result: Result, tracks: string[], viewport: Interval, selection: Interval, selected: number, t: Translate) {
  return tracks.map(property => {
    const scale = scales[property], g = trackGeometry(result, property, viewport);
    const a = Math.max(viewport[0], selection[0]), b = Math.min(viewport[1], selection[1]), cut = result.annotations.cleavage.value as number | null;
    return `<section><h3>${safeHTML(t(scale.ja, scale.en))} · ${safeHTML(scale.source)}${scale.code ? ' / ' + scale.code : ''} · ${safeHTML(t('尺度値', 'scale units'))}</h3><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 135"><title>${safeHTML(t(scale.ja, scale.en))} · ${viewport.join('–')}</title><rect width="1000" height="135" fill="white"/>${a <= b ? `<rect x="${Math.max(58, g.x(a) - 3)}" width="${Math.max(6, g.x(b) - g.x(a) + 6)}" y="24" height="78" fill="#e8f0f5"/>` : ''}${[g.lo, (g.hi + g.lo) / 2, g.hi].map(v => `<line x1="58" x2="976" y1="${g.y(v)}" y2="${g.y(v)}" stroke="#e3e8ed"/><text x="48" y="${g.y(v) + 4}" text-anchor="end" font-size="12">${formatValue(v)}</text>`).join('')}<polyline points="${g.points}" stroke="${scale.color}" stroke-width="1.7" fill="none"/>${cut != null && cut >= viewport[0] && cut < viewport[1] ? `<line x1="${g.x(cut + .5)}" x2="${g.x(cut + .5)}" y1="18" y2="103" stroke="#a74735" stroke-dasharray="4 3"/><text x="${Math.min(928, g.x(cut + .5) + 5)}" y="15" font-size="11">−1 │ +1</text>` : ''}${selected >= viewport[0] && selected <= viewport[1] ? `<circle cx="${g.x(selected)}" cy="${g.y(g.values[selected - 1])}" r="4" fill="${scale.color}"/>` : ''}${g.ticks.map(n => `<text x="${g.x(n)}" y="124" text-anchor="middle" font-size="12">${n}</text>`).join('')}</svg><p>${safeHTML(t(scale.note, scale.noteEn))}</p></section>`;
  }).join('');
}
export function metricCSV(metrics: Metric[]) {
  const cols: (keyof Metric)[] = ['id', 'value', 'unit', 'scope', 'range', 'property', 'basis', 'boundary_basis', 'definition', 'source', 'source_verification'];
  const quote = (x: unknown) => `"${String(x ?? '').replaceAll('"', '""')}"`;
  return [cols.map(quote).join(','), ...metrics.map(m => cols.map(key => quote(key === 'range' ? m.range.join('-') : m[key])).join(','))].join('\r\n');
}
export function formatValue(value: unknown) {
  return typeof value === 'number' ? Number(value.toPrecision(5)).toString() : String(value ?? '—');
}
export function safeHTML(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
export function saveFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
