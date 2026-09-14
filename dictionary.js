import { observeCloud, saveNewWord, requestCloudTranslation, removeCloudWord, confirmCloudWord } from './cloud-store.js';
import { validateAnalysis } from './translation-schema.mjs';

let account = { uid: null, ready: false, words: [], error: '' };
let accountVersion = 0;
const pendingAdds = new Map();
const importButton = document.querySelector('#import-local');
const syncStatus = document.querySelector('#sync-status');
const storageKey = 'coldworld2000:local-words';
const input = document.querySelector('#new-word');
const list = document.querySelector('#word-list');
const count = document.querySelector('#word-count');
const countValue = document.querySelector('#word-count-value');
const message = document.querySelector('#word-status');
const page = document.querySelector('#word-page');
const main = document.querySelector('main');
const closeButton = document.querySelector('#close-word');
const pageMessage = document.querySelector('#word-page-status');
let selectedWord = null;
let returnFocus = null;
const pending = new Set();
const translateButton = document.querySelector('#translate-word');
const deleteButton = document.querySelector('#delete-word');
const detailsContainer = document.querySelector('#word-details');

function openWord(word, trigger) {
  selectedWord = word;
  returnFocus = trigger;
  document.querySelector('#word-title').textContent = word.word;
  renderDetails(word.details);
  updateTranslationState();
  document.querySelector('.word-content').scrollTop = 0;
  pageMessage.hidden = true;
  page.hidden = false;
  main.inert = true;
  closeButton.focus({ preventScroll: true });
}

function closeWord() {
  page.hidden = true;
  main.inert = false;
  selectedWord = null;
  // После удаления возвращаем фокус в список, чтобы не открывать клавиатуру.
  const target = returnFocus?.isConnected ? returnFocus : list;
  target.focus({ preventScroll: true });
}

closeButton.addEventListener('click', closeWord);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !page.hidden) closeWord();
});
document.querySelector('#delete-word').addEventListener('click', async () => {
  if (selectedWord === null) return;
  const target = selectedWord;
  const version = accountVersion;
  deleteButton.disabled = true;
  try {
    if (account.uid) {
      await removeCloudWord(account.uid, target.id);
      if (version === accountVersion && selectedWord?.id === target.id) closeWord();
      return;
    }
    const words = readWords().filter(word => word.id !== target.id);
    localStorage.setItem(storageKey, JSON.stringify(words));
    renderWords(words);
    closeWord();
  } catch {
    pageMessage.textContent = 'Не удалось удалить слово. Попробуйте ещё раз.';
    pageMessage.hidden = false;
  } finally { updateTranslationState(); }
});

const normalizeWord = (word) => word.normalize('NFC').trim().replace(/\s+/gu, ' ');
const wordKey = (word) => normalizeWord(word).toLowerCase();

function showMessage(text = '') {
  message.textContent = text;
  message.hidden = !text;
}

function readLocalWords() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('Некорректный формат словаря');
  // Старые строки превращаем в записи без потери добавленных слов.
  return saved.map(entry => {
    if (typeof entry === 'string') {
      const word = normalizeWord(entry);
      return { id: `legacy:${wordKey(word)}`, word, originalInput: word, details: null };
    }
    if (!entry || typeof entry.id !== 'string' || typeof entry.word !== 'string') throw new Error('Некорректная запись');
    return entry;
  });
}

function readWords() {
  if (!account.uid) return readLocalWords();
  const extra = [...pendingAdds.values()].filter(item => item.uid === account.uid && !account.words.some(word => word.id === item.entry.id)).map(item => item.entry);
  return [...extra, ...account.words];
}

function renderWords(words, addedWord) {
  const fragment = document.createDocumentFragment();
  for (const word of words) {
    const card = document.createElement('li');
    card.className = 'word-card';
    if (word.id === addedWord?.id) card.classList.add('is-new');
    // Показываем введённое как текст, а не как HTML.
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'word-link';
    const label = document.createElement('span');
    label.textContent = word.word;
    link.append(label);
    if (word.details) {
      const translation = document.createElement('span');
      translation.className = 'word-translation';
      translation.textContent = word.details.translation;
      link.append(translation);
    }
    link.addEventListener('click', () => openWord(word, link));
    card.append(link);
    fragment.append(card);
  }
  list.replaceChildren(fragment);
  countValue.textContent = words.length;
  count.setAttribute('aria-label', `Добавлено слов: ${words.length}`);
}

