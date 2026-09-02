// Browser download of an in-memory blob. Kept out of the orchestrator so the
// DOM-only bit has one home (source files and tape blocks both use it).

/** Triggers a browser download of `blob` as `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
