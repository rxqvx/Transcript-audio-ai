/** Junta um trecho reconhecido ao texto já acumulado, normalizando espaços. */
export function appendChunk(base: string, chunk: string): string {
  const piece = chunk.trim();
  if (!piece) return base;
  if (!base) return piece;
  if (/[\s]$/.test(base)) return base + piece;
  return `${base} ${piece}`;
}

/** Formata milissegundos como `mm:ss` (ou `h:mm:ss` a partir de uma hora). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Carimbo de data/hora seguro para nome de arquivo: `2026-08-07_14-32-05`. */
export function timestampForFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Extensão correspondente ao mime type gravado pelo MediaRecorder. */
export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("mpeg")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}