function loadDictionary() {
  try {
    const words = readWords();
    renderWords(words);
    if (selectedWord) {
      const current = words.find(word => word.id === selectedWord.id);
      if (!current) closeWord();
      else {
        selectedWord = current;
        document.querySelector('#word-title').textContent = current.word;
        renderDetails(current.details);
      }
    }
    showMessage();
  } catch {
    showMessage('Не удалось прочитать сохранённые слова. Данные не изменены.');
  }
}

async function addWord() {
  const word = normalizeWord(input.value);
  if (!word) return;
  if (!account.ready) { showMessage('Дождитесь загрузки словаря.'); return; }
  const version = accountVersion;
  const uid = account.uid;
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, word, originalInput: word, details: null };
  try {
    const words = readWords();
    if (words.some(saved => wordKey(saved.word) === wordKey(word) || wordKey(saved.originalInput || saved.word) === wordKey(word))) {
      showMessage('Это слово уже есть в словаре.');
      return;
    }
    if (uid) pendingAdds.set(entry.id, { uid, entry, saving: true });
    else localStorage.setItem(storageKey, JSON.stringify([entry, ...words]));
    // Интерфейс отвечает сразу; сеть больше не задерживает ввод следующего слова.
    renderWords(readWords(), entry);
    list.scrollTop = 0;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // На телефоне клавиатура закрывается и не заслоняет новую карточку.
    input.blur();
    if (uid) {
      await saveNewWord(uid, entry);
      const item = pendingAdds.get(entry.id);
      if (item) item.saving = false;
      if (account.uid === uid && account.words.some(word => word.id === entry.id)) pendingAdds.delete(entry.id);
      updateTranslationState();
    }
  } catch {
    pendingAdds.delete(entry.id);
    if (version !== accountVersion) return;
    loadDictionary();
    if (!input.value.trim()) {
      input.value = word;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      showMessage('Не удалось сохранить слово. Текст возвращён в поле — попробуйте ещё раз.');
    } else {
      // Новый ввод не затираем: неудачное слово остаётся в локальном словаре.
      try {
        const local = readLocalWords();
        localStorage.setItem(storageKey, JSON.stringify([entry, ...local]));
        importButton.hidden = false;
        showMessage(`«${word}» сохранено на устройстве. Нажмите «Сохранить слова с устройства в аккаунт», чтобы повторить.`);
      } catch { showMessage(`Не удалось сохранить «${word}». Скопируйте это слово и попробуйте ещё раз.`); }
    }
  }
}

document.querySelector('.add-button').addEventListener('click', addWord);
input.addEventListener('keydown', (event) => {
  // Enter во время выбора корейского слога ещё не означает добавление слова.
  if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    addWord();
  }
});
input.addEventListener('input', () => showMessage());
window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) loadDictionary();
});
loadDictionary();

function updateTranslationState() {
  const busy = selectedWord && (pending.has(selectedWord.id) || pendingAdds.get(selectedWord.id)?.saving);
  translateButton.disabled = Boolean(busy);
  deleteButton.disabled = Boolean(busy);
  translateButton.classList.toggle('is-loading', Boolean(busy));
  translateButton.setAttribute('aria-busy', String(Boolean(busy)));
  translateButton.setAttribute('aria-label', busy ? 'Переводим слово' : 'Перевести слово');
}

function renderDetails(details) {
  detailsContainer.replaceChildren();
  if (!details) return;
  const section = (title) => {
    const item = document.createElement('section');
    item.className = 'detail-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    item.append(heading);
    detailsContainer.append(item);
    return item;
  };
  const paragraph = (parent, text, className = '') => {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    parent.append(p);
  };
  paragraph(section('01 · Перевод'), details.translation);
  paragraph(section('02 · Значение'), details.meaning);
  paragraph(section('03 · Использование'), details.usage);
  const formality = section('04 · Формальность');
  paragraph(formality, `${'●'.repeat(details.formality.level)}${'○'.repeat(3 - details.formality.level)}  ${details.formality.level}/3`);
  paragraph(formality, `Стиль: ${details.formality.style === 'оба' ? 'официальный и неофициальный' : details.formality.style}`);
  paragraph(formality, `Со старшими: ${details.formality.older}`);
  paragraph(formality, `С младшими: ${details.formality.younger}`);
  paragraph(formality, details.formality.note, 'detail-note');
  const examples = section('05 · Примеры');
  const labels = ['Настоящее', 'Прошедшее', 'Будущее', 'Другая грамматика'];
  details.examples.forEach((example, index) => {
    const item = document.createElement('div');
    item.className = 'word-example';
    paragraph(item, `${labels[index]} · ${example.grammar}`, 'detail-note');
    paragraph(item, example.korean, 'example-korean');
    paragraph(item, example.translation);
    examples.append(item);
  });
}

