"use client";

import type { WhisperBackend } from "@/lib/whisper";
import type { WhisperProgress } from "@/hooks/useWhisper";

interface TranscriptionProgressProps {
  progress: WhisperProgress;
  backend: WhisperBackend | null;
  onCancel: () => void;
}

/** Rótulo e barra de progresso para cada etapa da transcrição. */
function describe(progress: WhisperProgress): {
  label: string;
  percent: number | null;
} {
  switch (progress.stage) {
    case "decoding":
      return { label: "Preparando o áudio…", percent: null };
    case "downloading":
      return {
        label: `Baixando o modelo — ${progress.downloadedMB} de ${progress.totalMB} MB`,
        percent: progress.downloadPercent,
      };
    case "preparing":
      return { label: "Preparando o modelo…", percent: null };
    case "transcribing":
      return {
        label:
          progress.segments > 1
            ? `Transcrevendo — trecho ${progress.segment} de ${progress.segments}`
            : "Transcrevendo…",
        // O progresso conta trechos concluídos: o que está rodando ainda não vale.
        percent:
          progress.segments > 0
            ? Math.round(((progress.segment - 1) / progress.segments) * 100)
            : null,
      };
    case "idle":
      return { label: "", percent: null };
  }
}

export function TranscriptionProgress({
  progress,
  backend,
  onCancel,
}: TranscriptionProgressProps) {
  if (progress.stage === "idle") return null;

  const { label, percent } = describe(progress);

  return (
    <section
      aria-live="polite"
      className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          Cancelar
        </button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={`h-full rounded-full bg-linear-to-r from-indigo-500 to-violet-500 transition-[width] duration-300 ${
            // Sem porcentagem conhecida, uma barra pulsante indica atividade.
            percent === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>

      {progress.partial && (
        <p className="mt-3 line-clamp-2 text-sm text-black/50 italic dark:text-white/50">
          {progress.partial}
        </p>
      )}

      {backend === "wasm" && progress.stage === "transcribing" && (
        <p className="mt-3 text-xs text-black/45 dark:text-white/45">
          Rodando na CPU — este navegador não expôs a WebGPU. Funciona, mas leva
          bem mais tempo que o áudio dura.
        </p>
      )}
    </section>
  );
}
