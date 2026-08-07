import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Transcrição ao vivo",
  description:
    "Grave áudio pelo microfone e veja a transcrição em tempo real, direto no navegador.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Extensões de navegador costumam injetar atributos em <html>/<body> antes
    // da hidratação; `suppressHydrationWarning` ignora essa diferença aqui sem
    // afetar o resto da árvore (o efeito não se propaga para os filhos).
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
