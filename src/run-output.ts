import * as fs from 'fs';
import * as path from 'path';
import { FlowVariant, RunMode } from './types';

const REPORTS_DIR = path.join(process.cwd(), 'reports');

export interface RunOutputPaths {
  runDir: string;
  screenshotsDir: string;
  dirName: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatRunDirName(
  timestamp: string | Date,
  variant: FlowVariant,
  mode: RunMode
): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${stamp}_${variant}-${mode}`;
}

export function createRunOutputDir(
  timestamp: string | Date,
  variant: FlowVariant,
  mode: RunMode
): RunOutputPaths {
  const dirName = formatRunDirName(timestamp, variant, mode);
  const runDir = path.join(REPORTS_DIR, dirName);
  const screenshotsDir = path.join(runDir, 'screenshots');

  fs.mkdirSync(screenshotsDir, { recursive: true });

  return { runDir, screenshotsDir, dirName };
}

export function updateLatestShortcut(runDir: string): void {
  const latestDir = path.join(REPORTS_DIR, 'latest');
  fs.mkdirSync(latestDir, { recursive: true });

  const reportSrc = path.join(runDir, 'report.html');
  const resultSrc = path.join(runDir, 'result.json');

  if (fs.existsSync(reportSrc)) {
    fs.copyFileSync(reportSrc, path.join(latestDir, 'report.html'));
  }
  if (fs.existsSync(resultSrc)) {
    fs.copyFileSync(resultSrc, path.join(latestDir, 'result.json'));
  }
}

export function getReportsDir(): string {
  return REPORTS_DIR;
}
