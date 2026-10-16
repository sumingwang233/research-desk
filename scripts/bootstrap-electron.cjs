// Optional fallback for networks where the package downloader stalls. No environment changes.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { downloadArtifact } = require('@electron/get');
const directory = path.resolve(__dirname, '../node_modules/electron');
(async () => {
  const archive = await downloadArtifact({
    version: require(path.join(directory, 'package.json')).version,
    artifactName: 'electron', platform: process.platform, arch: process.arch,
    checksums: require(path.join(directory, 'checksums.json')),
    ...(process.argv.includes('--mirror') ? { mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/', customDir: '{{ version }}' } } : {}),
    downloader: { async download(url, target) {
      console.log(`Downloading Electron from ${new URL(url).hostname}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error(`Electron download HTTP ${response.status}`);
      let bytes = 0, reported = 0;
      const stream = Readable.fromWeb(response.body);
      stream.on('data', chunk => { bytes += chunk.length; if (bytes - reported >= 10 * 1048576) { reported = bytes; console.log(`Electron download: ${Math.round(bytes / 1048576)} MiB`); } });
      await pipeline(stream, fs.createWriteStream(target));
    } }
  });
  await require('@electron-internal/extract-zip').extract(archive, { dir: path.join(directory, 'dist') });
  const executable = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  await fs.promises.writeFile(path.join(directory, 'path.txt'), executable);
  console.log('Electron installed and checksum verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
