import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Metric = {
  id: string;
  value: number | string;
  property: string;
  scope: string;
  range: number[];
  basis: string;
  boundary_basis: string | null;
  definition: string;
  source: string;
  unit: string;
  source_verification: string;
  label_ja: string;
  processes: string[];
};
type Profile = {
  position: number;
  residue: string;
  relative: number | null;
  region: string;
  [key: string]: unknown;
};
type Result = {
  mode: string;
  settings: { estimate: boolean; mature_window: number };
  schema_version: string;
  sequence: string;
  sequence_sha256: string;
  annotations: Record<string, { value: unknown; basis: string }>;
  regions: {
    intervals: Record<string, number[]> | null;
    basis: string;
    method: string | null;
  };
  metrics: Metric[];
  profiles: Profile[];
  warnings: string[];
  prediction: unknown;
  matrix: {
    processes: Record<string, string>;
    relations: Record<string, string[]>;
  };
};
const props = [
  "hydrophobicity",
  "polarity",
  "charge",
  "volume",
  "helix",
  "flexibility",
  "identity",
  "composition",
];
const names: Record<string, string> = {
  hydrophobicity: "疎水性",
  polarity: "極性",
  charge: "電荷",
  volume: "体積",
  helix: "ヘリックス傾向",
  flexibility: "柔軟性参照",
  identity: "残基の種類",
  composition: "組成",
};
const basis: Record<string, string> = {
  sequence: "配列から計算",
  provided: "入力情報",
  model_prediction: "モデル推定",
  rule_estimate: "規則による推定",
  missing: "不明",
};
const demo = "MKKLLLALALAVASASAADPEQKSTV";
function download(name: string, text: string, type = "application/json") {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parseInput(text: string) {
  if (!text.trim().startsWith(">")) return text;
  const records = text.trim().split(/\n(?=>)/);
  if (records.length !== 1)
    throw Error("通常解析は一配列です。比較にはAdvancedを使ってください。");
  return records[0].split(/\r?\n/).slice(1).join("");
}
function validResult(r: Result) {
  if (
    r?.schema_version !== "1.0" ||
    typeof r.sequence !== "string" ||
    !Array.isArray(r.metrics) ||
    !Array.isArray(r.profiles) ||
    !r.matrix ||
    !r.annotations
  )
    throw Error("Unsupported analysis file");
  if (
    !/^[ACDEFGHIKLMNPQRSTVWY]{1,10000}$/.test(r.sequence) ||
    r.profiles.length !== r.sequence.length ||
    r.profiles.some(
      (p, i) => p.position !== i + 1 || p.residue !== r.sequence[i],
    ) ||
    r.metrics.some(
      (m) =>
        typeof m.id !== "string" ||
        !Array.isArray(m.range) ||
        m.range.length !== 2 ||
        m.range.some(
          (n) => !Number.isInteger(n) || n < 1 || n > r.sequence.length,
        ) ||
        typeof m.source !== "string" ||
        !Array.isArray(m.processes),
    )
  ) {
    throw Error("Invalid sequence coordinates or metric records");
  }
  return r;
}
function App() {
  const [lang, setLang] = useState("ja"),
    [sequence, setSequence] = useState(""),
    [cut, setCut] = useState(""),
    [type, setType] = useState(""),
    [mode, setMode] = useState("precursor"),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(1),
    [property, setProperty] = useState("hydrophobicity"),
    [process, setProcess] = useState(""),
    [scope, setScope] = useState(""),
    [showEst, setShowEst] = useState(true),
    [advanced, setAdvanced] = useState(false),
    [structure, setStructure] = useState<unknown>(null),
    [prediction, setPrediction] = useState<unknown>(null),
    [windowSize, setWindowSize] = useState(10),
    [hasSP, setHasSP] = useState(""),
    [nEnd, setNEnd] = useState(""),
    [hEnd, setHEnd] = useState(""),
    [estimate, setEstimate] = useState(true),
    [history, setHistory] = useState<Result[]>([]),
    [comparison, setComparison] = useState(false);
  const t = (ja: string, en: string) => (lang === "ja" ? ja : en);
  const warningText = (w: string) => {
    const messages: Record<string, string> = {
      "Sequence coefficients do not measure cleavage efficiency, secretion yield, or physical rigidity.":
        "残基尺度から、切断効率・分泌量・実際の剛直性は測定できません。",
      "Matrix links are exploratory interpretations, not validated physiological scores.":
        "マトリクスの関連付けは探索のための整理です。検証済みの生理機能スコアではありません。",
      "Mature-side residues are unavailable; +1 and exposure cannot be inferred.":
        "成熟側の配列がないため、＋1の残基や露出度は不明です。",
      "SP endpoint is unknown; SP, N/H/C and junction metrics are unavailable.":
        "SPの終端が不明なので、SP・N/H/C・切断点前後の指標は計算していません。",
      "Supplied SP annotation conflicts with predicted no-SP; input retained.":
        "入力されたSP注釈と、TSignalの「SPなし」が食い違います。入力を優先しています。",
    };
    if (lang !== "ja") return w;
    if (messages[w]) return messages[w];
    if (w.startsWith("Supplied ") && w.includes("differs"))
      return "入力注釈とTSignalの予測が食い違います。入力を優先し、元の予測も保存しています。";
    if (w.startsWith("Predicted ") && w.includes("suppressed"))
      return "「SPなし」という入力を優先し、TSignalの切断点・種類は解析に使っていません。";
    return w;
  };
  const definitionText = (m: Metric) => {
    if (lang !== "ja") return m.definition;
    if (m.id.endsWith(".length")) return "指定範囲の残基数。";
    if (m.id.includes(".fraction_"))
      return "指定したアミノ酸または残基群が占める割合。";
    if (m.id.endsWith(".charge_sum"))
      return "K+R−D−Eの合計。pHに依存する正味電荷ではありません。";
    if (m.id.endsWith(".entropy"))
      return "残基組成のShannonエントロピー（bits）。";
    if (m.id.endsWith(".hydrophobic_moment"))
      return "100度/残基の仮想ヘリックス上のKDベクトル和を残基数で割った値。実際の構造は仮定しません。";
    if (m.scope === "structure")
      return "外部から読み込んだ注釈。出所の構造状態・モデルに依存します。";
    if (m.id.endsWith(".identity"))
      return "切断点を基準にした残基の種類。位置0はありません。";
    if (m.id === "junction.small_neutral")
      return "−3と−1がともにAGSCに属するか。切断の確率ではありません。";
    return "範囲内の残基尺度値の平均。構造や生理機能の予測値ではありません。";
  };
  const [status, setStatus] = useState<boolean | null>(null);
  React.useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((r) => setStatus(r.tsignal_configured))
      .catch(() => setStatus(null));
  }, []);
  const jobRef = React.useRef<string | null>(null);
  const [jobState, setJobState] = useState("");
  async function cancelRun() {
    if (jobRef.current)
      await fetch(`/api/jobs/${jobRef.current}`, { method: "DELETE" });
  }
  async function run() {
    setError("");
    setBusy(true);
    try {
      const body = {
        sequence: parseInput(sequence),
        mode,
        cleavage: cut ? Number(cut) : null,
        sp_type: type || null,
        has_sp: hasSP === "" ? null : hasSP === "yes",
        boundaries: nEnd || hEnd ? [Number(nEnd), Number(hEnd)] : null,
        estimate,
        mature_window: windowSize,
        structure,
        prediction,
      };
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.detail);
      jobRef.current = value.id;
      for (;;) {
        const response = await fetch(`/api/jobs/${value.id}`);
        const job = await response.json();
        if (!response.ok) throw Error(job.detail);
        setJobState(job.state);
        if (job.state === "failed") throw Error(job.error);
        if (job.state === "cancelled") {
          setJobState("");
          break;
        }
        if (job.state === "complete") {
          setResult(validResult(job.result));
          setSelected(1);
          setHistory((h) => [...h, job.result]);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      jobRef.current = null;
      setJobState("");
    }
  }
  async function open(file: File, kind: string) {
    try {
      const text = await file.text();
      if (kind === "fasta") {
        setSequence(text);
        return;
      }
      const data = JSON.parse(text);
      if (kind === "result") {
        const r = validResult(data.analysis || data);
        setResult(r);
        setSequence(r.sequence);
        setMode(r.mode || "precursor");
        setCut(
          r.annotations.cleavage.basis === "provided"
            ? String(r.annotations.cleavage.value || "")
            : "",
        );
        setType(
          r.annotations.type.basis === "provided"
            ? String(r.annotations.type.value || "")
            : "",
        );
        setHasSP(
          r.annotations.has_sp.basis === "provided"
            ? r.annotations.has_sp.value
              ? "yes"
              : "no"
            : "",
        );
        setPrediction(r.prediction);
        setNEnd(
          r.regions.basis === "provided"
            ? String(r.regions.intervals?.N[1] || "")
            : "",
        );
        setHEnd(
          r.regions.basis === "provided"
            ? String(r.regions.intervals?.H[1] || "")
            : "",
        );
        setEstimate(r.settings?.estimate ?? true);
        setWindowSize(r.settings?.mature_window || 10);
        setStructure(
          r.profiles
            .filter((p) => p.structure)
            .map((p) => ({
              position: p.position,
              residue: p.residue,
              ...(p.structure as object),
            })),
        );
        setSelected(
          Number.isInteger(data.view?.selected) &&
            data.view.selected >= 1 &&
            data.view.selected <= r.sequence.length
            ? data.view.selected
            : 1,
        );
        setProperty(
          props.includes(data.view?.property)
            ? data.view.property
            : "hydrophobicity",
        );
        setShowEst(data.view?.showEst ?? true);
        setProcess(data.view?.process || "");
        setScope(data.view?.scope || "");
        setHistory((h) => [...h, r]);
      } else if (kind === "structure") {
        if (!Array.isArray(data))
          throw Error("Structure JSON must be an array");
        setStructure(data);
      } else setPrediction(data);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  const filtered =
    result?.metrics.filter(
      (m) =>
        (showEst || m.basis !== "rule_estimate") &&
        (!scope || m.scope === scope) &&
        (!process || m.processes.includes(process)),
    ) || [];
  const profile = result?.profiles[selected - 1];
  const endpoint = result?.annotations.cleavage.value as number | null;
  const csv = () => {
    const cols = [
      "id",
      "value",
      "property",
      "scope",
      "basis",
      "boundary_basis",
      "range",
      "definition",
      "source",
      "unit",
      "source_verification",
    ];
    const quote = (v: unknown) =>
      '"' + String(v ?? "").replaceAll('"', '""') + '"';
    download(
      "signal-peptide-metrics.csv",
      [
        cols.map(quote).join(","),
        ...(result?.metrics || []).map((m) =>
          cols
            .map((k) =>
              quote(k === "range" ? m.range.join("-") : m[k as keyof Metric]),
            )
            .join(","),
        ),
      ].join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  function exportHTML() {
    if (!result) return;
    const safe = (x: string) =>
      x
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    const svg = document.querySelector("#profile-svg")?.outerHTML || "";
    const rows = result.metrics
      .map(
        (m) =>
          `<tr><td>${safe(m.id)}</td><td>${safe(String(m.value))}</td><td>${safe(m.basis)}</td><td>${safe(m.range.join("–"))}</td><td>${safe(m.definition)}</td><td>${safe(m.source)}</td></tr>`,
      )
      .join("");
    download(
      "signal-peptide-report.html",
      `<!doctype html><meta charset="utf-8"><title>Signal Peptide Explorer</title><style>body{font:14px system-ui;margin:40px;color:#18334a}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}svg{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Signal Peptide Explorer</h1><p>${safe(result.sequence)}</p><pre>${safe(JSON.stringify(result.annotations, null, 2))}</pre>${svg}<h2>Interpretation limits</h2><ul>${result.warnings.map((w) => `<li>${safe(w)}</li>`).join("")}</ul><table><tr><th>Metric</th><th>Value</th><th>Basis</th><th>Range</th><th>Definition</th><th>Source</th></tr>${rows}</table><h2>Reproducible analysis JSON</h2><pre>${safe(JSON.stringify(result, null, 2))}</pre>`,
      "text/html",
    );
  }
  return (
    <>
      <header>
        <div className="brand">
          SP<span>EXPLORER</span>
        </div>
        <span className="subtitle">Signal peptide research workspace</span>
        <button onClick={() => setLang(lang === "ja" ? "en" : "ja")}>
          {lang === "ja" ? "English" : "日本語"}
        </button>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">SEQUENCE → CONTEXT → INSIGHT</p>
            <h1>
              {t(
                "シグナルペプチドを、位置から読む。",
                "Read your signal peptide in context.",
              )}
            </h1>
            <p>
              {t(
                "物性、領域、切断点をひとつの配列上で探索。推定の出所まで確認できます。",
                "Explore properties, regions and cleavage on one sequence, with transparent provenance.",
              )}
            </p>
          </div>
          <span className="pill">v0.3 · LOCAL ANALYSIS</span>
        </section>
        <div className="workspace">
          <aside className="card input">
            <h2>{t("1 配列を入力", "1 Enter sequence")}</h2>
            <label>
              {t("前駆体配列またはFASTA", "Precursor sequence or FASTA")}
              <textarea
                value={sequence}
                onChange={(e) => setSequence(e.target.value)}
                placeholder=">protein\nMKK…"
                spellCheck={false}
              />
            </label>
            <div className="buttons">
              <label className="file">
                FASTA
                <input
                  type="file"
                  accept=".fa,.fasta,.faa,.txt"
                  onChange={(e) =>
                    e.target.files?.[0] && open(e.target.files[0], "fasta")
                  }
                />
              </label>
              <button
                onClick={() => {
                  setSequence(demo);
                  setCut("18");
                  setType("Sec/SPI");
                  setMode("precursor");
                  setPrediction(null);
                  setStructure(null);
                  setHasSP("");
                  setNEnd("");
                  setHEnd("");
                }}
              >
                {t("例を使う（人工配列）", "Synthetic example")}
              </button>
            </div>
            <label>
              {t("入力範囲", "Input range")}
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="precursor">
                  {t(
                    "前駆体（成熟側を含む）",
                    "Precursor, including mature side",
                  )}
                </option>
                <option value="sp">
                  {t(
                    "SPのみ（末端が切断点）",
                    "SP only, terminal cleavage boundary",
                  )}
                </option>
              </select>
            </label>
            <label>
              {t("切断位置：この残基の直後", "Cleavage: after this residue")}
              <input
                type="number"
                min="1"
                value={cut}
                onChange={(e) => setCut(e.target.value)}
                placeholder={t("未入力ならTSignal", "TSignal if omitted")}
              />
            </label>
            <label>
              {t("SPの種類", "SP type")}
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">
                  {t("未指定 → TSignal", "Unspecified → TSignal")}
                </option>
                {["Sec/SPI", "Sec/SPII", "Tat/SPI", "Tat/SPII", "Sec/SPIV"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
            <p className="small">
              TSignal:{" "}
              {status === true
                ? t(
                    "設定済み・未入力の注釈を自動付与",
                    "Configured · fills missing annotations",
                  )
                : t(
                    "未設定・未入力の注釈は不明",
                    "Not configured · missing annotations remain unknown",
                  )}
            </p>
            <button
              className="primary"
              disabled={busy || !sequence.trim()}
              onClick={run}
            >
              {busy
                ? t("解析中…", "Analyzing…")
                : t("解析する", "Analyze sequence")}
            </button>
            {busy && (
              <div className="buttons">
                <small>{jobState}</small>
                <button onClick={cancelRun}>
                  {t("解析を中止", "Cancel analysis")}
                </button>
              </div>
            )}
            <p className="small">
              {t(
                "TSignalは最大70残基を解析します。N/H/Cは別の規則で推定します。",
                "TSignal examines up to 70 residues. N/H/C uses a separate exploratory rule.",
              )}
            </p>
            <button
              className="textbutton"
              onClick={() => setAdvanced(!advanced)}
            >
              Advanced {advanced ? "−" : "+"}
            </button>
            {advanced && (
              <div className="advanced">
                <label>
                  {t("SPの有無", "SP presence")}
                  <select
                    value={hasSP}
                    onChange={(e) => setHasSP(e.target.value)}
                  >
                    <option value="">TSignal</option>
                    <option value="yes">{t("あり", "Present")}</option>
                    <option value="no">{t("なし", "Absent")}</option>
                  </select>
                </label>
                <label>
                  {t("N領域の末端（入力注釈）", "N end (provided)")}
                  <input
                    type="number"
                    value={nEnd}
                    onChange={(e) => setNEnd(e.target.value)}
                  />
                </label>
                <label>
                  {t("H領域の末端（入力注釈）", "H end (provided)")}
                  <input
                    type="number"
                    value={hEnd}
                    onChange={(e) => setHEnd(e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={estimate}
                    onChange={(e) => setEstimate(e.target.checked)}
                  />
                  {t("N/H/Cを規則で推定", "Estimate N/H/C with rule")}
                </label>
                <label>
                  {t("成熟側の集計範囲（残基数）", "Mature N-terminal window")}
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={windowSize}
                    onChange={(e) => setWindowSize(Number(e.target.value))}
                  />
                </label>
                <label className="file">
                  {t("構造注釈JSON", "Structure JSON")}
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) =>
                      e.target.files?.[0] &&
                      open(e.target.files[0], "structure")
                    }
                  />
                </label>
                {structure != null && (
                  <p>
                    ✓{" "}
                    {t(
                      "構造注釈を読み込み済み",
                      "Structure annotations loaded",
                    )}{" "}
                    <button onClick={() => setStructure(null)}>×</button>
                  </p>
                )}
                <label className="file">
                  TSignal JSON
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) =>
                      e.target.files?.[0] &&
                      open(e.target.files[0], "prediction")
                    }
                  />
                </label>
                {prediction != null && (
                  <p>
                    ✓ TSignal JSON{" "}
                    <button onClick={() => setPrediction(null)}>×</button>
                  </p>
                )}
                <button onClick={() => setComparison(!comparison)}>
                  {t("解析済み配列を比較", "Compare analyzed sequences")} (
                  {history.length})
                </button>
                <p className="small">
                  {t(
                    "同一指標の記述的比較です。効率の順位付けは行いません。",
                    "Descriptive comparison of the same metrics, without efficiency ranking.",
                  )}
                </p>
              </div>
            )}
            <label className="file reopen">
              {t("保存した解析を開く", "Reopen saved analysis")}
              <input
                type="file"
                accept=".json"
                onChange={(e) =>
                  e.target.files?.[0] && open(e.target.files[0], "result")
                }
              />
            </label>
          </aside>
          <div className="results" aria-live="polite">
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {!result ? (
              <section className="card empty">
                <div className="empty-mark">N → H → C │ +1</div>
                <h2>{t("まず、一配列から。", "Start with one sequence.")}</h2>
                <p>
                  {t(
                    "配列を入力するか、人工配列の例を使ってください。切断点が不明でも、配列全体の物性を解析できます。",
                    "Enter a sequence or try the synthetic example. Whole-sequence properties remain available without a cleavage annotation.",
                  )}
                </p>
                <p className="small">
                  {t(
                    "汎用物性計算のpeptides.pyに対し、本ツールはSP領域と切断点前後の文脈を扱います。",
                    "Unlike general peptide descriptors in peptides.py, this workspace adds SP regions, junction context and annotation provenance.",
                  )}
                </p>
              </section>
            ) : (
              <>
                <section className="summary">
                  <div className="card">
                    <span>{t("配列長", "Sequence length")}</span>
                    <strong>
                      {result.sequence.length}
                      <small> aa</small>
                    </strong>
                  </div>
                  <div className="card">
                    <span>{t("切断点", "Cleavage junction")}</span>
                    <strong>
                      {endpoint
                        ? `${endpoint} │ ${endpoint < result.sequence.length ? endpoint + 1 : "?"}`
                        : t("不明", "Unknown")}
                    </strong>
                    <small>
                      {basis[result.annotations.cleavage.basis] ||
                        result.annotations.cleavage.basis}
                    </small>
                  </div>
                  <div className="card">
                    <span>SP type</span>
                    <strong>
                      {String(
                        result.annotations.type.value ||
                          (result.annotations.has_sp.value === false
                            ? t("SPなし", "No SP")
                            : t("不明", "Unknown")),
                      )}
                    </strong>
                    <small>{basis[result.annotations.type.basis]}</small>
                  </div>
                </section>
                <section className="card">
                  <div className="section-head">
                    <h2>{t("2 配列と物性", "2 Sequence & properties")}</h2>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={showEst}
                        onChange={(e) => setShowEst(e.target.checked)}
                      />
                      {t("推定領域を表示", "Show estimated regions")}
                    </label>
                  </div>
                  <div className="legend">
                    <span>N</span>
                    <span>H</span>
                    <span>C</span>
                    <span>mature</span>
                    <small>
                      {result.regions.basis === "rule_estimate"
                        ? t(
                            "破線 = 規則による領域推定",
                            "Dashed = exploratory region estimate",
                          )
                        : basis[result.regions.basis]}
                    </small>
                  </div>
                  <div
                    className={`sequence ${result.regions.basis === "rule_estimate" ? "estimated" : ""}`}
                    aria-label="Residue selection"
                  >
                    {result.profiles.map((p) => (
                      <button
                        key={p.position}
                        className={`${showEst || result.regions.basis !== "rule_estimate" ? p.region : "unknown"} ${selected === p.position ? "selected" : ""} ${endpoint === p.position ? "cut" : ""}`}
                        title={`${p.position}: ${p.residue}`}
                        onClick={() => setSelected(p.position)}
                      >
                        <small>{p.position}</small>
                        {p.residue}
                      </button>
                    ))}
                  </div>
                  <div className="buttons">
                    {props.slice(0, 6).map((p) => (
                      <button
                        key={p}
                        className={property === p ? "active" : ""}
                        onClick={() => setProperty(p)}
                      >
                        {t(names[p], p)}
                      </button>
                    ))}
                  </div>
                  <ProfilePlot
                    result={result}
                    property={property}
                    selected={selected}
                    select={setSelected}
                  />
                  <div className="detail">
                    <strong>
                      {selected} · {profile?.residue}{" "}
                      {profile?.relative != null
                        ? `(${Number(profile.relative) > 0 ? "+" : ""}${profile.relative})`
                        : ""}
                    </strong>
                    <span>
                      {t(names[property] || property, property)}:{" "}
                      {String(profile?.[property] ?? "—")}
                    </span>
                    <small>
                      {t(
                        "残基係数。露出度や切断効率の実測値ではありません。",
                        "Residue coefficient; not measured exposure or cleavage efficiency.",
                      )}
                    </small>
                    {profile?.structure != null && (
                      <pre>{JSON.stringify(profile.structure, null, 2)}</pre>
                    )}
                  </div>
                  {endpoint && (
                    <div className="junction">
                      <h3>{t("切断点を拡大", "Cleavage zoom")}</h3>
                      {result.profiles
                        .filter(
                          (p) =>
                            p.position >= endpoint - 5 &&
                            p.position <= endpoint + 6,
                        )
                        .map((p) => (
                          <button
                            className={selected === p.position ? "active" : ""}
                            key={p.position}
                            onClick={() => setSelected(p.position)}
                          >
                            <small>
                              {Number(p.relative) > 0 ? "+" : ""}
                              {p.relative}
                            </small>
                            <b>{p.residue}</b>
                          </button>
                        ))}
                      {endpoint === result.sequence.length && (
                        <p>
                          {t(
                            "成熟側は入力に含まれていません。＋1は不明です。",
                            "Mature side is absent. +1 is unknown.",
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </section>
                <section className="card">
                  <div className="section-head">
                    <h2>
                      {t(
                        "3 生理学的文脈 × 物性",
                        "3 Physiological context × properties",
                      )}
                    </h2>
                    <button
                      onClick={() => {
                        setProcess("");
                        setScope("");
                      }}
                    >
                      {t("絞り込みを解除", "Clear filters")}
                    </button>
                  </div>
                  <p className="small">
                    {t(
                      "数字は関連する記述指標の数です。関連性の強さや生理機能のスコアではありません。",
                      "Counts show related descriptors, not association strength or physiological scores.",
                    )}
                  </p>
                  <div className="table-scroll">
                    <table className="matrix">
                      <thead>
                        <tr>
                          <th>{t("過程", "Process")}</th>
                          {props.map((p) => (
                            <th key={p}>{t(names[p], p)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.matrix.processes).map(
                          ([k, v]) => (
                            <tr key={k}>
                              <th>{t(v, k)}</th>
                              {props.map((p) => {
                                const count = result.metrics.filter(
                                  (m) =>
                                    m.property === p &&
                                    m.processes.includes(k) &&
                                    (showEst || m.basis !== "rule_estimate"),
                                ).length;
                                return (
                                  <td key={p}>
                                    {count ? (
                                      <button
                                        className={
                                          process === k && property === p
                                            ? "active"
                                            : ""
                                        }
                                        onClick={() => {
                                          setProcess(k);
                                          setProperty(p);
                                        }}
                                      >
                                        {count}
                                      </button>
                                    ) : (
                                      <span title="No direct sequence descriptor">
                                        —
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="small">
                    {t(
                      "行列の外：生物種、輸送経路、構造状態、膜環境、実験条件。配列だけでは確定できません。露出度・無秩序・二次構造は別注釈として扱います。",
                      "Outside the matrix: organism, transport pathway, structural state, membrane environment and experimental conditions. Exposure, disorder and secondary structure require separate annotations.",
                    )}
                  </p>
                </section>
                <section className="card">
                  <div className="section-head">
                    <h2>{t("4 指標と根拠", "4 Metrics & evidence")}</h2>
                    <select
                      aria-label="Scope filter"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                    >
                      <option value="">
                        {t("すべての範囲", "All scopes")}
                      </option>
                      {[...new Set(result.metrics.map((m) => m.scope))].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </div>
                  <p className="small">
                    {process &&
                      `${t(result.matrix.processes[process], process)} / `}
                    {filtered.length}{" "}
                    {t(
                      "指標。範囲をクリックすると対応残基を選択します。",
                      "descriptors. Click an interval to select its residue.",
                    )}
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("指標", "Metric")}</th>
                          <th>{t("値", "Value")}</th>
                          <th>{t("範囲", "Scope")}</th>
                          <th>{t("出所", "Basis")}</th>
                          <th>{t("定義・尺度", "Definition & source")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered
                          .filter((m) => !process || m.property === property)
                          .map((m) => (
                            <tr key={m.id}>
                              <td>
                                {t(m.label_ja, m.id)}
                                <small>{m.id}</small>
                              </td>
                              <td>
                                {typeof m.value === "number"
                                  ? Number(m.value.toPrecision(5))
                                  : m.value}
                              </td>
                              <td>
                                <button onClick={() => setSelected(m.range[0])}>
                                  {m.scope} {m.range.join("–")}
                                </button>
                              </td>
                              <td>
                                <span className={`badge ${m.basis}`}>
                                  {t(basis[m.basis] || m.basis, m.basis)}
                                </span>
                                <small>
                                  {m.boundary_basis &&
                                    t("境界: ", "Boundary: ") +
                                      (basis[m.boundary_basis] ||
                                        m.boundary_basis)}
                                </small>
                              </td>
                              <td>
                                <small>
                                  {definitionText(m)}
                                  <br />
                                  {m.source}
                                </small>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                {comparison && (
                  <section className="card">
                    <h2>
                      Advanced ·{" "}
                      {t("解析済み配列の比較", "Analyzed sequence comparison")}
                    </h2>
                    <p>
                      {t(
                        "一配列ずつ解析した結果を比較します。各列の境界情報は保存JSONで確認してください。",
                        "Compare separately analyzed results. Inspect boundary provenance in each saved JSON.",
                      )}
                    </p>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            {history.map((r, i) => (
                              <th key={i}>
                                #{i + 1} · {r.sequence.length} aa
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ...new Set(
                              history.flatMap((r) =>
                                r.metrics.map((m) => m.id),
                              ),
                            ),
                          ].map((id) => (
                            <tr key={id}>
                              <td>{id}</td>
                              {history.map((r, i) => (
                                <td key={i}>
                                  {String(
                                    r.metrics.find((m) => m.id === id)?.value ??
                                      "—",
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <section className="card report">
                  <h2>{t("保存・レポート", "Save & report")}</h2>
                  <div className="buttons">
                    <button
                      onClick={() =>
                        download(
                          "signal-peptide-analysis.json",
                          JSON.stringify(
                            {
                              analysis: result,
                              view: {
                                selected,
                                property,
                                showEst,
                                process,
                                scope,
                              },
                            },
                            null,
                            2,
                          ),
                        )
                      }
                    >
                      JSON
                    </button>
                    <button onClick={csv}>CSV</button>
                    <button onClick={exportHTML}>HTML</button>
                    <button
                      onClick={() => {
                        const svg = document.querySelector("#profile-svg");
                        if (svg)
                          download(
                            "signal-peptide-profile.svg",
                            svg.outerHTML,
                            "image/svg+xml",
                          );
                      }}
                    >
                      SVG
                    </button>
                    <button onClick={() => window.print()}>PDF / Print</button>
                  </div>
                  <h3>{t("解釈上の注意", "Interpretation notes")}</h3>
                  <ul>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{warningText(w)}</li>
                    ))}
                  </ul>
                  <details>
                    <summary>
                      {t(
                        "注釈・領域推定・TSignalの記録",
                        "Annotation, region and TSignal provenance",
                      )}
                    </summary>
                    <pre>
                      {JSON.stringify(
                        {
                          annotations: result.annotations,
                          regions: result.regions,
                          prediction: result.prediction,
                          sequence_sha256: result.sequence_sha256,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <p className="small">
                    peptides.py:{" "}
                    {t(
                      "汎用のペプチド物性計算。本ツールはSPと切断点前後の解析・根拠表示を追加します。",
                      "General peptide descriptors. This tool adds SP and junction context with explicit provenance.",
                    )}
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
        <footer>
          Signal Peptide Explorer ·{" "}
          {t(
            "生理機能の推定と配列物性を区別して読む",
            "Keep physiological inference distinct from sequence descriptors",
          )}
        </footer>
      </main>
    </>
  );
}
function ProfilePlot({
  result,
  property,
  selected,
  select,
}: {
  result: Result;
  property: string;
  selected: number;
  select: (n: number) => void;
}) {
  const values = result.profiles.map((p) => Number(p[property]));
  const low = Math.min(...values),
    high = Math.max(...values);
  const x = (i: number) => 48 + (i * 880) / Math.max(values.length - 1, 1);
  const y = (v: number) => 145 - ((v - low) * 112) / (high - low || 1);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const endpoint = result.annotations.cleavage.value as number | null;
  return (
    <svg
      id="profile-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 960 185"
      role="img"
      aria-label={`${property} residue profile`}
    >
      <rect width="960" height="185" fill="#f8fbfd" />
      <text x="10" y="17" fontSize="12" fill="#365269">
        {property} · residue coefficients
      </text>
      <line x1="48" x2="928" y1="145" y2="145" stroke="#a5b9c8" />
      <text x="8" y="42" fontSize="12">
        {high.toFixed(2)}
      </text>
      <text x="8" y="145" fontSize="12">
        {low.toFixed(2)}
      </text>
      <polyline points={points} stroke="#008b8b" fill="none" strokeWidth="2" />
      {endpoint != null && endpoint < values.length && (
        <g>
          <line
            x1={(x(endpoint - 1) + x(endpoint)) / 2}
            x2={(x(endpoint - 1) + x(endpoint)) / 2}
            y1="24"
            y2="150"
            stroke="#cf6042"
            strokeDasharray="4 3"
          />
          <text
            x={(x(endpoint - 1) + x(endpoint)) / 2 + 5}
            y="32"
            fontSize="11"
          >
            cleavage
          </text>
        </g>
      )}
      <circle
        cx={x(selected - 1)}
        cy={y(values[selected - 1])}
        r="5"
        fill="#cf6042"
      />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r="8"
          fill="transparent"
          onClick={() => select(i + 1)}
        >
          <title>
            {i + 1} {result.sequence[i]}: {v}
          </title>
        </circle>
      ))}
      <text x="48" y="175" fontSize="12">
        1
      </text>
      <text x="900" y="175" fontSize="12">
        {values.length}
      </text>
    </svg>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
