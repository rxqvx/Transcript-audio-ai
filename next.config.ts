import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem isso o Turbopack pode subir a raiz para fora do projeto ao encontrar
  // outro lockfile em um diretório acima.
  turbopack: { root: __dirname },
};

export default nextConfig;
