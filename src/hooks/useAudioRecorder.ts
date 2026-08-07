"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface Recording {
  url: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface UseAudioRecorderResult {
  recording: boolean;
  /** Tempo decorrido da gravação em andamento. */
  elapsedMs: number;
  /** Última gravação finalizada, pronta para ouvir ou baixar. */
  result: Recording | null;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
  clear: () => void;
  /** Nó de análise para o visualizador; `null` fora de uma gravação. */
  getAnalyser: () => AnalyserNode | null;
}

/**
 * Captura o microfone com `MediaRecorder` e expõe um `AnalyserNode` para o
 * visualizador. O áudio fica só na memória do navegador — nada é enviado.
 */
export function useAudioRecorder(): UseAudioRecorderResult {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  const releaseAudioGraph = useCallback(() => {
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return true;
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite acesso ao microfone.");
      return false;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Permissão do microfone negada. Libere o acesso e tente de novo."
          : name === "NotFoundError"
            ? "Nenhum microfone foi encontrado neste dispositivo."
            : "Não foi possível acessar o microfone.",
      );
      return false;
    }

    streamRef.current = stream;

    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
    } catch {
      // Sem visualizador o resto da gravação continua funcionando.
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseAudioGraph();
      setError("Este navegador não consegue gravar áudio (MediaRecorder).");
      return false;
    }

    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];

      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;

      setResult({
        url,
        blob,
        mimeType: type,
        durationMs: Date.now() - startedAtRef.current,
      });
      setRecording(false);
      recorderRef.current = null;
      releaseAudioGraph();
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    // Blocos periódicos evitam perder tudo se a aba for encerrada no meio.
    recorder.start(500);
    setRecording(true);

    tickRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);

    return true;
  }, [releaseAudioGraph]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return;
    }
    recorder.stop();
  }, []);

  const clear = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setResult(null);
    setElapsedMs(0);
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.stream
        ?.getTracks()
        .forEach((track) => track.stop());
      recorderRef.current = null;
      releaseAudioGraph();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, [releaseAudioGraph]);

  return {
    recording,
    elapsedMs,
    result,
    error,
    start,
    stop,
    clear,
    getAnalyser: () => analyserRef.current,
  };
}
