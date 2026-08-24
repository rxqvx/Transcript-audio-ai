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

/**
 * `network` é transitório: o serviço do navegador cai e volta o tempo todo em
 * gravações longas. Só vira mensagem de erro depois de insistir algumas vezes.
 */
const RETRYABLE_ERRORS = new Set(["network", "audio-capture"]);
const MAX_RETRIES = 4;

/** Sem nenhum sinal de vida por esse tempo, a sessão travou e é reiniciada. */
const WATCHDOG_MS = 20_000;
const WATCHDOG_TICK_MS = 4_000;

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
 * Prévia em tempo real via Web Speech API.
 *
 * O navegador encerra a sessão sozinho depois de alguns segundos de silêncio,
 * então reiniciamos automaticamente enquanto o usuário não mandar parar.
 *
 * O texto confirmado é montado a partir de um vetor indexado pelo `resultIndex`
 * da sessão, e não concatenado direto. O Chrome reenvia resultados já
 * finalizados quando revisa a interpretação — concatenar cegamente a partir do
 * `resultIndex` faz esses trechos aparecerem duas vezes, que é o defeito mais
 * visível numa gravação longa.
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
  /** Texto fechado das sessões anteriores. */
  const baseRef = useRef("");
  /** Resultados finais da sessão atual, na posição do respectivo `resultIndex`. */
  const finalsRef = useRef<string[]>([]);
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  /** Enquanto `true`, o `onend` do navegador dispara uma nova sessão. */
  const keepAliveRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const lastSignalRef = useRef(0);
  const retriesRef = useRef(0);
  const langRef = useRef(lang);

  // O idioma só pode ser trocado entre sessões; guardamos o valor mais recente
  // para a próxima chamada de `start`.
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  /** Reconstrói o texto a partir da base mais os finais da sessão atual. */
  const publishTranscript = useCallback(() => {
    let text = baseRef.current;
    for (const piece of finalsRef.current) {
      if (piece) text = appendChunk(text, piece);
    }
    if (text !== transcriptRef.current) {
      transcriptRef.current = text;
      setTranscriptState(text);
    }
  }, []);

  /** Fecha a sessão atual: o que ela reconheceu passa a fazer parte da base. */
  const foldSession = useCallback(() => {
    baseRef.current = transcriptRef.current;
    finalsRef.current = [];
  }, []);

  const clearTimers = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (watchdogRef.current !== null) {
      window.clearInterval(watchdogRef.current);
      watchdogRef.current = null;
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

    const markSignal = () => {
      lastSignalRef.current = Date.now();
    };

    recognition.onstart = () => {
      markSignal();
      // A sessão subiu: o contador de tentativas volta a zero.
      retriesRef.current = 0;
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      markSignal();
      let pendingInterim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        // Gravar na posição do índice em vez de concatenar deixa a revisão de
        // um trecho substituir a versão anterior, em vez de duplicá-la.
        if (result.isFinal) finalsRef.current[i] = text;
        else pendingInterim = appendChunk(pendingInterim, text);
      }

      publishTranscript();
      interimRef.current = pendingInterim;
      setInterim(pendingInterim);
    };

    recognition.onerror = (event) => {
      markSignal();
      if (BENIGN_ERRORS.has(event.error)) return;

      if (RETRYABLE_ERRORS.has(event.error) && retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1;
        return;
      }

      setError(
        ERROR_MESSAGES[event.error] ??
          `Erro no reconhecimento de fala: ${event.error}`,
      );
      // Erros reais encerram a captura em vez de entrar em loop de reinício.
      keepAliveRef.current = false;
    };

    recognition.onend = () => {
      markSignal();

      // O trecho provisório se perde quando a sessão termina; preservamos o que
      // já havia sido reconhecido antes de fechar o vetor de finais.
      if (interimRef.current) {
        transcriptRef.current = appendChunk(
          transcriptRef.current,
          interimRef.current,
        );
        setTranscriptState(transcriptRef.current);
        interimRef.current = "";
        setInterim("");
      }
      foldSession();

      if (!keepAliveRef.current) {
        clearTimers();
        recognitionRef.current = null;
        setListening(false);
        return;
      }

      // O reinício é imediato: cada milissegundo entre sessões é fala que o
      // reconhecedor não ouve. O atraso só cresce se `start` estiver falhando.
      const delay = retriesRef.current === 0 ? 0 : 250 * 2 ** (retriesRef.current - 1);
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!keepAliveRef.current) return;
        try {
          recognition.start();
        } catch {
          // `InvalidStateError` quando a sessão já voltou sozinha; qualquer
          // outra falha entra no recuo progressivo do próximo `onend`.
          retriesRef.current = Math.min(retriesRef.current + 1, MAX_RETRIES);
        }
      }, delay);
    };

    recognitionRef.current = recognition;
    keepAliveRef.current = true;
    retriesRef.current = 0;
    lastSignalRef.current = Date.now();

    // O Chrome às vezes para de emitir eventos sem nunca chamar `onend`. Nesse
    // caso o `abort` força o ciclo de reinício que devolve a transcrição.
    watchdogRef.current = window.setInterval(() => {
      if (!keepAliveRef.current) return;
      if (Date.now() - lastSignalRef.current < WATCHDOG_MS) return;
      lastSignalRef.current = Date.now();
      recognitionRef.current?.abort();
    }, WATCHDOG_TICK_MS);

    try {
      recognition.start();
    } catch {
      clearTimers();
      recognitionRef.current = null;
      keepAliveRef.current = false;
      setError("Não foi possível iniciar o reconhecimento de fala.");
    }
  }, [clearTimers, foldSession, publishTranscript]);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    clearTimers();
    const recognition = recognitionRef.current;
    if (!recognition) {
      setListening(false);
      return;
    }
    // `stop` (e não `abort`) para que o último trecho ainda seja finalizado.
    recognition.stop();
  }, [clearTimers]);

  const commit = useCallback(
    (value: string) => {
      baseRef.current = value;
      finalsRef.current = [];
      transcriptRef.current = value;
      setTranscriptState(value);
    },
    [],
  );

  const reset = useCallback(() => {
    commit("");
    interimRef.current = "";
    setInterim("");
    setError(null);
  }, [commit]);

  useEffect(() => {
    return () => {
      keepAliveRef.current = false;
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
      }
      if (watchdogRef.current !== null) {
        window.clearInterval(watchdogRef.current);
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
    setTranscript: commit,
  };
}
