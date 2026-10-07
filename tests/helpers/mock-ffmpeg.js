#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outIdx = args.lastIndexOf('-y') !== -1 ? args.indexOf('-y') + 1 : args.length - 1;
const out = args[outIdx];
if (out && !out.startsWith('-')) {
  if (out.includes('%05d')) {
    const dir = require('path').dirname(out);
    fs.writeFileSync(require('path').join(dir, 'frame00001.png'), 'f1');
  } else {
    fs.writeFileSync(out, 'mock output');
  }
}
process.stdout.write('out_time_us=1000000\nspeed=1.0x\n');
