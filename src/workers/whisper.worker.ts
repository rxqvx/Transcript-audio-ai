/// <reference lib="webworker" />

/**
 * Worker de transcrição.
 *
 * A inferência do Whisper trava a thread em que roda por vários segundos
 * seguidos, então ela mora aqui: a interface continua respondendo, o
 * visualizador continua animando e o progresso chega por mensagem.
 */

import {
  InterruptableStoppingCriteria,
  WhisperTextStreamer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type WhisperTokenizer,
} from "@huggingface/transformers";

import { SAMPLE_RATE, planSegments } from "@/lib/audio";
import { formatChunks, offsetChunks } from "@/lib/transcript";
import {
  findModel,
  type TranscriptChunk,
  type WhisperBackend,
  type WhisperModelId,
  type WhisperRequest,
  type WhisperResponse,
} from "@/lib/whisper";

// Os modelos vêm do Hugging Face Hub; não há cópia local para procurar.
env.allowLocalModels = false;

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WhisperResponse) {
  scope.postMessage(message);
}

/** Janela do Whisper e sobreposição entre janelas, ambas em segundos. */
const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

/** Intervalo entre envios do texto provisório para a interface. */
const PARTIAL_FLUSH_MS = 150;

/**
 * Junta os tokens do decoder e envia em lotes.
 *
 * O streamer dispara a cada token gerado; repassar cada um viraria milhares de
 * `postMessage` e outras tantas renderizações do React por trecho, o que
 * consome mais do que a própria inferência.
 */
function createPartialSink() {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!buffer) return;
    post({ type: "partial", text: buffer });
    buffer = "";
  };

  return {
    push(text: string) {
      buffer += text;
      timer ??= setTimeout(flush, PARTIAL_FLUSH_MS);
    },
    close() {
      if (timer !== null) clearTimeout(timer);
      flush();
    },
  };
}

/**
 * Só precisamos saber se a GPU existe e se ela tem `shader-f16`; o resto da
 * WebGPU não é usado aqui, e `lib.dom` ainda não traz essas tipagens.
 */
type WebGpuLike = {
  requestAdapter(): Promise<{ features: ReadonlySet<string> } | null>;
};

interface Backend {
  device: WhisperBackend;
  fp16: boolean;
}

let backendPromise: Promise<Backend> | null = null;

/**
 * Descobre onde a inferência vai rodar.
 *
 * O `shader-f16` decide entre as quantizações `q4f16` e `q4`: sem ele o
 * download fica maior, mas o modelo continua funcionando.
 */
function detectBackend(): Promise<Backend> {
  backendPromise ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: WebGpuLike }).gpu;
    if (!gpu) return { device: "wasm", fp16: false } satisfies Backend;
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return { device: "wasm", fp16: false } satisfies Backend;
      return {
        device: "webgpu",
        fp16: adapter.features.has("shader-f16"),
      } satisfies Backend;
    } catch {
      return { device: "wasm", fp16: false } satisfies Backend;
    }
  })();
  return backendPromise;
}

type Dtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

interface Attempt {
  device: WhisperBackend;
  encoder_model: Dtype;
  decoder_model_merged: Dtype;
}

/**
 * Últimos recursos, na CPU.
 *
 * O `q8` do decoder é recusado pelo ONNX Runtime em alguns modelos, então o
 * `q4` vem antes; o `fp32` é lento mas nunca depende de quantização.
 */
const WASM_ATTEMPTS: Attempt[] = [
  { device: "wasm", encoder_model: "q8", decoder_model_merged: "q4" },
  { device: "wasm", encoder_model: "q8", decoder_model_merged: "fp32" },
];

/**
 * Configurações a tentar, da melhor para a mais conservadora.
 *
 * Nem toda combinação de quantização sobe em todo lugar: o ONNX Runtime recusa
 * alguns arquivos conforme o backend, o modelo e a própria versão dele, e não
 * dá para saber qual antes de tentar. Em vez de apostar numa só, descemos a
 * lista até uma sessão ser criada — no fim sempre está o WASM, que roda em
 * qualquer navegador.
 *
 * O encoder pesa muito mais que o decoder, então é nele que a escolha da
 * quantização decide o tamanho do download.
 */
function planAttempts(
  model: WhisperModelId,
  { device, fp16 }: Backend,
): Attempt[] {
  if (device !== "webgpu") return WASM_ATTEMPTS;

  const preferred: Attempt[] = [];

  if (model === "base") {
    // Pequeno o bastante para manter o encoder em precisão total.
    preferred.push({ device, encoder_model: "fp32", decoder_model_merged: "q4" });
  } else if (model === "small") {
    if (fp16) {
      preferred.push({ device, encoder_model: "fp16", decoder_model_merged: "q4" });
    }
    preferred.push({ device, encoder_model: "fp32", decoder_model_merged: "q4" });
  } else {
    if (fp16) {
      preferred.push({
        device,
        encoder_model: "q4f16",
        decoder_model_merged: "q4f16",
      });
    }
    preferred.push({ device, encoder_model: "q4", decoder_model_merged: "q4" });
  }

  return [...preferred, ...WASM_ATTEMPTS];
}

