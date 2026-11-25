<img src="../build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

Herramientas de escritorio gratuitas para vídeo, audio y subtítulos. Procesa archivos en tu dispositivo y aplica los mismos ajustes a un lote. Incluye FFmpeg y FFprobe.

[Última versión](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [Página del producto](https://brushllm.com/es/video-studio/)

[English](../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

![Área de vídeo con cuatro archivos de origen, un fotograma y una estimación de salida](../.github/assets/workspace.svg)

[Ver la cola de procesamiento](../.github/assets/queue.svg) · Material de vista previa de [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## Funciones

- **Vídeo** — Convierte y comprime MP4, MKV, WebM, MOV y AVI. Corta, recorta, redimensiona, gira, une clips compatibles sin recodificar y exporta fotogramas o animaciones.
- **Audio** — Convierte y corta audio, ajusta el volumen y la sonoridad, o extrae y sustituye una pista de vídeo.
- **Subtítulos** — Convierte SRT, VTT, ASS, SSA y TTML, desplaza los tiempos y corrige la codificación. Extrae pistas de texto e incrusta o graba subtítulos en el vídeo.
- **Cola por lotes** — Importa varios archivos, revisa la salida y sigue el progreso. Pausa, cancela o reintenta tareas y consulta resultados y errores en la cola.

## Descarga

Elige el instalador de tu dispositivo en la última versión.

| Plataforma | Instalador |
| --- | --- |
| macOS 12+ (Apple Silicon) | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64 (Intel / AMD) | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

`SHA256SUMS` contiene las sumas de los tres instaladores. La versión de macOS se distribuye sin notarización y los instaladores de Windows no están firmados.

## Idiomas de la interfaz

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## Desarrollo local

Usa Node.js 24 LTS. El comando de desarrollo inicia Vite y Electron juntos.

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` ejecuta pruebas unitarias y de integración con FFmpeg. Ejecuta `npm run build` y después `npm start` para probar la interfaz de producción.

## Licencia

El código de la aplicación usa la licencia MIT. FFmpeg y FFprobe conservan sus licencias originales. [MIT](../LICENSE) · [FFmpeg](media-engine/NOTICE.md)
