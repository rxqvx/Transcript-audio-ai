/**
 * Preparo do áudio para o Whisper.
 *
 * O modelo espera PCM mono em 16 kHz, e o `MediaRecorder` entrega webm/opus a
 * 48 kHz estéreo — então decodificamos, reamostramos e mixamos aqui. Áudio
 * longo também precisa ser fatiado antes de ir para o modelo, e o corte é
 * escolhido no ponto mais silencioso disponível para nunca partir uma palavra
 * ao meio.
 */

/** Taxa de amostragem exigida pelo Whisper. */
export const SAMPLE_RATE = 16_000;

/** Quadro de 30 ms usado na análise de energia que guia os cortes. */
const FRAME_SIZE = 480;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const ctor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (window as unknown as { webkitAudioContext?: AudioContextCtor })
          .webkitAudioContext;
  if (!ctor) throw new Error("Este navegador não tem a Web Audio API.");
  return ctor;
}

/** Mixa todos os canais em um só, somando e dividindo pela quantidade. */
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    // `getChannelData` devolve a view interna do buffer; copiamos porque o
    // resultado é transferido para o worker (o que neutralizaria o original).
    return new Float32Array(buffer.getChannelData(0));
  }

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < mono.length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    mono[i] = sum / channels.length;
  }
  return mono;
}

/** Reamostra para 16 kHz mono quando o navegador ignorou a taxa pedida. */
async function resampleTo16k(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.ceil((buffer.duration * SAMPLE_RATE) | 0) || 1;
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

/**
 * Decodifica um blob gravado para PCM mono 16 kHz.
 *
 * Pedimos o `AudioContext` já em 16 kHz porque aí a reamostragem acontece
 * durante a decodificação: uma gravação de uma hora ocupa ~115 MB em vez dos
 * ~1,4 GB que os 48 kHz estéreo originais exigiriam.
 */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const Ctor = getAudioContextCtor();
  const bytes = await blob.arrayBuffer();

  let context: AudioContext;
  try {
    context = new Ctor({ sampleRate: SAMPLE_RATE });
  } catch {
    // Alguns navegadores recusam taxas fora do intervalo do hardware.
    context = new Ctor();
  }

  try {
    const decoded = await context.decodeAudioData(bytes);
    return decoded.sampleRate === SAMPLE_RATE
      ? toMono(decoded)
      : await resampleTo16k(decoded);
  } finally {
    void context.close().catch(() => {});
  }
}

export interface AudioSegment {
  /** Índice da primeira amostra (inclusivo). */
  start: number;
  /** Índice logo após a última amostra. */
  end: number;
}

/** Energia RMS por quadro de 30 ms — o mapa de "onde está o silêncio". */
function frameEnergies(pcm: Float32Array): Float32Array {
  const count = Math.ceil(pcm.length / FRAME_SIZE);
  const energies = new Float32Array(count);
  for (let frame = 0; frame < count; frame += 1) {
    const start = frame * FRAME_SIZE;
    const end = Math.min(start + FRAME_SIZE, pcm.length);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += pcm[i] * pcm[i];
    energies[frame] = Math.sqrt(sum / (end - start || 1));
  }
  return energies;
}

export interface PlanSegmentsOptions {
  /** Duração desejada de cada fatia. */
  targetSec?: number;
  /** Quanto podemos afastar do alvo procurando uma pausa. */
  searchSec?: number;
}

/**
 * Divide o áudio em fatias grandes cortadas em pontos de silêncio.
 *
 * O pipeline do Transformers.js já quebra cada fatia em janelas de 30 s com
 * sobreposição e costura o resultado, mas ele monta *todas* as janelas na
 * memória antes de gerar. Fatiar antes mantém o consumo constante e ainda dá o
 * progresso parcial que a interface mostra. Como o corte cai numa pausa, nada
 * se perde na emenda entre fatias.
 */
export function planSegments(
  pcm: Float32Array,
  { targetSec = 240, searchSec = 20 }: PlanSegmentsOptions = {},
): AudioSegment[] {
  const target = Math.floor(targetSec * SAMPLE_RATE);
  const search = Math.floor(searchSec * SAMPLE_RATE);

  // Um áudio que cabe em uma fatia (com folga) não precisa de corte nenhum.
  if (pcm.length <= target + search) return [{ start: 0, end: pcm.length }];

  const energies = frameEnergies(pcm);
  const segments: AudioSegment[] = [];
  let start = 0;

  while (start < pcm.length) {
    const boundary = start + target;

    // O que sobra até o fim já é curto o bastante: vira a última fatia inteira
    // em vez de gerar um pedacinho solto.
    if (pcm.length - boundary <= search) {
      segments.push({ start, end: pcm.length });
      break;
    }

    const from = Math.floor(Math.max(start + 1, boundary - search) / FRAME_SIZE);
    const to = Math.floor(Math.min(pcm.length - 1, boundary + search) / FRAME_SIZE);

    let quietest = from;
    for (let frame = from; frame <= to; frame += 1) {
      if (energies[frame] < energies[quietest]) quietest = frame;
    }

    // O corte vai no meio do quadro mais silencioso da janela de busca.
    const cut = Math.min(quietest * FRAME_SIZE + FRAME_SIZE / 2, pcm.length);
    segments.push({ start, end: cut });
    start = cut;
  }

  return segments;
}
