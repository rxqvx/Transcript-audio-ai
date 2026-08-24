import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collapseRepetitions,
  formatChunks,
  offsetChunks,
} from "./transcript.ts";

test("laço de repetição do modelo é colapsado", () => {
  assert.equal(
    collapseRepetitions("obrigado obrigado obrigado obrigado obrigado por tudo"),
    "obrigado por tudo",
  );
  assert.equal(
    collapseRepetitions(
      "legendas pela comunidade legendas pela comunidade legendas pela comunidade fim",
    ),
    "legendas pela comunidade fim",
  );
});

test("repetição legítima e curta é preservada", () => {
  assert.equal(collapseRepetitions("muito muito bom"), "muito muito bom");
  assert.equal(collapseRepetitions("sim sim claro"), "sim sim claro");
});

test("pausa longa no áudio vira quebra de parágrafo", () => {
  assert.equal(
    formatChunks([
      { timestamp: [0, 2], text: " Bom dia a todos." },
      { timestamp: [2, 4], text: " Vamos começar." },
      { timestamp: [9, 12], text: " Segundo assunto." },
    ]),
    "Bom dia a todos. Vamos começar.\n\nSegundo assunto.",
  );
});

test("timestamps da fatia viram tempo do áudio completo", () => {
  assert.deepEqual(offsetChunks([{ timestamp: [1, null], text: "x" }], 240), [
    { timestamp: [241, null], text: "x" },
  ]);
});
