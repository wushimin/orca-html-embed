import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/main.js', import.meta.url), new URL('../dist/index.js', import.meta.url));
console.log('Built dist/index.js (standalone ES module; no runtime dependencies).');
