import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
server.printUrls();

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_START_URL: 'http://localhost:5188/' }
});

process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.once('error', async (error) => {
  console.error(error.message);
  await server.close();
  process.exitCode = 1;
});
child.once('exit', async (code) => {
  await server.close();
  process.exitCode = code ?? 0;
});
