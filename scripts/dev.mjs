// Dev launcher: starts Vite, then Electron pointed at the dev server.
import { spawn } from 'node:child_process';

const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });
const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ELECTRON_START_URL: 'http://localhost:5188/' }
});

const kill = () => {
  vite.kill();
  electron.kill();
};
process.on('SIGINT', kill);
electron.on('exit', (code) => {
  vite.kill();
  process.exit(code);
});
