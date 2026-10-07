#!/usr/bin/env node
console.log(JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, duration: '10.0' },
    { codec_type: 'audio', codec_name: 'aac', duration: '10.0' }
  ],
  format: { duration: '10.0', size: '1000000' }
}));
