const version = process.env.GITHUB_SHA?.slice(0, 12);
if (!version) throw new Error('Не указан номер публикации GITHUB_SHA.');

const base = 'https://103010ya.github.io/coldworld2000/';
for (let attempt = 0; attempt < 18; attempt++) {
  try {
    const [htmlResponse, scriptResponse, versionResponse] = await Promise.all([
      fetch(`${base}?v=${version}`, { cache: 'no-store' }),
      fetch(`${base}dictionary.js?v=${version}`, { cache: 'no-store' }),
      fetch(`${base}version.txt?t=${Date.now()}`, { cache: 'no-store' }),
    ]);
    const [html, script, publishedVersion] = await Promise.all([
      htmlResponse.text(), scriptResponse.text(), versionResponse.text(),
    ]);
    if (htmlResponse.ok && scriptResponse.ok && versionResponse.ok
      && html.includes(`src="./dictionary.js?v=${version}"`)
      && html.includes(`const siteVersion = '${version}'`)
      && script.includes(`./cloud-store.js?v=${version}`)
      && publishedVersion.trim() === version) {
      console.log(`Опубликована свежая версия ${version}: ${base}`);
      process.exit(0);
    }
  } catch { /* GitHub Pages может обновляться несколько секунд. */ }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error(`GitHub Pages не отдал свежую версию ${version}.`);
