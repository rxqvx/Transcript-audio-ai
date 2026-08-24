/**
 * Limpeza do texto que sai do Whisper.
 *
 * Duas coisas atrapalham a leitura de uma transcrição longa: os laços de
 * repetição que o modelo produz quando o áudio fica em silêncio ou muito
 * abafado, e o parágrafo único de quarenta minutos. Os dois são resolvidos
 * aqui, depois da inferência.
 */

import type { TranscriptChunk } from "@/lib/whisper";

/** Maior sequência de palavras testada ao procurar repetições. */
const MAX_NGRAM = 10;

/** Uma palavra sozinha pode se repetir de verdade; três já é padrão claro. */
const MIN_REPEATS_SINGLE = 4;
const MIN_REPEATS_PHRASE = 3;

/** Compara ignorando caixa e pontuação, que variam entre as repetições. */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function rangesMatch(
  words: string[],
  a: number,
  b: number,
  length: number,
): boolean {
  for (let i = 0; i < length; i += 1) {
    if (normalizeWord(words[a + i]) !== normalizeWord(words[b + i])) {
      return false;
    }
  }
  return true;
}

/**
 * Reduz repetições consecutivas a uma única ocorrência.
 *
 * `"obrigado obrigado obrigado obrigado"` vira `"obrigado"`; uma frase inteira
 * repetida três vezes seguidas vira uma. Repetições legítimas ("muito, muito
 * bom") passam porque exigem quatro ocorrências para serem cortadas.
 */
export function collapseRepetitions(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return text.trim();

  const kept: string[] = [];
  let i = 0;

  while (i < words.length) {
    let collapsed = false;

    for (let n = 1; n <= MAX_NGRAM && i + 2 * n <= words.length; n += 1) {
      let repeats = 1;
      while (
        i + (repeats + 1) * n <= words.length &&
        rangesMatch(words, i, i + repeats * n, n)
      ) {
        repeats += 1;
      }

      const minimum = n === 1 ? MIN_REPEATS_SINGLE : MIN_REPEATS_PHRASE;
      if (repeats >= minimum) {
        kept.push(...words.slice(i, i + n));
        i += repeats * n;
        collapsed = true;
        break;
      }
    }

    if (!collapsed) {
      kept.push(words[i]);
      i += 1;
    }
  }

  return kept.join(" ");
}

/** Pausa a partir da qual um novo parágrafo começa. */
const PARAGRAPH_GAP_SEC = 1.6;
/** Depois disso quebramos no primeiro fim de frase, mesmo sem pausa longa. */
const PARAGRAPH_MAX_SEC = 45;

function endsSentence(text: string): boolean {
  return /[.!?…][)"'”’]?$/.test(text.trimEnd());
}

/**
 * Monta o texto final a partir dos trechos com timestamp.
 *
 * As pausas do próprio áudio viram as quebras de parágrafo, o que costuma
 * corresponder às trocas de assunto de quem está falando.
 */
export function formatChunks(chunks: TranscriptChunk[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let paragraphStart: number | null = null;
  let previousEnd: number | null = null;

  const flush = () => {
    if (current.length === 0) return;
    paragraphs.push(collapseRepetitions(current.join(" ")));
    current = [];
    paragraphStart = null;
  };

  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;

    const [start, end] = chunk.timestamp;
    const gap = previousEnd === null ? 0 : start - previousEnd;
    const elapsed = paragraphStart === null ? 0 : start - paragraphStart;

    const shouldBreak =
      current.length > 0 &&
      (gap >= PARAGRAPH_GAP_SEC ||
        (elapsed >= PARAGRAPH_MAX_SEC && endsSentence(current.at(-1)!)));

    if (shouldBreak) flush();

    if (paragraphStart === null) paragraphStart = start;
    current.push(text);
    previousEnd = end ?? start;
  }

  flush();
  return paragraphs.filter(Boolean).join("\n\n");
}

/** Desloca os timestamps de uma fatia para a linha do tempo do áudio inteiro. */
export function offsetChunks(
  chunks: TranscriptChunk[],
  offsetSec: number,
): TranscriptChunk[] {
  if (offsetSec === 0) return chunks;
  return chunks.map(({ timestamp: [start, end], text }) => ({
    timestamp: [start + offsetSec, end === null ? null : end + offsetSec] as [
      number,
      number | null,
    ],
    text,
  }));
}
