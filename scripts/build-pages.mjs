import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const version = (process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).slice(0, 12);
const scripts = ['app.js', 'cloud-store.js', 'dictionary.js', 'search.js', 'firebase-config.js', 'translation-schema.mjs'];

await rm('dist', { recursive: true, force: true });
await mkdir('dist');

for (const file of scripts) {
  const source = await readFile(file, 'utf8');
  // Один номер версии для всех модулей: браузер не смешает старые и новые файлы.
  const result = source.replace(/(from\s+['"]\.\/[^'"?]+\.(?:js|mjs))(?:\?[^'"]*)?(['"])/g, `$1?v=${version}$2`);
  await writeFile(`dist/${file}`, result);
}

const html = (await readFile('index.html', 'utf8'))
  .replaceAll('__BUILD_VERSION__', version)
  .replace(/(<script type="module" src="\.\/[^"?]+\.js)(?:\?[^\"]*)?("\s*>)/g, `$1?v=${version}$2`);
await writeFile('dist/index.html', html);
await writeFile('dist/version.txt', `${version}\n`);
await writeFile('dist/.nojekyll', '');
