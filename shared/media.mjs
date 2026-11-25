// Use the same policy in Vite and Electron's CommonJS command builder.
import media from 'brushllm-video-studio/media';

export const {
  containerOfPath, containerOfSource, editContainer, compressionContainer, videoCodecForContainer, mpeg4Quality,
  audioOutputExtension, audioProcessingFormat, displaySize, mergeCopyCompatibility, resolveMergeMode,
  AUDIO_FORMATS, AUDIO_CODEC_EXTENSIONS, fileKindOf, filterForSection, inputFilesForOp, acceptsFor,
  VIDEO_EXTS, AUDIO_EXTS, SUBTITLE_EXTS
} = media;
