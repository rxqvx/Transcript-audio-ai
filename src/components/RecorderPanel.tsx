"use client";

import { useCallback, useEffect, useState } from "react";
import { AudioVisualizer } from "@/components/AudioVisualizer";
import { TranscriptView } from "@/components/TranscriptView";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { DEFAULT_LANGUAGE, LANGUAGES } from "@/lib/speech";
import {
  countWords,
  downloadBlob,
  extensionForMimeType,
  formatDuration,
  timestampForFilename,
} from "@/lib/utils";

export function RecorderPanel() {
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [copied, setCopied] = useState(false);

  const recorder = useAudioRecorder();
  const speech = useSpeechRecognition(language);

  const active = recorder.recording;
  const fullText = speech.transcript;
  const error = recorder.error ?? speech.error;

  const handleStart = useCallback(async () => {
    // O microfone é pedido primeiro: sem permissão, nem começamos a escutar.
    const ok = await recorder.start();
    if (ok) speech.start();
  }, [recorder, speech]);

  const handleStop = useCallback(() => {
    speech.stop();
    recorder.stop();
  }, [recorder, speech]);

  const handleToggle = useCallback(() => {
    if (active) handleStop();
    else void handleStart();
  }, [active, handleStart, handleStop]);

  const handleClear = useCallback(() => {
    speech.reset();
    recorder.clear();
  }, [recorder, speech]);

  const handleCopy = useCallback(async () => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [fullText]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleDownloadText = useCallback(() => {
    if (!fullText) return;
    downloadBlob(
      new Blob([fullText], { type: "text/plain;charset=utf-8" }),
      `transcricao_${timestampForFilename()}.txt`,
    );
  }, [fullText]);

  const handleDownloadAudio = useCallback(() => {
    const result = recorder.result;
    if (!result) return;
    downloadBlob(
      result.blob,
      `gravacao_${timestampForFilename()}.${extensionForMimeType(result.mimeType)}`,
    );
  }, [recorder.result]);

  const unsupported = speech.supported === false;

  return (
    <div className="flex w-full flex-col gap-6">
      {unsupported && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Este navegador não tem a Web Speech API. A transcrição em tempo real
          funciona no <strong>Chrome</strong>, <strong>Edge</strong> ou{" "}
          <strong>Safari</strong> — a gravação do áudio continua disponível aqui.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200"
        >
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-black/10 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-col items-center gap-5">
          <button
            type="button"
            onClick={handleToggle}
            aria-pressed={active}
            className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/40 ${
              active
                ? "bg-red-600 hover:bg-red-500"
                : "bg-linear-to-br from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500"
            }`}
          >
            {active && (
              <span className="absolute inset-0 animate-ping rounded-full bg-red-600/40" />
            )}
            <span className="relative">
              {active ? <StopIcon /> : <MicIcon />}
            </span>
            <span className="sr-only">
              {active ? "Parar gravação" : "Iniciar gravação"}
            </span>
          </button>

          <div className="text-center">
            <p className="font-mono text-3xl tabular-nums">
              {formatDuration(
                active ? recorder.elapsedMs : (recorder.result?.durationMs ?? 0),
              )}
            </p>
            <p className="mt-1 text-sm text-black/50 dark:text-white/50">
              {!active
                ? "Toque no microfone para começar"
                : speech.listening
                  ? "Ouvindo… fale normalmente"
                  : speech.error || unsupported
                    ? "Gravando — transcrição indisponível"
                    : "Gravando (reconhecimento iniciando…)"}
            </p>
          </div>

          <AudioVisualizer getAnalyser={recorder.getAnalyser} active={active} />

          <label className="flex items-center gap-2 text-sm">
            <span className="text-black/60 dark:text-white/60">Idioma</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={active}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900"
            >
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {active && (
            <p className="-mt-3 text-xs text-black/40 dark:text-white/40">
              Pare a gravação para trocar o idioma.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Transcrição</h2>
          <span className="text-xs text-black/50 dark:text-white/50">
            {countWords(fullText)} palavras · {fullText.length} caracteres
          </span>
        </div>

        <TranscriptView
          transcript={speech.transcript}
          interim={speech.interim}
          live={active}
          onChange={speech.setTranscript}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton onClick={handleCopy} disabled={!fullText}>
            {copied ? "Copiado!" : "Copiar texto"}
          </ActionButton>
          <ActionButton onClick={handleDownloadText} disabled={!fullText}>
            Baixar .txt
          </ActionButton>
          <ActionButton
            onClick={handleClear}
            disabled={active || (!fullText && !recorder.result)}
          >
            Limpar
          </ActionButton>
        </div>
      </section>

      {recorder.result && !active && (
        <section className="rounded-2xl border border-black/10 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <h2 className="mb-3 text-lg font-semibold">Áudio gravado</h2>
          <audio
            controls
            src={recorder.result.url}
            className="w-full"
            preload="metadata"
          />
          <div className="mt-4">
            <ActionButton onClick={handleDownloadAudio}>
              Baixar áudio
            </ActionButton>
          </div>
        </section>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20"
    >
      {children}
    </button>
  );
}

function MicIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}