translateButton.addEventListener('click', async () => {
  if (!selectedWord || pending.has(selectedWord.id)) return;
  const target = { ...selectedWord };
  const uid = account.uid;
  const version = accountVersion;
  pending.add(target.id);
  updateTranslationState();
  pageMessage.textContent = 'Переводим и готовим примеры…';
  pageMessage.hidden = false;
  try {
    // Сначала подтверждаем сохранение слова, затем запрашиваем перевод.
    if (uid) await confirmCloudWord(uid, target.id);
    else localStorage.setItem(storageKey, JSON.stringify(readWords()));
    if (version !== accountVersion) return;
    let data;
    if (uid) {
      data = await requestCloudTranslation(uid, target.id);
    } else {
      if (!['localhost', '127.0.0.1'].includes(location.hostname) && !location.hostname.startsWith('192.168.')) {
        throw new Error('Войдите через Google и сохраните слово в аккаунт для перевода.');
      }
      const response = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: target.originalInput || target.word }), signal: AbortSignal.timeout(180000),
      });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось перевести слово.');
    }
    const details = validateAnalysis(data);
    if (version !== accountVersion) return;
    if (uid) {
      if (selectedWord?.id === target.id) pageMessage.hidden = true;
      return;
    }
    const words = readWords();
    const index = words.findIndex(word => word.id === target.id);
    // Удалённое в другой вкладке слово не восстанавливаем поздним ответом.
    if (index === -1) return;
    words[index] = { ...words[index], word: details.koreanWord, details };
    localStorage.setItem(storageKey, JSON.stringify(words));
    renderWords(words);
    if (selectedWord?.id === target.id) {
      selectedWord = words[index];
      document.querySelector('#word-title').textContent = details.koreanWord;
      renderDetails(details);
      pageMessage.hidden = true;
    }
  } catch (error) {
    if (version === accountVersion && selectedWord?.id === target.id) {
      pageMessage.textContent = error.name === 'TimeoutError' ? 'Ответ задерживается. Попробуйте ещё раз.' : error.message || 'Не удалось перевести слово.';
      pageMessage.hidden = false;
    }
  } finally {
    pending.delete(target.id);
    updateTranslationState();
  }
});

observeCloud(next => {
  if (account.uid !== next.uid) {
    accountVersion++;
    if (!page.hidden) closeWord();
  }
  account = next;
  for (const [id, item] of pendingAdds) {
    if (item.uid === next.uid && !item.saving && next.words.some(word => word.id === id)) pendingAdds.delete(id);
  }
  loadDictionary();
  updateTranslationState();
  syncStatus.textContent = next.error || (!next.ready ? 'Загружаем словарь…' : next.uid ? '' : 'Войдите через Google, чтобы сохранять слова в аккаунте.');
  syncStatus.hidden = !syncStatus.textContent;
  try { importButton.hidden = !next.uid || !next.ready || !readLocalWords().length; }
  catch { importButton.hidden = true; }
});

importButton.addEventListener('click', async () => {
  const uid = account.uid;
  if (!uid || !account.ready) return;
  importButton.disabled = true;
  try {
    const localWords = readLocalWords();
    for (const word of localWords) {
      if (account.uid !== uid) throw new Error('Аккаунт изменён.');
      if (!readWords().some(saved => wordKey(saved.originalInput) === wordKey(word.originalInput))) {
        // Стабильный идентификатор позволяет безопасно повторить прерванный перенос.
        const id = `import-${Array.from(word.id).map(char => char.codePointAt(0).toString(16)).join('-')}`;
        await saveNewWord(uid, { ...word, id });
      }
    }
    if (account.uid !== uid) return;
    const importedIds = new Set(localWords.map(word => word.id));
    const remaining = readLocalWords().filter(word => !importedIds.has(word.id));
    localStorage.setItem(storageKey, JSON.stringify(remaining));
    importButton.hidden = !remaining.length;
    showMessage();
  } catch { showMessage('Не удалось сохранить все локальные слова. Они остались на устройстве — попробуйте ещё раз.'); }
  finally { importButton.disabled = false; }
});
