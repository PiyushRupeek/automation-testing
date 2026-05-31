import * as fs from 'fs';
import * as path from 'path';
import { HealLog, RunResult, StepResult } from './types';
import { updateLatestShortcut } from './run-output';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageToBase64(filepath: string): string | null {
  try {
    if (!fs.existsSync(filepath)) return null;
    const data = fs.readFileSync(filepath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderStepCard(step: StepResult): string {
  const statusClass = step.status === 'pass' ? 'pass' : step.status === 'fail' ? 'fail' : 'skip';
  const screenshotB64 = step.screenshot ? imageToBase64(step.screenshot) : null;

  const actionsHtml = step.actions
    .map(
      (a) =>
        `<li class="${a.status}"><strong>${escapeHtml(a.label ?? a.type)}</strong> (${escapeHtml(a.type)})` +
        `${a.selector ? ` — <code>${escapeHtml(a.selector)}</code>` : ''}` +
        `${a.error ? ` — <span class="error">${escapeHtml(a.error)}</span>` : ''}</li>`
    )
    .join('');

  const assertionsHtml = step.assertions
    .map(
      (a) =>
        `<li class="${a.pass ? 'pass' : 'fail'}">${escapeHtml(a.type)}` +
        `${a.label ? `: ${escapeHtml(a.label)}` : ''}` +
        ` — ${escapeHtml(a.reason)}</li>`
    )
    .join('');

  return `
    <div class="step-card ${statusClass}">
      <div class="step-header">
        <span class="step-num">Step ${step.step}</span>
        <span class="step-name">${escapeHtml(step.name)}</span>
        <span class="badge ${statusClass}">${step.status.toUpperCase()}</span>
        <span class="duration">${formatDuration(step.duration)}</span>
      </div>
      ${step.error ? `<div class="step-error">${escapeHtml(step.error)}</div>` : ''}
      <div class="step-body">
        <div class="section">
          <h4>Actions</h4>
          <ul>${actionsHtml || '<li>None</li>'}</ul>
        </div>
        <div class="section">
          <h4>Assertions</h4>
          <ul>${assertionsHtml || '<li>None</li>'}</ul>
        </div>
        ${
          screenshotB64
            ? `<div class="section"><h4>Screenshot</h4><img src="${screenshotB64}" alt="Step screenshot" class="screenshot"/></div>`
            : ''
        }
      </div>
    </div>`;
}

function renderHealSection(healLog: HealLog): string {
  if (healLog.attempts.length === 0 && healLog.configPatches.length === 0) {
    return '';
  }

  const attemptsHtml = healLog.attempts
    .map(
      (a) =>
        `<li class="${a.outcome === 'failed' ? 'fail' : 'pass'}">` +
        `<strong>Step ${a.step}</strong> (${escapeHtml(a.stepName)}) — ${escapeHtml(a.context)}` +
        `${a.actionIndex !== undefined ? ` action #${a.actionIndex + 1}` : ''}` +
        `${a.assertionIndex !== undefined ? ` assertion #${a.assertionIndex + 1}` : ''}` +
        `<br/>Error: ${escapeHtml(a.error)}` +
        `<br/>Recovery: <code>${escapeHtml(a.recovery.type)}</code> — ${escapeHtml(a.recovery.reason)}` +
        `<br/>Outcome: ${escapeHtml(a.outcome)}` +
        `</li>`
    )
    .join('');

  const patchesHtml = healLog.configPatches
    .map(
      (p) =>
        `<li class="pass">` +
        `<strong>Step ${p.step}</strong> — ${escapeHtml(p.reason)}` +
        `<br/>Backup: <code>${escapeHtml(p.backupPath)}</code>` +
        `<br/>Patch: <code>${escapeHtml(JSON.stringify(p.patch))}</code>` +
        `</li>`
    )
    .join('');

  return `
    <div class="heal-section">
      <h2>Self-heal</h2>
      <p class="heal-meta">${healLog.attempts.length} attempt(s), ${healLog.configPatches.length} config patch(es)</p>
      ${
        attemptsHtml
          ? `<div class="section"><h4>Heal attempts</h4><ul>${attemptsHtml}</ul></div>`
          : ''
      }
      ${
        patchesHtml
          ? `<div class="section"><h4>Config patches applied</h4><ul>${patchesHtml}</ul></div>`
          : ''
      }
    </div>`;
}

function buildHtml(result: RunResult, jsonFilename: string): string {
  const stepCards = result.steps.map(renderStepCard).join('');
  const summary = result.summary ? escapeHtml(result.summary) : '';
  const costLine = result.apiCostEstimate
    ? `<p class="cost">Estimated API cost: $${result.apiCostEstimate.toFixed(4)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Test Report — ${escapeHtml(result.site)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.5; }
    .container { max-width: 960px; margin: 0 auto; padding: 24px; }
    header { background: #1a56db; color: #fff; padding: 32px; border-radius: 8px; margin-bottom: 24px; }
    header h1 { font-size: 24px; margin-bottom: 8px; }
    header .meta { font-size: 14px; opacity: 0.9; }
    .stats { display: flex; gap: 16px; margin-top: 16px; }
    .stat { background: rgba(255,255,255,0.15); padding: 8px 16px; border-radius: 6px; }
    .stat.pass { background: #16a34a; }
    .stat.fail { background: #dc2626; }
    .summary { background: #ebf0fd; border-left: 4px solid #1a56db; padding: 16px; margin-bottom: 24px; border-radius: 4px; }
    .step-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
    .step-card.fail { border-left: 4px solid #dc2626; }
    .step-card.pass { border-left: 4px solid #16a34a; }
    .step-card.skip { border-left: 4px solid #94a3b8; }
    .step-header { display: flex; align-items: center; gap: 12px; padding: 16px; background: #f1f5f9; flex-wrap: wrap; }
    .step-num { font-weight: bold; color: #1a56db; }
    .step-name { flex: 1; font-weight: bold; }
    .badge { padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; color: #fff; }
    .badge.pass { background: #16a34a; }
    .badge.fail { background: #dc2626; }
    .badge.skip { background: #94a3b8; }
    .duration { font-size: 13px; color: #64748b; }
    .step-error { background: #fef2f2; color: #dc2626; padding: 12px 16px; font-size: 14px; }
    .step-body { padding: 16px; }
    .section { margin-bottom: 12px; }
    .section h4 { font-size: 13px; color: #475569; margin-bottom: 6px; text-transform: uppercase; }
    .section ul { list-style: none; padding-left: 0; }
    .section li { padding: 4px 0; font-size: 14px; color: #475569; }
    .section li.pass { color: #16a34a; }
    .section li.fail { color: #dc2626; }
    .section li .error { color: #dc2626; }
    .screenshot { max-width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; margin-top: 8px; }
    footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #cbd5e1; font-size: 13px; color: #64748b; }
    footer a { color: #1a56db; }
    .cost { margin-top: 8px; font-size: 13px; color: #64748b; }
    code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
    .heal-section { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .heal-section h2 { font-size: 18px; color: #92400e; margin-bottom: 8px; }
    .heal-meta { font-size: 14px; color: #78350f; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(result.site)} — Test Report</h1>
      <div class="meta">Run ID: ${escapeHtml(result.runId)} | ${escapeHtml(result.timestamp)} | Duration: ${formatDuration(result.duration)}</div>
      <div class="stats">
        <div class="stat">Total: ${result.totalSteps}</div>
        <div class="stat pass">Passed: ${result.passed}</div>
        <div class="stat fail">Failed: ${result.failed}</div>
      </div>
    </header>
    ${summary ? `<div class="summary"><strong>Summary</strong><p>${summary}</p></div>` : ''}
    ${result.healLog ? renderHealSection(result.healLog) : ''}
    ${stepCards}
    <footer>
      <p>JSON result: <a href="${escapeHtml(jsonFilename)}">${escapeHtml(jsonFilename)}</a></p>
      ${costLine}
    </footer>
  </div>
</body>
</html>`;
}

export function generateHTML(result: RunResult, runDir: string): { htmlPath: string; jsonPath: string } {
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  const htmlPath = path.join(runDir, 'report.html');
  const jsonPath = path.join(runDir, 'result.json');

  const html = buildHtml(result, 'result.json');

  fs.writeFileSync(htmlPath, html, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
  updateLatestShortcut(runDir);

  return { htmlPath, jsonPath };
}
