<img src="../build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

Ferramentas de desktop gratuitas para vídeo, áudio e legendas. Processe arquivos no dispositivo e aplique a mesma configuração a um lote. Inclui FFmpeg e FFprobe.

[Versão mais recente](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [Página do produto](https://brushllm.com/pt-BR/video-studio/)

[English](../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

![Área de vídeo com quatro arquivos de origem, um quadro e uma estimativa de saída](../.github/assets/workspace.svg)

[Ver a fila de processamento](../.github/assets/queue.svg) · Material de prévia de [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## Recursos

- **Vídeo** — Converta e comprima MP4, MKV, WebM, MOV e AVI. Corte, recorte, redimensione, gire, una clipes compatíveis sem recodificar e exporte quadros ou animações.
- **Áudio** — Converta e corte áudio, ajuste volume e loudness ou extraia e substitua a faixa de áudio do vídeo.
- **Legendas** — Converta SRT, VTT, ASS, SSA e TTML, ajuste os tempos e corrija a codificação. Extraia faixas de texto, incorpore legendas ou grave-as no vídeo.
- **Fila de lotes** — Importe vários arquivos, confira a saída e acompanhe o progresso. Pause, cancele ou tente novamente e confira resultados e erros na fila.

## Download

Escolha o instalador adequado ao seu dispositivo na versão mais recente.

| Plataforma | Instalador |
| --- | --- |
| macOS 12+ (Apple Silicon) | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64 (Intel / AMD) | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

O arquivo `SHA256SUMS` contém as somas de verificação dos três instaladores. A versão macOS não é notarizada e os instaladores Windows não são assinados.

## Idiomas da interface

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## Desenvolvimento local

Use Node.js 24 LTS. O comando de desenvolvimento abre Vite e Electron juntos.

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` executa testes unitários e de integração com FFmpeg. Execute `npm run build` e depois `npm start` para testar a interface de produção.

## Licença

O código do aplicativo usa a licença MIT. FFmpeg e FFprobe seguem as respectivas licenças de origem. [MIT](../LICENSE) · [FFmpeg](media-engine/NOTICE.md)
