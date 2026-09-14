import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
await rm('dist', {recursive:true,force:true});
await mkdir('dist');
for (const file of ['index.html','app.js','cloud-store.js','dictionary.js','search.js','firebase-config.js','translation-schema.mjs']) await copyFile(file,`dist/${file}`);
await writeFile('dist/.nojekyll','');
