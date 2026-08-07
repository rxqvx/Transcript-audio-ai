"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 40;
const BAR_GAP = 3;

interface AudioVisualizerProps {
  getAnalyser: () => AnalyserNode | null;
  active: boolean;
}

/** Barras de volume desenhadas em canvas a partir do espectro do microfone. */
export function AudioVisualizer({ getAnalyser, active }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    const levels = new Array<number>(BAR_COUNT).fill(0);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      const analyser = activeRef.current ? getAnalyser() : null;
      if (analyser) {
        if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
          // Buffer explícito: `getByteFrequencyData` exige um Uint8Array<ArrayBuffer>.
          spectrum = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
        analyser.getByteFrequencyData(spectrum);
      }

      // A voz se concentra nos bins graves, então lemos só a metade inferior.
      const usableBins = spectrum ? Math.floor(spectrum.length * 0.55) : 0;
      const binsPerBar = usableBins > 0 ? usableBins / BAR_COUNT : 0;

      const barWidth = (width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#6366f1");
      gradient.addColorStop(0.5, "#8b5cf6");
      gradient.addColorStop(1, "#ec4899");
      ctx.fillStyle = gradient;

      for (let i = 0; i < BAR_COUNT; i += 1) {
        let target = 0;

        if (spectrum && binsPerBar > 0) {
          const from = Math.floor(i * binsPerBar);
          const to = Math.max(from + 1, Math.floor((i + 1) * binsPerBar));
          let sum = 0;
          for (let bin = from; bin < to; bin += 1) sum += spectrum[bin];
          // Realça as faixas agudas, naturalmente mais fracas que os graves.
          const boost = 1 + (i / BAR_COUNT) * 1.4;
          target = Math.min(1, (sum / (to - from) / 255) * boost);
        }

        // Suavização: sobe rápido, desce devagar.
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.5 : 0.12);

        const barHeight = Math.max(3, levels[i] * height * 0.92);
        const x = i * (barWidth + BAR_GAP);
        const y = (height - barHeight) / 2;
        const radius = Math.min(barWidth / 2, 3);

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, radius);
        ctx.fill();
      }
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [getAnalyser]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`h-16 w-full transition-opacity duration-500 ${
        active ? "opacity-100" : "opacity-25"
      }`}
    />
  );
}
