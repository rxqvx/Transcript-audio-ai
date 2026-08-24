import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_RATE, planSegments } from "./audio.ts";

/** Sinal contínuo com trechos zerados nos intervalos (em segundos) dados. */
function buildAudio(durationSec: number, silences: [number, number][]) {
  const pcm = new Float32Array(durationSec * SAMPLE_RATE);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin(i / 12) * 0.4;
  for (const [from, to] of silences) {
    pcm.fill(0, from * SAMPLE_RATE, to * SAMPLE_RATE);
  }
  return pcm;
}

test("áudio curto não é fatiado", () => {
  const pcm = buildAudio(120, []);
  assert.deepEqual(planSegments(pcm), [{ start: 0, end: pcm.length }]);
});

test("as fatias cobrem o áudio inteiro, sem buraco nem sobreposição", () => {
  const pcm = buildAudio(1500, [
    [238, 242],
    [478, 482],
    [700, 705],
  ]);
  const segments = planSegments(pcm);

  assert.ok(segments.length > 1, "esperava mais de uma fatia");
  assert.equal(segments[0].start, 0);
  assert.equal(segments.at(-1)!.end, pcm.length);
  for (let i = 1; i < segments.length; i += 1) {
    assert.equal(segments[i].start, segments[i - 1].end, "emenda com buraco");
  }
});

test("o corte cai na pausa, não no meio da fala", () => {
  // Pausa em 235–245 s, dentro da janela de busca em torno do alvo de 240 s.
  const [first] = planSegments(buildAudio(900, [[235, 245]]));
  const cutSec = first.end / SAMPLE_RATE;
  assert.ok(
    cutSec > 235 && cutSec < 245,
    `cortou em ${cutSec.toFixed(1)}s, fora da pausa`,
  );
});

test("sem nenhuma pausa, as fatias ficam perto do alvo", () => {
  for (const segment of planSegments(buildAudio(2000, []))) {
    const seconds = (segment.end - segment.start) / SAMPLE_RATE;
    assert.ok(seconds <= 265, `fatia de ${seconds.toFixed(1)}s`);
  }
});
