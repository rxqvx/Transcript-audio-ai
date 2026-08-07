# Transcript Audio AI

Aplicação **100% frontend** para gravar áudio pelo microfone e ver a transcrição
aparecendo em tempo real. Nenhum áudio sai do navegador: não há backend, não há
chave de API, não há upload.

## Stack

- **Next.js 16** (App Router) + **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **Web Speech API** — reconhecimento de fala em tempo real
- **MediaRecorder API** — grava o áudio para ouvir/baixar depois

## Como rodar

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>, clique no microfone e libere a permissão.

## Suporte dos navegadores

O reconhecimento de fala usa a Web Speech API, disponível em **Chrome**, **Edge**
e **Safari**. O Firefox ainda não implementa a API — nele a gravação do áudio
funciona, mas a transcrição não. A página avisa quando o navegador não tem
suporte.

A API só é liberada em contexto seguro: `localhost` ou HTTPS.

## Funcionalidades

- Transcrição contínua enquanto você fala, com o trecho provisório em itálico
- Reinício automático da sessão — o navegador encerra a escuta após alguns
  segundos de silêncio, e o app retoma sem perder o texto já reconhecido
- Visualizador de volume em canvas
- Escolha do idioma (pt-BR, pt-PT, en-US, es, fr, de, it, ja)
- Edição manual do texto depois de parar a gravação
- Copiar para a área de transferência e baixar como `.txt`
- Player e download do áudio gravado (`.webm`/`.m4a`, conforme o navegador)

## Estrutura

```
src/
├── app/
│   ├── layout.tsx          # metadata, fontes, tema
│   ├── page.tsx            # página inicial
│   └── globals.css
├── components/
│   ├── RecorderPanel.tsx   # orquestra gravação + transcrição e a UI
│   ├── AudioVisualizer.tsx # barras de volume (canvas + AnalyserNode)
│   └── TranscriptView.tsx  # texto ao vivo / textarea editável
├── hooks/
│   ├── useSpeechRecognition.ts  # Web Speech API com auto-restart
│   └── useAudioRecorder.ts      # MediaRecorder + AnalyserNode
└── lib/
    ├── speech.ts           # tipagens da Web Speech API e idiomas
    └── utils.ts            # formatação, contagem, download
```

## Build de produção

```bash
npm run build
npm start
```

Como não existe código de servidor, dá para exportar estático
(`output: "export"` em `next.config.ts`) e publicar em qualquer hospedagem de
arquivos.
