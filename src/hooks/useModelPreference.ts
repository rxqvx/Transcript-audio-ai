"use client";

import { useCallback, useSyncExternalStore } from "react";

import { WHISPER_MODELS, type WhisperModelId } from "@/lib/whisper";

const STORAGE_KEY = "transcript-audio-ai:model";

/** Meio-termo entre tamanho de download e acurácia. */
const DEFAULT_MODEL: WhisperModelId = "small";

const listeners = new Set<() => void>();

function isModelId(value: string | null): value is WhisperModelId {
  return WHISPER_MODELS.some((model) => model.id === value);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Outra aba pode trocar a preferência; o evento `storage` avisa esta aqui.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(): WhisperModelId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isModelId(stored) ? stored : DEFAULT_MODEL;
  } catch {
    // Modo anônimo com armazenamento bloqueado: seguimos com o padrão.
    return DEFAULT_MODEL;
  }
}

/**
 * Modelo escolhido pelo usuário, preservado entre visitas.
 *
 * O valor vem de um store externo em vez de `useState` + efeito porque o
 * servidor não enxerga o `localStorage`: renderizar o padrão e só então
 * corrigir causaria diferença de hidratação. `useSyncExternalStore` devolve o
 * padrão no servidor e o valor guardado no cliente, sem passo intermediário.
 */
export function useModelPreference(): [
  WhisperModelId,
  (value: WhisperModelId) => void,
] {
  const model = useSyncExternalStore(subscribe, read, () => DEFAULT_MODEL);

  const setModel = useCallback((value: WhisperModelId) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Sem persistência a escolha ainda vale para esta sessão.
    }
    for (const listener of listeners) listener();
  }, []);

  return [model, setModel];
}
