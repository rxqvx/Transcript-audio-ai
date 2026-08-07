"use client";

import { useEffect, useRef } from "react";

interface TranscriptViewProps {
  transcript: string;
  interim: string;
  /** Durante a captura o texto é somente leitura e rola sozinho. */
  live: boolean;
  onChange: (value: string) => void;
}

export function TranscriptView({
  transcript,
  interim,
  live,
  onChange,
}: TranscriptViewProps) {
  const liveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!live) return;
    const node = liveRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [live, transcript, interim]);

  const isEmpty = !transcript && !interim;

  if (live) {
    return (
      <div
        ref={liveRef}
        aria-live="polite"
        aria-label="Transcrição em tempo real"
        className="h-72 overflow-y-auto rounded-xl border border-black/10 bg-white/60 p-5 text-lg leading-relaxed whitespace-pre-wrap dark:border-white/10 dark:bg-black/20"
      >
        {isEmpty ? (
          <span className="text-black/40 dark:text-white/40">
            Pode falar — o texto aparece aqui enquanto você fala.
          </span>
        ) : (
          <>
            <span>{transcript}</span>
            {interim && (
              <span className="text-black/45 italic dark:text-white/45">
                {transcript ? " " : ""}
                {interim}
              </span>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <textarea
      value={transcript}
      onChange={(event) => onChange(event.target.value)}
      spellCheck
      aria-label="Transcrição"
      placeholder="A transcrição aparece aqui. Depois de parar a gravação, você pode editar o texto livremente."
      className="h-72 w-full resize-none rounded-xl border border-black/10 bg-white/60 p-5 text-lg leading-relaxed outline-none placeholder:text-black/40 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-black/20 dark:placeholder:text-white/40"
    />
  );
}
