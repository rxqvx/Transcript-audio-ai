"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioVisualizer } from "@/components/AudioVisualizer";
import { TranscriptionProgress } from "@/components/TranscriptionProgress";
import { TranscriptView } from "@/components/TranscriptView";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useModelPreference } from "@/hooks/useModelPreference";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useWhisper } from "@/hooks/useWhisper";
import { DEFAULT_LANGUAGE, LANGUAGES } from "@/lib/speech";
import {
  countWords,
  downloadBlob,
  extensionForMimeType,
  formatDuration,
  timestampForFilename,
} from "@/lib/utils";
import { WHISPER_MODELS, findModel, type WhisperModelId } from "@/lib/whisper";

export function RecorderPanel() {
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [model, handleModelChange] = useModelPreference();
  const [copied, setCopied] = useState(false);
  /** `true` depois que o Whisper substituiu a prévia da Web Speech. */
  const [refined, setRefined] = useState(false);

  const recorder = useAudioRecorder();
  const speech = useSpeechRecognition(language);
  const whisper = useWhisper();

  const active = recorder.recording;
  const fullText = speech.transcript;
  const error = recorder.error ?? speech.error ?? whisper.error;

  /** Áudio que já foi (ou está sendo) transcrito, para não repetir o trabalho. */
  const transcribedRef = useRef<Blob | null>(null);

  const runWhisper = useCallback(
    async (blob: Blob) => {
      const text = await whisper.transcribe(blob, { model, language });
      // `null` é cancelamento ou erro: a prévia ao vivo continua valendo.
      if (text === null) return;
      speech.setTranscript(text);
      setRefined(true);
    },
    [language, model, speech, whisper],
  );

  // Parar a gravação dispara a transcrição de verdade. A prévia da Web Speech
  // fica na tela até o Whisper terminar e substituí-la.
  useEffect(() => {
    const result = recorder.result;
    if (!result || transcribedRef.current === result.blob) return;
    transcribedRef.current = result.blob;
    void runWhisper(result.blob);
  }, [recorder.result, runWhisper]);

  const handleStart = useCallback(async () => {
    // O microfone é pedido primeiro: sem permissão, nem começamos a escutar.
    const ok = await recorder.start();
    if (!ok) return;
    whisper.cancel();
    setRefined(false);
    speech.start();
  }, [recorder, speech, whisper]);

  const handleStop = useCallback(() => {
    speech.stop();
    recorder.stop();
  }, [recorder, speech]);

  const handleToggle = useCallback(() => {
    if (active) handleStop();
    else void handleStart();
  }, [active, handleStart, handleStop]);

  const handleClear = useCallback(() => {
    whisper.cancel();
    transcribedRef.current = null;
    setRefined(false);
    speech.reset();
    recorder.clear();
  }, [recorder, speech, whisper]);

  const handleUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Zerar o input deixa escolher o mesmo arquivo de novo.
      event.target.value = "";
      if (!file) return;
      setRefined(false);
      speech.reset();
      // A troca de `recorder.result` dispara o Whisper pelo efeito acima.
      recorder.load(file);
    },
    [recorder, speech],
  );

  const handleRetranscribe = useCallback(() => {
    const result = recorder.result;
    if (!result) return;
    setRefined(false);
    void runWhisper(result.blob);
  }, [recorder.result, runWhisper]);

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
  const selectedModel = findModel(model);

  return (
    <div className="flex w-full flex-col gap-6">
      {unsupported && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Este navegador não tem a Web Speech API, então a prévia ao vivo não
          aparece — ela existe no <strong>Chrome</strong>,{" "}
          <strong>Edge</strong> e <strong>Safari</strong>. A transcrição final
          com o Whisper roda normalmente aqui ao parar a gravação.
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
                ? "Toque no microfone ou envie um arquivo"
                : speech.listening
                  ? "Ouvindo… fale normalmente"
                  : speech.error || unsupported
                    ? "Gravando — o texto sai ao parar"
                    : "Gravando (prévia iniciando…)"}
            </p>
          </div>

          <label className="cursor-pointer rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-medium transition focus-within:ring-2 focus-within:ring-indigo-500/40 hover:bg-black/5 has-disabled:cursor-not-allowed has-disabled:opacity-40 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20">
            Enviar arquivo de áudio
            <input
              type="file"
              accept="audio/*,video/*,.opus"
              onChange={handleUpload}
              disabled={active || whisper.busy}
              className="sr-only"
            />
          </label>

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
          <label className="flex items-center gap-2 text-sm">
            <span className="text-black/60 dark:text-white/60">Qualidade</span>
            <select
              value={model}
              onChange={(event) =>
                handleModelChange(event.target.value as WhisperModelId)
              }
              disabled={active || whisper.busy}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900"
            >
              {WHISPER_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.sizeLabel}
                </option>
              ))}
            </select>
          </label>

          <p className="-mt-3 max-w-md text-center text-xs text-black/45 dark:text-white/45">
            {selectedModel.description}{" "}
            {!active && !whisper.busy && (
              <button
                type="button"
                onClick={() => whisper.preload(model)}
                className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400"
              >
                Baixar agora
              </button>
            )}
          </p>

          {active && (
            <p className="-mt-1 text-xs text-black/40 dark:text-white/40">
              Pare a gravação para trocar o idioma ou a qualidade.
            </p>
          )}
        </div>
      </section>

      <TranscriptionProgress
        progress={whisper.progress}
        backend={whisper.backend}
        onCancel={whisper.cancel}
      />

      <section className="rounded-2xl border border-black/10 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Transcrição</h2>
            {refined ? (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Whisper {selectedModel.label.split(" — ")[0]}
              </span>
            ) : (
              fullText && (
                <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/50 dark:bg-white/10 dark:text-white/50">
                  Prévia ao vivo
                </span>
              )
            )}
          </div>
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
          {recorder.result && !active && (
            <ActionButton onClick={handleRetranscribe} disabled={whisper.busy}>
              {refined ? "Transcrever de novo" : "Transcrever com Whisper"}
            </ActionButton>
          )}
          <ActionButton onClick={handleCopy} disabled={!fullText}>
            {copied ? "Copiado!" : "Copiar texto"}
          </ActionButton>
          <ActionButton onClick={handleDownloadText} disabled={!fullText}>
            Baixar .txt
          </ActionButton>
          <ActionButton
            onClick={handleClear}
            disabled={active || whisper.busy || (!fullText && !recorder.result)}
          >
            Limpar
          </ActionButton>
        </div>
      </section>

      {recorder.result && !active && (
        <section className="rounded-2xl border border-black/10 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <h2 className="mb-3 truncate text-lg font-semibold">
            {recorder.result.name ?? "Áudio gravado"}
          </h2>
          <audio
            controls
            src={recorder.result.url}
            className="w-full"
            preload="metadata"
          />
          {!recorder.result.name && (
            <div className="mt-4">
              <ActionButton onClick={handleDownloadAudio}>
                Baixar áudio
              </ActionButton>
            </div>
          )}
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
