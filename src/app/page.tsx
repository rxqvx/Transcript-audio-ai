import { RecorderPanel } from "@/components/RecorderPanel";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-10 sm:py-16">
      <header className="text-center">
        <h1 className="bg-linear-to-r from-indigo-600 via-violet-600 to-pink-600 bg-clip-text text-4xl font-bold text-transparent sm:text-5xl">
          Transcrição ao vivo
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-black/60 dark:text-white/60">
          Veja o texto aparecer enquanto você fala e receba a transcrição
          definitiva ao parar — ou envie um arquivo de áudio pronto. Tudo roda no seu navegador — nenhum áudio é
          enviado para servidores.
        </p>
      </header>

      <RecorderPanel />

      <footer className="mt-auto pt-4 text-center text-xs text-black/40 dark:text-white/40">
        Prévia ao vivo pela Web Speech API · Transcrição final com Whisper
        rodando local, via WebGPU quando disponível
      </footer>
    </main>
  );
}
