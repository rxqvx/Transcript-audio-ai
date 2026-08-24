/**
 * Catálogo de modelos Whisper e o protocolo de mensagens do worker.
 *
 * Este arquivo é importado pelo worker e pela interface, então não pode tocar
 * em `window` nem em nada específico do DOM.
 */

export type WhisperModelId = "base" | "small" | "turbo";

export interface WhisperModel {
  id: WhisperModelId;
  /** Repositório no Hugging Face Hub. */
  repo: string;
  label: string;
  /** Tamanho aproximado do download, já considerando as quantizações usadas. */
  sizeLabel: string;
  description: string;
}

/**
 * Três pontos da curva tamanho × acurácia.
 *
 * As quantizações são escolhidas no worker conforme o backend disponível: o
 * `q4f16` do turbo só funciona onde a GPU expõe `shader-f16`.
 */
export const WHISPER_MODELS: readonly WhisperModel[] = [
  {
    id: "base",
    repo: "onnx-community/whisper-base",
    label: "Base — rápido",
    sizeLabel: "~200 MB",
    description:
      "Bom para conversas claras e áudio curto. Erra mais em nomes próprios e sotaques carregados.",
  },
  {
    id: "small",
    repo: "onnx-community/whisper-small",
    label: "Small — equilibrado",
    sizeLabel: "~410 MB",
    description:
      "Salto grande de qualidade em português. É a escolha padrão quando não há GPU sobrando.",
  },
  {
    id: "turbo",
    repo: "onnx-community/whisper-large-v3-turbo",
    label: "Large v3 Turbo — melhor",
    sizeLabel: "~570 MB",
    description:
      "A melhor transcrição que roda no navegador. Exige WebGPU e alguns GB de memória de vídeo.",
  },
] as const;

export function findModel(id: WhisperModelId): WhisperModel {
  const model = WHISPER_MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Modelo desconhecido: ${id}`);
  return model;
}

/**
 * Converte a tag BCP-47 do seletor de idioma no código que o Whisper entende.
 *
 * O modelo não distingue variantes regionais: pt-BR e pt-PT são o mesmo `pt`.
 */
export function toWhisperLanguage(bcp47: string): string {
  return bcp47.split("-")[0]!.toLowerCase();
}

export interface TranscriptChunk {
  /** Início e fim em segundos, relativos ao áudio completo. */
  timestamp: [number, number | null];
  text: string;
}

/** Backend em que o modelo acabou rodando. */
export type WhisperBackend = "webgpu" | "wasm";

export type WhisperRequest =
  | { type: "load"; model: WhisperModelId }
  | {
      type: "transcribe";
      requestId: number;
      model: WhisperModelId;
      language: string;
      /** PCM mono 16 kHz do áudio inteiro (transferido, não copiado). */
      pcm: Float32Array;
    }
  | { type: "cancel" };

export type WhisperResponse =
  /** Onde a inferência realmente subiu, já depois de escolher a configuração. */
  | { type: "backend"; backend: WhisperBackend }
  /** Progresso do download do modelo, de 0 a 100. */
  | { type: "download"; progress: number; loadedMB: number; totalMB: number }
  | { type: "ready"; model: WhisperModelId }
  /** Uma fatia começou a ser processada. */
  | { type: "segment"; index: number; total: number }
  /** Texto saindo do decoder, para mostrar o progresso acontecendo. */
  | { type: "partial"; text: string }
  | { type: "done"; requestId: number; text: string }
  | { type: "cancelled"; requestId: number }
  | { type: "error"; message: string };
