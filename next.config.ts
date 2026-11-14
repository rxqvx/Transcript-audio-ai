import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem isso o Turbopack pode subir a raiz para fora do projeto ao encontrar
  // outro lockfile em um diretório acima.
  turbopack: { root: __dirname },
  // Sem isolamento cross-origin não existe SharedArrayBuffer, e o ONNX Runtime
  // roda o Whisper em WASM com uma única thread — várias vezes mais lento.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