interface LoadedPipeline {
  model: WhisperModelId;
  transcriber: AutomaticSpeechRecognitionPipeline;
}

let loaded: LoadedPipeline | null = null;
let loading: Promise<LoadedPipeline> | null = null;
let loadingModel: WhisperModelId | null = null;

const toMB = (bytes: number) => Math.round(bytes / 1e6);

async function getPipeline(id: WhisperModelId): Promise<LoadedPipeline> {
  if (loaded?.model === id) return loaded;
  if (loading && loadingModel === id) return loading;

  // Trocar de modelo libera a memória do anterior antes de baixar o novo.
  if (loaded) {
    await loaded.transcriber.dispose().catch(() => {});
    loaded = null;
  }

  loadingModel = id;
  loading = (async () => {
    const backend = await detectBackend();
    const attempts = planAttempts(id, backend);
    const repo = findModel(id).repo;
    let lastError: unknown;

    for (const { device, ...dtype } of attempts) {
      try {
        const transcriber = await pipeline(
          "automatic-speech-recognition",
          repo,
          {
            device,
            dtype,
            progress_callback: (info) => {
              // `progress_total` já agrega todos os arquivos do modelo.
              if (info.status !== "progress_total") return;
              post({
                type: "download",
                progress: Math.min(100, Math.round(info.progress)),
                loadedMB: toMB(info.loaded),
                totalMB: toMB(info.total),
              });
            },
          },
        );

        // Só agora sabemos onde a inferência realmente vai rodar.
        post({ type: "backend", backend: device });
        const result: LoadedPipeline = { model: id, transcriber };
        loaded = result;
        post({ type: "ready", model: id });
        return result;
      } catch (cause) {
        lastError = cause;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Não foi possível carregar o modelo de transcrição.");
  })();

  try {
    return await loading;
  } finally {
    loading = null;
    loadingModel = null;
  }
}

let stopper: InterruptableStoppingCriteria | null = null;
let cancelled = false;

async function transcribe(
  request: Extract<WhisperRequest, { type: "transcribe" }>,
) {
  const { requestId, pcm, language } = request;
  const { transcriber } = await getPipeline(request.model);

  const segments = planSegments(pcm);
  const collected: TranscriptChunk[] = [];
  stopper = new InterruptableStoppingCriteria();

  try {
    for (const [index, segment] of segments.entries()) {
      if (cancelled) return post({ type: "cancelled", requestId });
      post({ type: "segment", index, total: segments.length });

      // `subarray` compartilha a memória do PCM: nada é copiado por fatia.
      const audio = pcm.subarray(segment.start, segment.end);

      // O streamer existe só para a interface: ele mostra o texto saindo do
      // decoder, enquanto o resultado que vale é o retorno do pipeline.
      const partials = createPartialSink();
      const streamer = new WhisperTextStreamer(
        transcriber.tokenizer as WhisperTokenizer,
        {
          skip_prompt: true,
          callback_function: (text) => {
            if (!cancelled) partials.push(text);
          },
        },
      );

      let output;
      try {
        output = await transcriber(audio, {
          // O pipeline quebra a fatia em janelas de 30 s com 5 s de
          // sobreposição e costura as bordas comparando os timestamps — é isso
          // que evita a palavra cortada na emenda, o defeito que mais estraga
          // transcrição de áudio longo.
          chunk_length_s: CHUNK_LENGTH_S,
          stride_length_s: STRIDE_LENGTH_S,
          // Sem timestamps não existe costura entre janelas nem parágrafo.
          return_timestamps: true,
          // Fixar o idioma evita a deriva clássica do Whisper, que troca de
          // língua no meio de uma gravação longa e traduz o resto.
          language,
          task: "transcribe",
          streamer,
          stopping_criteria: stopper,
        });
      } finally {
        partials.close();
      }

      if (cancelled) return post({ type: "cancelled", requestId });
      collected.push(
        ...offsetChunks(
          (output.chunks ?? []) as TranscriptChunk[],
          segment.start / SAMPLE_RATE,
        ),
      );
    }
  } finally {
    stopper = null;
  }

  post({ type: "done", requestId, text: formatChunks(collected) });
}

scope.addEventListener("message", (event: MessageEvent<WhisperRequest>) => {
  const request = event.data;

  if (request.type === "cancel") {
    cancelled = true;
    stopper?.interrupt();
    return;
  }

  cancelled = false;

  const work =
    request.type === "load"
      ? getPipeline(request.model).then(() => undefined)
      : transcribe(request);

  void work.catch((cause: unknown) => {
    post({
      type: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  });
});
