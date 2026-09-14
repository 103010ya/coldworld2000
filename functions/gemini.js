import { analysisSchema, createPrompt, validateAnalysis } from './translation-schema.mjs';
export async function translate(word, apiKey) {
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
