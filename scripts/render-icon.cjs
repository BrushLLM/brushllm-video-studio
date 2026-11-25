const { app, BrowserWindow } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

app.whenReady().then(async () => {
  const output = process.argv[2];
  const svg = await readFile(path.join(__dirname, '..', 'build', 'video-studio.svg'));
  const source = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const window = new BrowserWindow({ show: false });
  await window.loadURL('about:blank');
  const data = await window.webContents.executeJavaScript(`(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  })(${JSON.stringify(source)})`);
  await writeFile(output, Buffer.from(data, 'base64'));
  app.exit(0);
}).catch((error) => {
  console.error('Could not rasterize the app icon', error);
  app.exit(1);
});
