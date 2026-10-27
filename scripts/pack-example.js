import { readFile, writeFile } from 'node:fs/promises';
import { zipStore } from '../lib/zip.js';

const files = [
  ['package.json', 'examples/hello-dsh/package.json'],
  ['README.md', 'examples/hello-dsh/README.md'],
  ['cordis.patch.yml', 'examples/hello-dsh/cordis.patch.yml'],
  ['lib/index.js', 'examples/hello-dsh/lib/index.js'],
];
const zip = zipStore(await Promise.all(files.map(async ([name, file]) => ({
  name,
  data: await readFile(file),
}))));
await writeFile('examples/dsh-hello-community-0.1.0.zip', zip);
console.log(`packed ${zip.length} bytes`);
