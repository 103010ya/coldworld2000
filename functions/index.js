import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import textToSpeech from '@google-cloud/text-to-speech';
import { translate } from './gemini.js';
const app = initializeApp();
const db = getFirestore(app, 'words');
const key = defineSecret('GEMINI_API_KEY');
const tts = new textToSpeech.TextToSpeechClient();

export const translateWord = onCall({region:'asia-northeast3', secrets:[key], timeoutSeconds:180, memory:'256MiB', maxInstances:2, concurrency:10}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Войдите через Google, чтобы перевести слово.');
  const id = request.data?.wordId;
  if (typeof id !== 'string' || !id || id.length > 1500 || id.includes('/')) throw new HttpsError('invalid-argument','Некорректное слово.');
  const wordRef = db.doc(`users/${request.auth.uid}/words/${id}`);
  const usageRef = db.doc(`translationUsage/${request.auth.uid}`);
  const day = new Date().toISOString().slice(0,10);
  const lease = Date.now() + 210000;
  const original = await db.runTransaction(async tx => {
    const [word,usage] = await Promise.all([tx.get(wordRef),tx.get(usageRef)]);
    if (!word.exists) throw new HttpsError('not-found','Слово уже удалено.');
    const data = usage.data() || {};
    const count = data.day === day ? data.count || 0 : 0;
    if (count >= 100) throw new HttpsError('resource-exhausted','На сегодня достигнут лимит в 100 переводов.');
    if (data.busyUntil > Date.now()) throw new HttpsError('resource-exhausted','Перевод уже выполняется. Подождите немного.');
    const input = word.data().originalInput || word.data().word;
    if (typeof input !== 'string' || !input.trim() || input.length > 120) throw new HttpsError('invalid-argument','Некорректное слово.');
    tx.set(usageRef,{day,count,busyUntil:lease});
    return input;
  });
  try {
    const analysis = await translate(original,key.value());
    // Разбор и счётчик успешных запросов сохраняем вместе; удалённое слово не восстанавливаем.
    await db.runTransaction(async tx => {
      const [word, usage] = await Promise.all([tx.get(wordRef),tx.get(usageRef)]);
      if (!word.exists) throw new HttpsError('not-found','Слово удалено во время перевода.');
      if (usage.data()?.busyUntil !== lease) throw new HttpsError('aborted','Запрос устарел. Повторите перевод.');
      tx.update(wordRef,{word:analysis.koreanWord,details:analysis,updatedAt:FieldValue.serverTimestamp()});
      tx.update(usageRef,{count:(usage.data().count || 0)+1,busyUntil:0});
    });
    return analysis;
  } catch (error) {
    await db.runTransaction(async tx => {
      const usage = await tx.get(usageRef);
      if (usage.data()?.busyUntil === lease) tx.update(usageRef,{busyUntil:0});
    }).catch(() => {});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal',error.publicMessage || 'Не удалось получить перевод. Попробуйте ещё раз.');
  }
});

export const pronounceWord = onCall({region:'asia-northeast3', timeoutSeconds:30, memory:'256MiB', maxInstances:2, concurrency:20}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Войдите через Google, чтобы услышать произношение.');
  const id = request.data?.wordId;
  if (typeof id !== 'string' || !id || id.length > 1500 || id.includes('/')) throw new HttpsError('invalid-argument','Некорректное слово.');

  const wordRef = db.doc(`users/${request.auth.uid}/words/${id}`);
  const usageRef = db.doc(`pronunciationUsage/${request.auth.uid}`);
  const day = new Date().toISOString().slice(0,10);
  const lease = Date.now() + 45000;
  const koreanWord = await db.runTransaction(async tx => {
    const [word, usage] = await Promise.all([tx.get(wordRef), tx.get(usageRef)]);
    if (!word.exists) throw new HttpsError('not-found','Слово уже удалено.');
    const value = word.data()?.details?.koreanWord;
    if (typeof value !== 'string' || !value.trim() || value.length > 120) {
      throw new HttpsError('failed-precondition','Сначала переведите слово.');
    }
    const data = usage.data() || {};
    const count = data.day === day ? data.count || 0 : 0;
    if (count >= 300) throw new HttpsError('resource-exhausted','На сегодня достигнут лимит произношений.');
    if (data.busyUntil > Date.now()) throw new HttpsError('resource-exhausted','Произношение уже загружается.');
    tx.set(usageRef,{day,count,busyUntil:lease});
    return value.trim();
  });

  try {
    const [response] = await tts.synthesizeSpeech({
      input: {text:koreanWord},
      voice: {languageCode:'ko-KR', name:'ko-KR-Standard-A'},
      audioConfig: {audioEncoding:'MP3', speakingRate:0.92},
    });
    if (!response.audioContent) throw new Error('Пустой ответ Text-to-Speech.');
    await db.runTransaction(async tx => {
      const usage = await tx.get(usageRef);
      if (usage.data()?.busyUntil !== lease) return;
      tx.update(usageRef,{count:(usage.data().count || 0)+1,busyUntil:0});
    });
    const audio = typeof response.audioContent === 'string'
      ? response.audioContent
      : Buffer.from(response.audioContent).toString('base64');
    return {audio, contentType:'audio/mpeg'};
  } catch (error) {
    await db.runTransaction(async tx => {
      const usage = await tx.get(usageRef);
      if (usage.data()?.busyUntil === lease) tx.update(usageRef,{busyUntil:0});
    }).catch(() => {});
    if (error instanceof HttpsError) throw error;
    console.error('Cloud Text-to-Speech error', error);
    throw new HttpsError('internal','Не удалось загрузить произношение. Попробуйте ещё раз.');
  }
});
