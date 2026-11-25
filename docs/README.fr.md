<img src="../build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

Des outils de bureau gratuits pour la vidéo, l’audio et les sous-titres. Traitez vos fichiers sur votre appareil et appliquez les mêmes réglages à un lot. FFmpeg et FFprobe sont inclus.

[Dernière version](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [Page du produit](https://brushllm.com/fr/video-studio/)

[English](../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

![Espace vidéo avec quatre fichiers source, une image et l’estimation de sortie](../.github/assets/workspace.svg)

[Voir la file de traitement](../.github/assets/queue.svg) · Séquence d’aperçu issue de [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## Fonctionnalités

- **Vidéo** — Convertissez et compressez MP4, MKV, WebM, MOV et AVI. Coupez, recadrez, redimensionnez et faites pivoter les vidéos, assemblez les clips compatibles sans réencodage et exportez des images ou des animations.
- **Audio** — Convertissez et coupez l’audio, réglez le volume et la sonie, ou extrayez et remplacez une piste audio d’une vidéo.
- **Sous-titres** — Convertissez SRT, VTT, ASS, SSA et TTML, décalez les sous-titres et corrigez leur encodage. Extrayez les pistes texte, intégrez les sous-titres ou incrustez-les dans l’image.
- **File de traitement** — Importez plusieurs fichiers, vérifiez les réglages de sortie et suivez la progression. Mettez en pause, annulez ou relancez les tâches et consultez les résultats et erreurs.

## Téléchargement

Choisissez le programme d’installation adapté à votre appareil dans la dernière version.

| Plateforme | Programme d’installation |
| --- | --- |
| macOS 12+ (Apple Silicon) | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64 (Intel / AMD) | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

`SHA256SUMS` contient les sommes de contrôle des trois fichiers. La version macOS n’est pas notarisée et les fichiers d’installation Windows ne sont pas signés.

## Langues de l’interface

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## Développement local

Utilisez Node.js 24 LTS. La commande de développement lance Vite et Electron ensemble.

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` exécute les tests unitaires et d’intégration avec FFmpeg. Lancez `npm run build`, puis `npm start` pour tester l’interface de production.

## Licence

Le code de l’application est sous licence MIT. FFmpeg et FFprobe restent soumis à leurs licences d’origine. [MIT](../LICENSE) · [FFmpeg](media-engine/NOTICE.md)
