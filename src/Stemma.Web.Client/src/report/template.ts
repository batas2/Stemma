// F-001 Architecture Report — single-file HTML assembly.
// Everything is inlined: data as JSON, viewer JS + CSS as text. The file must make zero network
// requests (AC1), so no external scripts, styles, fonts or images are referenced.

import type { ReportBundle } from './reportData';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderReportHtml(bundle: ReportBundle, viewerJs: string, viewerCss: string): string {
  // `<` is escaped so user content can never terminate the JSON script block (`</script>`).
  const json = JSON.stringify(bundle).replace(/</g, '\\u003c');
  const title = `${bundle.meta.workspace} — Architecture Report`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Stemma architecture report">
<title>${escapeHtml(title)}</title>
<style>
${viewerCss}
</style>
</head>
<body>
<div id="app" class="vr-app"></div>
<script type="application/json" id="stemma-report-data">${json}</script>
<script>
${viewerJs}
</script>
</body>
</html>`;
}
