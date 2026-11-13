"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { decodeToMono16k } from "@/lib/audio";
import {
  toWhisperLanguage,
  type WhisperBackend,
  type WhisperModelId,
  type WhisperRequest,
  type WhisperResponse,
} from "@/lib/whisper";

export type WhisperStage =
  | "idle"
  /** Convertendo o blob gravado em PCM 16 kHz na thread principal. */
  | "decoding"
  | "downloading"
  /** Modelo baixado, montando as sessões de inferência. */
  | "preparing"
  | "transcribing";

export interface WhisperProgress {
  stage: WhisperStage;
  /** 0–100 durante o download do modelo; `null` fora dele. */
  downloadPercent: number | null;
  downloadedMB: number;
  totalMB: number;
  /** Fatia em processamento e quantas existem no total. */
  segment: number;
  segments: number;
  /** Texto saindo do decoder agora, só para dar sinal de vida. */
  partial: string;
}

const IDLE: WhisperProgress = {
  stage: "idle",
  downloadPercent: null,
  downloadedMB: 0,
  totalMB: 0,
  segment: 0,
  segments: 0,
  partial: "",
};

export interface UseWhisperResult {
  progress: WhisperProgress;
  /** `true` entre o início da decodificação e o resultado final. */
  busy: boolean;
  backend: WhisperBackend | null;
  error: string | null;
  /** Baixa e prepara o modelo sem transcrever nada. */
  preload: (model: WhisperModelId) => void;
  /** Resolve com o texto, ou `null` se foi cancelada ou falhou. */
  transcribe: (
    blob: Blob,
    options: { model: WhisperModelId; language: string },
  ) => Promise<string | null>;
  cancel: () => void;
  clearError: () => void;
}

/**
 * Transcrição com Whisper rodando dentro do navegador.
 *
 * O worker é criado só na primeira vez que alguém precisa dele — assim o bundle
 * do Transformers.js não entra no carregamento inicial da página.
 */
export function useWhisper(): UseWhisperResult {
  const [progress, setProgress] = useState<WhisperProgress>(IDLE);
  const [backend, setBackend] = useState<WhisperBackend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  /** Resolve a promessa de `transcribe` quando o worker responde. */
  const pendingRef = useRef<{
    id: number;
    resolve: (text: string | null) => void;
  } | null>(null);

  const settle = useCallback(
    (id: number, apply: (pending: NonNullable<typeof pendingRef.current>) => void) => {
      const pending = pendingRef.current;
      // Respostas de uma transcrição já cancelada chegam atrasadas: ignoramos.
      if (!pending || pending.id !== id) return;
      pendingRef.current = null;
      setBusy(false);
      setProgress(IDLE);
      apply(pending);
    },
    [],
  );

  const getWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(
      new URL("../workers/whisper.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.addEventListener(
      "message",
      (event: MessageEvent<WhisperResponse>) => {
        const message = event.data;
        switch (message.type) {
          case "backend":
            setBackend(message.backend);
            break;
          case "download":
            setProgress((current) => ({
              ...current,
              stage: "downloading",
              downloadPercent: message.progress,
              downloadedMB: message.loadedMB,
              totalMB: message.totalMB,
            }));
            break;
          case "ready":
            setProgress((current) => ({
              ...current,
              stage: current.stage === "idle" ? "idle" : "preparing",
              downloadPercent: null,
            }));
            break;
          case "segment":
            setProgress((current) => ({
              ...current,
              stage: "transcribing",
              downloadPercent: null,
              segment: message.index + 1,
              segments: message.total,
              // Cada fatia recomeça o texto provisório do zero.
              partial: "",
            }));
            break;
          case "partial":
            setProgress((current) => ({
              ...current,
              partial: current.partial + message.text,
            }));
            break;
          case "done":
            settle(message.requestId, (pending) => pending.resolve(message.text));
            break;
          case "cancelled":
            settle(message.requestId, (pending) => pending.resolve(null));
            break;
          case "error": {
            setError(message.message);
            const pending = pendingRef.current;
            if (pending) settle(pending.id, (p) => p.resolve(null));
            else setProgress(IDLE);
            break;
          }
        }
      },
    );

    worker.addEventListener("error", (event) => {
      setError(event.message || "Falha ao carregar o motor de transcrição.");
      const pending = pendingRef.current;
      if (pending) settle(pending.id, (p) => p.resolve(null));
    });

    workerRef.current = worker;
    return worker;
  }, [settle]);

  const send = useCallback(
    (request: WhisperRequest, transfer: Transferable[] = []) => {
      getWorker().postMessage(request, transfer);
    },
    [getWorker],
  );

  const preload = useCallback(
    (model: WhisperModelId) => {
      setError(null);
      send({ type: "load", model });
    },
    [send],
  );

  const transcribe = useCallback(
    async (
      blob: Blob,
      { model, language }: { model: WhisperModelId; language: string },
    ): Promise<string | null> => {
      setError(null);
      setBusy(true);
      setProgress({ ...IDLE, stage: "decoding" });

      let pcm: Float32Array;
      try {
        pcm = await decodeToMono16k(blob);
      } catch {
        setBusy(false);
        setProgress(IDLE);
        setError("Não foi possível ler este áudio. Tente MP3, WAV, M4A, OGG ou WebM.");
        return null;
      }

      if (pcm.length === 0) {
        setBusy(false);
        setProgress(IDLE);
        return "";
      }

      setProgress((current) => ({ ...current, stage: "preparing" }));

      const id = (requestIdRef.current += 1);
      return new Promise<string | null>((resolve) => {
        pendingRef.current = { id, resolve };
        // O buffer é transferido: sai da thread principal sem cópia, o que
        // importa quando uma hora de áudio ocupa mais de 100 MB.
        send(
          {
            type: "transcribe",
            requestId: id,
            model,
            language: toWhisperLanguage(language),
            pcm,
          },
          [pcm.buffer as ArrayBuffer],
        );
      });
    },
    [send],
  );

  const cancel = useCallback(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "cancel" } satisfies WhisperRequest);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return {
    progress,
    busy,
    backend,
    error,
    preload,
    transcribe,
    cancel,
    clearError,
  };
}
