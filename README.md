# Transcript Audio AI

Aplicação **100% frontend** para gravar áudio pelo microfone e transcrever com
qualidade de verdade. Nenhum áudio sai do navegador: não há backend, não há
chave de API, não há upload.

A transcrição acontece em duas camadas:

1. **Prévia ao vivo** — a Web Speech API mostra o texto na hora, enquanto você
   fala. É rápida, mas é do navegador: erra em nomes próprios, não pontua bem e
   perde qualidade em gravações longas.
2. **Transcrição final** — ao parar a gravação, o **Whisper** roda dentro do
   navegador (WebGPU, com fallback para CPU) sobre o áudio inteiro e substitui a
   prévia pelo texto definitivo, já com pontuação e parágrafos.

O modelo é baixado uma vez do Hugging Face Hub e fica no cache do navegador.

## Stack

- **Next.js 16** (App Router) + **React 19**
- **TypeScript**
- **Tailwind CSS 4**
- **Transformers.js** — Whisper rodando local, em um Web Worker
- **Web Speech API** — prévia em tempo real
- **MediaRecorder API** — grava o áudio para ouvir/baixar depois

## Como rodar

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>, clique no microfone e libere a permissão.

## Modelos

| Modelo             | Download | Quando usar                                            |
| ------------------ | -------- | ------------------------------------------------------ |
| Base               | ~205 MB  | Áudio curto e claro, ou máquina fraca                  |
| Small (padrão)     | ~410 MB  | Melhor equilíbrio para português                       |
| Large v3 Turbo     | ~570 MB  | Melhor qualidade; pede WebGPU e alguns GB de VRAM      |

O tamanho varia com o backend: sem WebGPU o app cai para quantizações menores,
que baixam menos e rodam bem mais devagar. A escolha fica salva no navegador, e
o botão **Baixar agora** permite adiantar o download antes de gravar.

## Como a qualidade em áudio longo é mantida

Gravações longas quebram transcritores de três jeitos, e cada um tem uma
contramedida:

- **Palavra cortada na emenda entre blocos.** O áudio é fatiado em trechos de
  ~4 minutos, e cada corte cai no ponto de menor energia dentro de uma janela de
  ±20 s — ou seja, numa pausa. Dentro de cada fatia, o pipeline usa janelas de
  30 s com 5 s de sobreposição e costura as bordas pelos timestamps.
- **Deriva de idioma.** O Whisper às vezes troca de língua no meio e passa a
  traduzir. O idioma escolhido é fixado em todas as janelas.
- **Laços de repetição.** Em silêncio ou áudio abafado o modelo repete a mesma
  frase dezenas de vezes; repetições consecutivas são colapsadas depois da
  inferência.

As pausas do áudio também viram as quebras de parágrafo do texto final.

## Suporte dos navegadores

- **Transcrição final (Whisper):** funciona em qualquer navegador moderno,
  incluindo Firefox. Com **WebGPU** roda várias vezes mais rápido que o tempo
  real; sem ela, na CPU, leva mais tempo do que o áudio dura.
- **Prévia ao vivo (Web Speech API):** só em Chrome, Edge e Safari. No Firefox a
  prévia não aparece, mas a gravação e a transcrição final funcionam normalmente.

A captura do microfone só é liberada em contexto seguro: `localhost` ou HTTPS.

## Funcionalidades

- Prévia ao vivo enquanto você fala, com o trecho provisório em itálico
- Transcrição final com Whisper ao parar a gravação, com progresso por trecho
- Escolha do modelo (qualidade × tamanho do download) e do idioma
- Visualizador de volume em canvas
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
│   ├── RecorderPanel.tsx          # orquestra gravação, prévia e Whisper
│   ├── TranscriptionProgress.tsx  # download do modelo e progresso por trecho
│   ├── AudioVisualizer.tsx        # barras de volume (canvas + AnalyserNode)
│   └── TranscriptView.tsx         # texto ao vivo / textarea editável
├── hooks/
│   ├── useSpeechRecognition.ts  # Web Speech API com auto-restart
│   ├── useAudioRecorder.ts      # MediaRecorder + AnalyserNode
│   ├── useWhisper.ts            # ponte com o worker de transcrição
│   └── useModelPreference.ts    # modelo escolhido, salvo no navegador
├── workers/
│   └── whisper.worker.ts   # Transformers.js fora da thread principal
└── lib/
    ├── audio.ts            # decodificação para 16 kHz e corte no silêncio
    ├── transcript.ts       # repetições, parágrafos e timestamps
    ├── whisper.ts          # catálogo de modelos e protocolo do worker
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
