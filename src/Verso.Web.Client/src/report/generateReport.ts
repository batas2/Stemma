// F-001 Architecture Report — export orchestration. Collects a fresh bundle, inlines the viewer,
// enforces the size budget (Q8-A) and triggers the download of the single HTML file.

import viewerJs from './viewer.js?raw';
import viewerCss from './viewer.css?raw';
import { collectReportBundle } from './reportData';
import { renderReportHtml } from './template';

const WARN_BYTES = 5 * 1024 * 1024;   // soft target from the spec
const FAIL_BYTES = 25 * 1024 * 1024;  // hard stop

export interface ReportResult { fileName: string; bytes: number; oversize: boolean; }

export async function generateAndDownloadReport(rootPath: string): Promise<ReportResult> {
  const bundle = await collectReportBundle(rootPath);
  const html = renderReportHtml(bundle, viewerJs, viewerCss);
  const bytes = new Blob([html]).size;
  if (bytes > FAIL_BYTES) {
    throw new Error(`Report is ${(bytes / 1024 / 1024).toFixed(1)} MB — over the 25 MB limit. Trim the model or notes and retry.`);
  }
  const fileName = `${bundle.meta.workspace}-architecture-report.html`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  return { fileName, bytes, oversize: bytes > WARN_BYTES };
}
