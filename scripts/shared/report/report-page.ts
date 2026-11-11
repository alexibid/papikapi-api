import type { ReportContent, ReportFigure, ReportStep } from './report-data.js';
import type { FigureImages } from './report-images.js';

export interface ReportFigureView {
  readonly figure: ReportFigure;
  readonly images: FigureImages;
}

const STYLE = `
  @page { size: A4; margin: 14mm 12mm; }
  body { font: 10pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #24221f; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4px; }
  h2 { font-size: 13pt; margin: 18px 0 8px; }
  .lede { color: #6c6860; margin: 0 0 12px; }
  .stats { display: flex; gap: 28px; margin: 10px 0 4px; }
  .stats strong { display: block; font-size: 16pt; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #dcd8cf; }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #6c6860; }
  td.num, th.num { text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .fig { border: 1px solid #dcd8cf; border-radius: 8px; padding: 8px; break-inside: avoid; }
  .fig h3 { font-size: 11pt; margin: 0; display: flex; justify-content: space-between; }
  .fig code { font-size: 8pt; color: #6c6860; }
  .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 6px 0; }
  .trio img, .trio .none { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 4px; background: #ecebe7; }
  .trio .dark { background: #141416; }
  .trio span { display: block; font-size: 7pt; color: #6c6860; text-transform: uppercase; }
  .eye-detail { margin: 5px 0 4px; border-radius: 4px; overflow: hidden; border: 1px solid #dcd8cf; }
  .eye-detail img { width: 100%; height: auto; display: block; }
  .meta { font-size: 8pt; color: #6c6860; }
  .warn { color: #b5770d; }
`;

/** The figure review as a printable page: totals, the time and cost of each step, then every figure's three views. */
export function reportPage(content: ReportContent, figures: readonly ReportFigureView[], now: Date): string {
  const perFigureSeconds = content.steps.reduce((total, step) => total + step.avgSeconds, 0);
  const perFigureCost = content.steps.reduce((total, step) => total + step.avgCostUsd, 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Papikapi Figures Review</title>
<style>${STYLE}</style></head><body>
<h1>Papikapi Figures Review</h1>
<p class="lede">Current version ${escape(content.currentVersion)} ·
Generated on ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. FLUX art, TRELLIS model, and final paper figure.</p>
<div class="stats">
  <div><strong>${content.figures.length}</strong>figures</div>
  <div><strong>${minutes(perFigureSeconds)}</strong>per figure, average</div>
  <div><strong>${usd(perFigureCost)}</strong>per figure, average</div>
  <div><strong>${usd(content.spentCostUsd)}</strong>actual spend (${content.spentHours.toFixed(1)} h)</div>
</div>
<h2>Time and cost per step</h2>
<table><tr><th>Step</th><th class="num">Avg Time</th><th class="num">Avg Cost</th>
<th class="num">Runs</th><th class="num">Total Spend</th></tr>${content.steps.map(stepRow).join('')}</table>
<h2>Figures</h2>
<div class="grid">${figures.map(figureCard).join('')}</div>
</body></html>`;
}

function stepRow(step: ReportStep): string {
  return `<tr><td>${step.label}</td><td class="num">${step.avgSeconds.toFixed(1)} s</td>
<td class="num">${usd(step.avgCostUsd)}</td><td class="num">${step.runs}</td>
<td class="num">${usd(step.spentCostUsd)}</td></tr>`;
}

function figureCard({ figure, images }: ReportFigureView): string {
  const eyes = figure.artEyes ? 'art eyes' : '<span class="warn">TRELLIS eyes</span>';
  const eyesView = images.eyes ? `<div class="eye-detail"><img src="${images.eyes}" alt="Eye Detail: FLUX vs 3D"></div>` : '';
  return `<div class="fig"><h3>${escape(figure.name)} <code>${figure.id}</code></h3>
<div class="trio">${view(images.art, 'Art', '')}${view(images.trellis, 'TRELLIS', 'dark')}
${view(images.final, 'Final', '')}</div>
${eyesView}
<div class="meta">${figure.paperFaces ?? '?'} faces · ${figure.mode} · ${eyes} · ${minutes(figure.seconds)} ·
${usd(figure.costUsd)} across ${figure.runs} runs · generated with version ${escape(figure.version ?? '0.1.0')} ·
updated ${figure.updatedAt.slice(0, 10)}</div></div>`;
}

function view(uri: string | null, label: string, tone: string): string {
  const picture = uri ? `<img class="${tone}" src="${uri}" alt="${label}">` : '<div class="none"></div>';
  return `<div>${picture}<span>${label}</span></div>`;
}

function minutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min`;
}

function usd(value: number): string {
  return `${value.toFixed(value < 1 ? 4 : 2)} USD`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
