import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces, homedir } from 'node:os';
import { join } from 'node:path';
import { analysisSchema, createPrompt, validateAnalysis } from './translation-schema.mjs';

// Ключ хранится вне папки сайта и никогда не передаётся браузеру.
const keyPath = process.env.GEMINI_KEY_FILE || join(homedir(), '.config', 'coldworld2000', 'gemini-key');
let apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  try { apiKey = (await readFile(keyPath, 'utf8')).trim(); }
  catch { throw new Error('Не найден новый ключ Gemini для coldworld2000.'); }
}
const port = Number(process.env.PORT || 8001);
const hosts = new Set(['localhost', '127.0.0.1', ...Object.values(networkInterfaces()).flat().filter(Boolean).map(item => item.address)]);
const publicFiles = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ...['app.js', 'cloud-store.js', 'dictionary.js', 'firebase-config.js', 'translation-schema.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
]);
let busy = false;
let successCount = 0;
let usageDay = '';
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function translate(word) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: createPrompt(word) }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 3500, responseMimeType: 'application/json', responseJsonSchema: analysisSchema } }),
      signal: AbortSignal.timeout(55000),
    });
    if ([500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, attempt ? 2200 : 900));
      continue;
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const needsPrepayment = /prepayment credits are depleted/i.test(failure.error?.message || '');
      const messages = { 403: 'Gemini отклонил доступ. Нужно проверить доступ и оплату проекта.', 429: needsPrepayment
        ? 'Gemini сообщает, что на подключённом платёжном аккаунте закончилась предоплата. Проверьте баланс Gemini в Google AI Studio и привязку аккаунта.'
        : 'Достигнута квота запросов Gemini. Попробуйте позже или проверьте квоты проекта.' };
      const error = new Error('Translation failed');
      error.publicMessage = messages[response.status] || `Ошибка переводчика (${response.status}). Попробуйте позже.`;
      throw error;
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
    return validateAnalysis(JSON.parse(text));
  }
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!hosts.has(url.hostname)) return json(res, 403, { error: 'Недопустимый адрес.' });
    if (url.pathname === '/api/translate' && req.method === 'POST') {
      if (req.headers.origin !== url.origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Недопустимый источник запроса.' });
      if (busy) return json(res, 429, { error: 'Перевод уже выполняется. Подождите немного.' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 2048) return json(res, 413, { error: 'Слишком длинный запрос.' });
      }
      const { word } = JSON.parse(body);
      if (typeof word !== 'string' || !word.trim() || word.length > 120) return json(res, 400, { error: 'Введите слово длиной до 120 символов.' });
      const today = new Date().toISOString().slice(0, 10);
      if (usageDay !== today) { usageDay = today; successCount = 0; }
      if (successCount >= 100) return json(res, 429, { error: 'На сегодня достигнут лимит в 100 переводов.' });
      busy = true;
      try {
        const result = await translate(word.trim());
        successCount++;
        json(res, 200, result);
      } finally { busy = false; }
      return;
    }
    const file = publicFiles.get(url.pathname);
    if (!file || req.method !== 'GET') return json(res, 404, { error: 'Не найдено.' });
    const body = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (error) {
    json(res, 502, { error: error.name === 'TimeoutError' ? 'Перевод занял слишком много времени. Попробуйте ещё раз.' : error instanceof SyntaxError ? 'Не удалось прочитать ответ. Попробуйте ещё раз.' : error.publicMessage || 'Не удалось получить перевод. Попробуйте ещё раз.' });
  }
}).listen(port, '0.0.0.0', () => console.log(`Локальный словарь: http://localhost:${port}`));
