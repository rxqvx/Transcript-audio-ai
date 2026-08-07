"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from "@/lib/speech";
import { appendChunk } from "@/lib/utils";

/** Erros que fazem parte do funcionamento normal — a sessão apenas reinicia. */
const BENIGN_ERRORS = new Set(["no-speech", "aborted"]);

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Permissão do microfone negada. Libere o acesso nas configurações do navegador e tente de novo.",
  "service-not-allowed":
    "O serviço de reconhecimento de fala foi bloqueado pelo navegador.",
  "audio-capture": "Nenhum microfone foi encontrado neste dispositivo.",
  network:
    "Falha de rede ao falar com o serviço de reconhecimento. Verifique sua conexão.",
  "language-not-supported":
    "Este navegador não reconhece o idioma selecionado. Escolha outro.",
};

/** A disponibilidade da API nunca muda durante a sessão: nada a assinar. */
const subscribeToNothing = () => () => {};

export interface UseSpeechRecognitionResult {
  /** `null` enquanto o suporte não foi verificado (antes da hidratação). */
  supported: boolean | null;
  listening: boolean;
  /** Texto já confirmado pelo reconhecedor. */
  transcript: string;
  /** Trecho provisório, ainda sendo ajustado enquanto você fala. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
  setTranscript: (value: string) => void;
}

/**
 * Transcrição contínua via Web Speech API.
 *
 * O navegador encerra a sessão sozinho depois de alguns segundos de silêncio,
 * então reiniciamos automaticamente enquanto o usuário não mandar parar. Como
 * cada sessão zera o `resultIndex`, o texto confirmado é acumulado por fora.
 */
export function useSpeechRecognition(lang: string): UseSpeechRecognitionResult {
  // O suporte é lido do navegador em vez de virar estado: no servidor a resposta
  // é `null`, o que mantém o HTML igual ao da primeira renderização no cliente.
  const supported = useSyncExternalStore<boolean | null>(
    subscribeToNothing,
    () => getSpeechRecognitionCtor() !== null,
    () => null,
  );

  const [listening, setListening] = useState(false);
  const [transcript, setTranscriptState] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  /** Enquanto `true`, o `onend` do navegador dispara uma nova sessão. */
  const keepAliveRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const langRef = useRef(lang);

  // O idioma só pode ser trocado entre sessões; guardamos o valor mais recente
  // para a próxima chamada de `start`.
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const commitTranscript = useCallback((value: string) => {
    transcriptRef.current = value;
    setTranscriptState(value);
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Este navegador não suporta reconhecimento de fala.");
      return;
    }
    if (recognitionRef.current) return;

    const recognition = new Ctor();
    recognition.lang = langRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let pendingInterim = "";
      let confirmed = transcriptRef.current;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          confirmed = appendChunk(confirmed, text);
        } else {
          pendingInterim = appendChunk(pendingInterim, text);
        }
      }

      if (confirmed !== transcriptRef.current) commitTranscript(confirmed);
      interimRef.current = pendingInterim;
      setInterim(pendingInterim);
    };

    recognition.onerror = (event) => {
      if (BENIGN_ERRORS.has(event.error)) return;
      setError(
        ERROR_MESSAGES[event.error] ??
          `Erro no reconhecimento de fala: ${event.error}`,
      );
      // Erros reais encerram a captura em vez de entrar em loop de reinício.
      keepAliveRef.current = false;
    };

    recognition.onend = () => {
      // O trecho provisório se perde quando a sessão termina; preservamos o que
      // já havia sido reconhecido.
      if (interimRef.current) {
        commitTranscript(appendChunk(transcriptRef.current, interimRef.current));
        interimRef.current = "";
        setInterim("");
      }

      if (!keepAliveRef.current) {
        recognitionRef.current = null;
        setListening(false);
        return;
      }

      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!keepAliveRef.current) return;
        try {
          recognition.start();
        } catch {
          // `InvalidStateError` quando a sessão já voltou sozinha: nada a fazer.
        }
      }, 150);
    };

    recognitionRef.current = recognition;
    keepAliveRef.current = true;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      keepAliveRef.current = false;
      setError("Não foi possível iniciar o reconhecimento de fala.");
    }
  }, [commitTranscript]);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    clearRestartTimer();
    const recognition = recognitionRef.current;
    if (!recognition) {
      setListening(false);
      return;
    }
    // `stop` (e não `abort`) para que o último trecho ainda seja finalizado.
    recognition.stop();
  }, [clearRestartTimer]);

  const reset = useCallback(() => {
    commitTranscript("");
    interimRef.current = "";
    setInterim("");
    setError(null);
  }, [commitTranscript]);

  const setTranscript = useCallback(
    (value: string) => commitTranscript(value),
    [commitTranscript],
  );

  useEffect(() => {
    return () => {
      keepAliveRef.current = false;
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
      }
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
    setTranscript,
  };
}
