import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const PINNED = {
  'darwin-arm64': {
    ffmpeg: {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/ffmpeg.zip',
      archiveSha256: '1f66e9a690a7f1c9e60b012379f8869c11818d1797f45b21dbb2f2564ba61ae1',
      sha256: 'bc18dd239c4e699e080f0d92d3707004a160da54e12f8d4946e4145080143d40'
    },
    ffprobe: {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/ffprobe.zip',
      archiveSha256: '6ef2df5f575042923a28537ab37adf936f28bf3e7b85de23a1447ed447ec1dbd',
      sha256: '9f0f5582b5d59c26279309b71fa8d7e2cec23910a2dfb0212e6724f2e18a521d'
    }
  },
  'win32-x64': {
    zip: {
      // Pinned to an immutable dated autobuild release (the rolling "latest"
      // tag gets rebuilt upstream, which breaks SHA pinning).
      url: 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-win64-gpl-8.1.zip',
      sha256: '7b801cdd3a1a0bb54ae6f572187e68b4ed54f52086cfee133fab2180bfb429fa'
    },
    ffmpeg: { sha256: 'c6caa1894d3276556c84b36acc1d219d69f972c0a7525b23f1cad2bdf05c4231' },
    ffprobe: { sha256: 'b6177ba8d7d65ab993e5770ac154843db1af3db9838ae966ee6729129ddcd59f' }
  },
  'win32-arm64': {
    zip: {
      url: 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-winarm64-gpl-8.1.zip',
      sha256: '061a770557c30bbf8e0b6ca3810288a60f72b85088378b84be03277746f34f17'
    },
    ffmpeg: { sha256: '429f987f6d577e9fe51938161dc81709adccc771714dec7c7b3c9e4b1d202b74' },
    ffprobe: { sha256: '2177965ef9e57c8c5c9c5b623175a9071194af37878652fc4a9c60bd2447461f' }
  }
};

export async function verifyChecksum(file, expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const actual = hash.digest('hex');
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${file}\n  expected ${expected}\n  got      ${actual}`);
}
