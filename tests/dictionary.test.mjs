import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { validateAnalysis } from '../translation-schema.mjs';
const source = (await readFile(new URL('../dictionary.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const analysis = { koreanWord: '먹다', translation: 'есть', meaning: 'Принимать пищу.', usage: 'В разговоре о еде.', formality: { level: 2, style: 'оба', older: 'Для действий старшего — 드시다.', younger: 'С учётом близости.', note: 'Вежливость зависит от окончания.' }, examples: ['present', 'past', 'future', 'grammar'].map(kind => ({ kind, grammar: 'Пример', korean: '밥을 먹어요.', translation: 'Я ем рис.' })) };
function setup(saved = ['먹었어요']) {
  const nodes = new Map();
  class Element {
    constructor() { this.children = []; this.events = {}; this.value = ''; this.isConnected = true; this.classList = { add() {}, toggle() {} }; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(type, callback) { this.events[type] = callback; }
    dispatchEvent(event) { this.events[event.type]?.(event); }
    focus() { this.focused = true; }
  }
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  let storage = JSON.stringify(saved);
  const context = vm.createContext({
    document: { querySelector: node, createElement: () => new Element(), createDocumentFragment: () => new Element(), addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: () => storage, setItem: (_, value) => { storage = value; } },
    observeCloud: callback => callback({ uid: null, ready: true, words: [], error: '' }),
    location: { hostname: 'localhost' },
    validateAnalysis, AbortSignal, Event, fetch: async () => ({ ok: true, json: async () => structuredClone(analysis) }),
  });
  vm.runInContext(source, context);
  return { context, node, run: code => vm.runInContext(code, context), words: () => JSON.parse(storage) };
}
test('старые слова сохраняются при добавлении и не дублируются', async () => {
  const app = setup(['apple']);
  app.node('#new-word').value = ' APPLE ';
  await app.run('addWord()');
  assert.deepEqual(app.words(), ['apple']);
  app.node('#new-word').value = 'работать';
  await app.run('addWord()');
  assert.equal(app.words().length, 2);
  assert.equal(app.words()[1].word, 'apple');
});
test('перевод сохраняет корейскую форму, исходный ввод и разделы', async () => {
  const app = setup();
  app.run('openWord(readWords()[0], null)');
  await app.node('#translate-word').events.click();
  assert.equal(app.words()[0].word, '먹다');
  assert.equal(app.words()[0].originalInput, '먹었어요');
  assert.equal(app.words()[0].details.examples.length, 4);
  assert.equal(app.node('#word-details').children.length, 5);
  assert.equal(app.node('#translate-word').disabled, false);
});
test('ошибка запроса оставляет исходное слово', async () => {
  const app = setup();
  app.context.fetch = async () => { throw new Error('Нет сети'); };
  app.run('openWord(readWords()[0], null)');
  await app.node('#translate-word').events.click();
  assert.equal(app.words()[0].word, '먹었어요');
  assert.equal(app.node('#word-page-status').textContent, 'Нет сети');
});
test('сбой сохранения не запускает платный запрос', async () => {
  const app = setup();
  let calls = 0;
  app.context.localStorage.setItem = () => { throw new Error('Нет места'); };
  app.context.fetch = async () => { calls++; };
  app.run('openWord(readWords()[0], null)');
  await app.node('#translate-word').events.click();
  assert.equal(calls, 0);
  assert.deepEqual(app.words(), ['먹었어요']);
});
test('проверка отклоняет неполный ответ и неверный порядок времён', () => {
  assert.throws(() => validateAnalysis({ ...analysis, usage: '' }));
  assert.throws(() => validateAnalysis({ ...analysis, examples: [...analysis.examples].reverse() }));
  assert.throws(() => validateAnalysis({ ...analysis, formality: { ...analysis.formality, level: 4 } }));
});

test('облачное добавление ожидает подтверждение сохранения', async () => {
  const app = setup();
  let saved;
  app.context.saveNewWord = async (uid, word) => { saved = { uid, word }; };
  app.run("account = {uid: 'alice', ready: true, words: []}");
  app.node('#new-word').value = 'apple';
  await app.run('addWord()');
  assert.equal(saved.uid, 'alice');
  assert.equal(saved.word.word, 'apple');
  assert.equal(app.node('#new-word').value, '');
});
test('ошибка облачного сохранения оставляет введённое слово', async () => {
  const app = setup();
  app.context.saveNewWord = async () => { throw new Error('Ошибка сети'); };
  app.run("account = {uid: 'alice', ready: true, words: []}");
  app.node('#new-word').value = 'apple';
  await app.run('addWord()');
  assert.equal(app.node('#new-word').value, 'apple');
});
test('перевод не запускается без подтверждённого облачного слова', async () => {
  const app = setup();
  app.context.confirmCloudWord = async () => { throw new Error('Слово удалено'); };
  let calls = 0;
  app.context.fetch = async () => { calls++; };
  app.run("account = {uid: 'alice', ready: true, words: [{id:'1',word:'apple'}]}; openWord(readWords()[0], null)");
  await app.node('#translate-word').events.click();
  assert.equal(calls, 0);
});
test('облачный перевод вызывает Firebase для сохранённого слова', async () => {
  const app = setup();
  let called;
  app.context.confirmCloudWord = async () => {};
  app.context.requestCloudTranslation = async (uid, id) => { called = {uid,id}; return analysis; };
  app.run("account = {uid:'alice',ready:true,words:[{id:'1',word:'apple'}]}; openWord(readWords()[0],null)");
  await app.node('#translate-word').events.click();
  assert.deepEqual(called,{uid:'alice',id:'1'});
  assert.equal(app.node('#word-page-status').hidden,true);
});
test('публичный гостевой перевод предлагает Google-вход', async () => {
  const app = setup();
  app.context.location.hostname = '103010ya.github.io';
  let calls = 0;
  app.context.fetch = async () => { calls++; };
  app.run('openWord(readWords()[0],null)');
  await app.node('#translate-word').events.click();
  assert.equal(calls,0);
  assert.match(app.node('#word-page-status').textContent,/Войдите через Google/);
});
test('слово и пустое поле появляются до ответа Firebase', async () => {
  const app = setup();
  let finish;
  app.context.saveNewWord = () => new Promise(resolve => { finish = resolve; });
  app.run("account = {uid:'alice',ready:true,words:[]}");
  app.node('#new-word').value = 'apple';
  const saving = app.run('addWord()');
  assert.equal(app.node('#new-word').value, '');
  assert.equal(app.run('readWords()[0].word'), 'apple');
  app.node('#new-word').value = 'next';
  finish();
  await saving;
  assert.equal(app.node('#new-word').value,'next');
});
