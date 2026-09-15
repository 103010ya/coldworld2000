import { matchesSearch } from './search.js';
import { observeCloud, saveNewWord, requestCloudTranslation, requestCloudPronunciation, removeCloudWord, setCloudWordCategory, createCloudCategory, deleteCloudCategory, confirmCloudWord } from './cloud-store.js';
import { validateAnalysis } from './translation-schema.mjs';

let account = { uid: null, ready: false, words: [], error: '' };
let accountVersion = 0;
const pendingAdds = new Map();
const pendingCategories = new Map();
const pendingCategoryMoves = new Set();
const importButton = document.querySelector('#import-local');
const syncStatus = document.querySelector('#sync-status');
const storageKey = 'coldworld2000:local-words';
const categoriesKey = 'coldworld2000:local-categories';
const categoryStrip = document.querySelector('#category-strip');
const categoryManager = document.querySelector('#category-manager');
const categoryOpen = document.querySelector('#category-open');
const categoryClose = document.querySelector('#category-close');
const categoryNew = document.querySelector('#category-new');
const categoryCreate = document.querySelector('#category-create');
const categoryStatus = document.querySelector('#category-status');
const categoryForm = document.querySelector('#category-form');
const categoryName = document.querySelector('#category-name');
const categoryRows = document.querySelector('#category-rows');
const categorySelect = document.querySelector('#word-category');
let selectedCategory = 'all';
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
const pronounceButton = document.querySelector('#pronounce-word');
const pronunciationCache = new Map();
let pronunciationAudio = null;
let pronunciationRequest = 0;

function openWord(word, trigger) {
  selectedWord = word;
  returnFocus = trigger;
  document.querySelector('#word-title').textContent = word.word;
  renderDetails(word.details);
  updateTranslationState();
  updatePronunciationState();
  renderCategorySelect();
  pageMessage.hidden = true;
  page.hidden = false;
  main.inert = true;
  const content = document.querySelector('.word-content');
  content.scrollTop = 0;
  window.requestAnimationFrame?.(() => { content.scrollTop = 0; });
  closeButton.focus({ preventScroll: true });
}

function closeWord() {
  stopPronunciation();
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
  else if (event.key === 'Escape' && !categoryCreate.hidden) closeCategoryCreate();
  else if (event.key === 'Escape' && !categoryManager.hidden) closeCategoryManager();
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

function layoutList() {
  const anchors = [document.querySelector('.toolbar'), syncStatus, importButton, message, categoryStrip];
  const bottom = Math.max(0, ...anchors.filter(element => element && !element.hidden).map(element => element.getBoundingClientRect?.().bottom || 0));
  list.style.top = `${Math.max(110, Math.ceil(bottom + 8))}px`;
}
window.addEventListener('resize', layoutList);
if (window.ResizeObserver) {
  const observer = new window.ResizeObserver(layoutList);
  for (const element of [categoryStrip, document.querySelector('.toolbar')]) observer.observe(element);
}

const normalizeWord = (word) => word.normalize('NFC').trim().replace(/\s+/gu, ' ');
const wordKey = (word) => normalizeWord(word).toLowerCase();

function showMessage(text = '') {
  message.textContent = text;
  message.hidden = !text;
  layoutList();
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
  const categories = readCategories();
  const matching = words.filter(word => matchesSearch(word, input.value));
  const categoryOf = word => {
    const category = categories.some(item => item.id === word.categoryId) ? word.categoryId : null;
    return category;
  };
  const appendCard = (word, otherWord = false) => {
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
    if (otherWord) {
      const quickAdd = document.createElement('button');
      quickAdd.type = 'button';
      quickAdd.className = 'quick-category';
      quickAdd.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
      quickAdd.disabled = pendingCategoryMoves.has(word.id) || Boolean(pendingAdds.get(word.id)?.saving);
      quickAdd.setAttribute('aria-label', `Добавить «${word.word}» в выбранную категорию`);
      quickAdd.addEventListener('click', () => moveWordToCategory(word, selectedCategory));
      card.append(quickAdd);
    } else {
      if (!word.details) {
        const quickTranslate = document.createElement('button');
        quickTranslate.type = 'button';
        quickTranslate.className = 'quick-translate';
        quickTranslate.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h12M9 3v2M12 5c-1 6-4 9-9 11M5 8c1 3 4 6 7 7M13 21l4-10 4 10M14.5 17h5" /></svg>';
        const busy = pending.has(word.id) || pendingAdds.get(word.id)?.saving;
        quickTranslate.disabled = Boolean(busy);
        quickTranslate.classList.toggle('is-loading', Boolean(busy));
        quickTranslate.setAttribute('aria-label', `Перевести «${word.word}»`);
        quickTranslate.addEventListener('click', () => translateWord(word, false));
        card.append(quickTranslate);
      }
      if (selectedCategory !== 'all') {
        const quickRemove = document.createElement('button');
        quickRemove.type = 'button';
        quickRemove.className = 'quick-category';
        quickRemove.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>';
        quickRemove.disabled = pendingCategoryMoves.has(word.id);
        quickRemove.setAttribute('aria-label', `Убрать «${word.word}» из выбранной категории`);
        quickRemove.addEventListener('click', () => moveWordToCategory(word, null));
        card.append(quickRemove);
      }
    }
    fragment.append(card);
  };
  if (selectedCategory === 'all') {
    matching.forEach(word => appendCard(word));
  } else {
    const selectedWords = matching.filter(word => categoryOf(word) === selectedCategory);
    const otherWords = matching.filter(word => categoryOf(word) !== selectedCategory);
    selectedWords.forEach(word => appendCard(word));
    if (otherWords.length) {
      const divider = document.createElement('li');
      divider.className = 'word-list-divider';
      divider.textContent = 'Другие слова';
      fragment.append(divider);
      otherWords.forEach(word => appendCard(word, true));
    }
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
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, word, originalInput: word, details: null, categoryId: null };
  try {
    const words = readWords();
    if (words.some(saved => wordKey(saved.word) === wordKey(word) || wordKey(saved.originalInput || saved.word) === wordKey(word))) {
      showMessage('Это слово уже есть в словаре.');
      return;
    }
    if (uid) pendingAdds.set(entry.id, { uid, entry, saving: true });
    else localStorage.setItem(storageKey, JSON.stringify([entry, ...words]));
    // Новые слова начинают без категории и сразу видны в общем списке.
    selectedCategory = 'all';
    renderCategories();
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
      if (account.uid === uid) renderWords(readWords());
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
input.addEventListener('input', () => { showMessage(); renderWords(readWords()); list.scrollTop = 0; });
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

function stopPronunciation() {
  pronunciationRequest++;
  if (pronunciationAudio) {
    pronunciationAudio.pause();
    pronunciationAudio.currentTime = 0;
    pronunciationAudio = null;
  }
  pronounceButton.classList.remove('is-loading');
  pronounceButton.setAttribute('aria-busy', 'false');
  updatePronunciationState();
}

function updatePronunciationState() {
  const available = Boolean(selectedWord?.details?.koreanWord && account.uid);
  pronounceButton.hidden = !available;
  pronounceButton.disabled = !available || pronounceButton.classList.contains('is-loading');
}

function audioFromBase64(base64, contentType) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: contentType || 'audio/mpeg' }));
}

async function pronounceSelectedWord() {
  if (!selectedWord?.details || !account.uid) return;
  if (pronunciationAudio && !pronunciationAudio.paused) {
    stopPronunciation();
    return;
  }
  const target = selectedWord;
  const cacheKey = `${account.uid}:${target.id}:${target.details.koreanWord}`;
  const request = ++pronunciationRequest;
  pronounceButton.classList.add('is-loading');
  pronounceButton.setAttribute('aria-busy', 'true');
  updatePronunciationState();
  pageMessage.hidden = true;
  try {
    let audioUrl = pronunciationCache.get(cacheKey);
    if (!audioUrl) {
      const result = await requestCloudPronunciation(account.uid, target.id);
      audioUrl = audioFromBase64(result.audio, result.contentType);
      pronunciationCache.set(cacheKey, audioUrl);
    }
    if (request !== pronunciationRequest || selectedWord?.id !== target.id) return;
    pronunciationAudio = new Audio(audioUrl);
    pronunciationAudio.addEventListener('ended', () => {
      pronunciationAudio = null;
      updatePronunciationState();
    }, { once: true });
    await pronunciationAudio.play();
  } catch (error) {
    if (request === pronunciationRequest && selectedWord?.id === target.id) {
      pageMessage.textContent = error.message || 'Не удалось воспроизвести произношение. Попробуйте ещё раз.';
      pageMessage.hidden = false;
    }
  } finally {
    if (request === pronunciationRequest) {
      pronounceButton.classList.remove('is-loading');
      pronounceButton.setAttribute('aria-busy', 'false');
      updatePronunciationState();
    }
  }
}

pronounceButton.addEventListener('click', pronounceSelectedWord);

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

async function translateWord(word, inPage) {
  if (!word || word.details || pending.has(word.id) || pendingAdds.get(word.id)?.saving) return;
  const target = { ...word };
  const uid = account.uid;
  const version = accountVersion;
  pending.add(target.id);
  updateTranslationState();
  renderWords(readWords());
  if (inPage) {
    pageMessage.textContent = 'Переводим и готовим примеры…';
    pageMessage.hidden = false;
  }
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
      const translated = { ...readWords().find(word => word.id === target.id), word: details.koreanWord, details };
      account.words = account.words.map(word => word.id === target.id ? translated : word);
      const adding = pendingAdds.get(target.id);
      if (adding) adding.entry = translated;
      if (selectedWord?.id === target.id) {
        selectedWord = translated;
        document.querySelector('#word-title').textContent = details.koreanWord;
        renderDetails(details);
        updatePronunciationState();
        pageMessage.hidden = true;
      }
      if (!inPage) showMessage();
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
      updatePronunciationState();
      pageMessage.hidden = true;
    }
    if (!inPage) showMessage();
  } catch (error) {
    if (version === accountVersion) {
      const messageText = error.name === 'TimeoutError' ? 'Ответ задерживается. Попробуйте ещё раз.' : error.message || 'Не удалось перевести слово.';
      if (inPage && selectedWord?.id === target.id) {
        pageMessage.textContent = messageText;
        pageMessage.hidden = false;
      } else if (!inPage) showMessage(messageText);
    }
  } finally {
    pending.delete(target.id);
    updateTranslationState();
    if (version === accountVersion) renderWords(readWords());
  }
}

translateButton.addEventListener('click', () => translateWord(selectedWord, true));

observeCloud(next => {
  if (account.uid !== next.uid) {
    accountVersion++;
    if (!page.hidden) closeWord();
  }
  account = next;
  for (const [id, item] of pendingCategories) {
    if (item.uid === next.uid && !item.saving && next.categories.some(category => category.id === id)) pendingCategories.delete(id);
  }
  renderCategories();
  for (const [id, item] of pendingAdds) {
    if (item.uid === next.uid && !item.saving && next.words.some(word => word.id === id)) pendingAdds.delete(id);
  }
  loadDictionary();
  updateTranslationState();
  updatePronunciationState();
  syncStatus.textContent = next.error || (!next.ready ? 'Загружаем словарь…' : next.uid ? '' : 'Войдите через Google, чтобы сохранять слова в аккаунте.');
  syncStatus.hidden = !syncStatus.textContent;
  layoutList();
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

function readCategories() {
  if (account.uid) {
    const categories = account.categories || [];
    const extra = [...pendingCategories.values()]
      .filter(item => item.uid === account.uid && !categories.some(category => category.id === item.category.id))
      .map(item => item.category);
    return [...categories, ...extra];
  }
  const saved = JSON.parse(localStorage.getItem(categoriesKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('Некорректные категории');
  return saved;
}

function renderCategorySelect() {
  const categories = readCategories();
  const options = [{ id: '', name: 'Без категории' }, ...categories];
  categorySelect.replaceChildren(...options.map(category => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip';
    chip.textContent = category.name;
    chip.setAttribute('aria-pressed', String((selectedWord?.categoryId || '') === category.id));
    chip.addEventListener('click', () => setWordCategory(category.id));
    return chip;
  }));
}

function renderCategories() {
  const categories = readCategories();
  if (selectedCategory !== 'all' && !categories.some(item => item.id === selectedCategory)) selectedCategory = 'all';
  categoryOpen.textContent = selectedCategory === 'all'
    ? 'Категории'
    : categories.find(category => category.id === selectedCategory)?.name || 'Категории';
  categoryRows.replaceChildren(...[{ id: 'all', name: 'Все' }, ...categories].map(category => {
    const row = document.createElement('div');
    row.className = 'category-row';
    const choice = document.createElement('button');
    choice.className = 'category-choice';
    choice.type = 'button';
    choice.textContent = category.name;
    choice.setAttribute('aria-pressed', String(selectedCategory === category.id));
    choice.addEventListener('click', () => {
      selectedCategory = category.id;
      renderCategories();
      renderWords(readWords());
      list.scrollTop = 0;
      closeCategoryManager();
    });
    row.append(choice);
    if (category.id === 'all') return row;
    const remove = document.createElement('button');
    remove.className = 'category-remove';
    remove.type = 'button';
    remove.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>';
    remove.setAttribute('aria-label', `Удалить категорию ${category.name}`);
    remove.disabled = Boolean(pendingCategories.get(category.id)?.saving);
    remove.addEventListener('click', () => deleteCategory(category, remove));
    row.append(remove);
    return row;
  }));
  if (selectedWord) renderCategorySelect();
  layoutList();
}

function showCategoryMessage(text = '') {
  categoryStatus.textContent = text;
  categoryStatus.hidden = !text;
}

function updateCategoryViewport() {
  if (categoryCreate.hidden || !window.visualViewport) return;
  const viewport = window.visualViewport;
  // На телефоне центрируем поле в видимой области над клавиатурой.
  categoryCreate.style.top = `${viewport.offsetTop}px`;
  categoryCreate.style.height = `${viewport.height}px`;
}
window.visualViewport?.addEventListener('resize', updateCategoryViewport);
window.visualViewport?.addEventListener('scroll', updateCategoryViewport);

function closeCategoryManager() {
  categoryManager.hidden = true;
  main.inert = false;
  categoryOpen.setAttribute('aria-expanded', 'false');
  closeCategoryCreate();
  categoryName.blur();
  showCategoryMessage();
  categoryOpen.focus({ preventScroll: true });
}

categoryOpen.addEventListener('click', () => {
  categoryManager.hidden = false;
  categoryOpen.setAttribute('aria-expanded', 'true');
  main.inert = true;
  categoryClose.focus({ preventScroll: true });
});
categoryClose.addEventListener('click', closeCategoryManager);
categoryNew.addEventListener('click', () => {
  categoryCreate.hidden = false;
  categoryManager.inert = true;
  showCategoryMessage();
  categoryName.focus();
  updateCategoryViewport();
});
function closeCategoryCreate() {
  categoryCreate.hidden = true;
  categoryManager.inert = false;
  categoryName.blur();
  categoryNew.focus({ preventScroll: true });
}
categoryCreate.addEventListener('click', event => {
  if (event.target === categoryCreate) closeCategoryCreate();
});

categoryForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = normalizeWord(categoryName.value);
  if (!name) return;
  if (!account.ready) { showCategoryMessage('Дождитесь загрузки категорий.'); return; }
  if (readCategories().some(category => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showCategoryMessage('Такая категория уже есть.');
    return;
  }
  const category = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name };
  const uid = account.uid;
  categoryForm.querySelector('button').disabled = true;
  try {
    if (uid) pendingCategories.set(category.id, { uid, category, saving: true });
    else localStorage.setItem(categoriesKey, JSON.stringify([...readCategories(), category]));
    if (uid !== account.uid) return;
    categoryName.value = '';
    renderCategories();
    renderWords(readWords());
    closeCategoryCreate();
    showCategoryMessage();
    const created = [...categoryRows.querySelectorAll('.category-choice')].find(button => button.textContent === category.name);
    created?.focus({ preventScroll: true });
    showMessage();
    if (uid) {
      await createCloudCategory(uid, category);
      const pendingCategory = pendingCategories.get(category.id);
      if (pendingCategory) pendingCategory.saving = false;
      if (account.uid === uid && account.categories?.some(item => item.id === category.id)) pendingCategories.delete(category.id);
      if (account.uid === uid) renderCategories();
    }
  } catch {
    pendingCategories.delete(category.id);
    if (uid !== account.uid) return;
    renderCategories();
    categoryName.value = name;
    categoryCreate.hidden = false;
    categoryManager.inert = true;
    showCategoryMessage('Не удалось сохранить категорию. Название осталось в поле — попробуйте ещё раз.');
  }
  finally { categoryForm.querySelector('button').disabled = false; }
});

async function deleteCategory(category, button) {
  button.disabled = true;
  const uid = account.uid;
  try {
    if (uid) {
      await deleteCloudCategory(uid, category.id, account.words);
      account.categories = account.categories.filter(item => item.id !== category.id);
      account.words = account.words.map(word => word.categoryId === category.id ? { ...word, categoryId: null } : word);
    }
    else {
      const words = readLocalWords().map(word => word.categoryId === category.id ? { ...word, categoryId: null } : word);
      localStorage.setItem(storageKey, JSON.stringify(words));
      localStorage.setItem(categoriesKey, JSON.stringify(readCategories().filter(item => item.id !== category.id)));
    }
    if (uid !== account.uid) return;
    if (selectedCategory === category.id) selectedCategory = 'all';
    renderCategories();
    renderWords(readWords());
    showMessage();
  } catch { showCategoryMessage('Не удалось удалить категорию. Слова сохранены. Попробуйте ещё раз.'); }
  finally { button.disabled = false; }
}

async function moveWordToCategory(word, categoryId) {
  if (selectedCategory === 'all' || pendingCategoryMoves.has(word.id) || pendingAdds.get(word.id)?.saving) return;
  const uid = account.uid;
  const version = accountVersion;
  const previousCategory = word.categoryId || null;
  pendingCategoryMoves.add(word.id);
  try {
    if (uid) {
      account.words = account.words.map(item => item.id === word.id ? { ...item, categoryId } : item);
      renderWords(readWords());
      await setCloudWordCategory(uid, word.id, categoryId);
    } else {
      const words = readLocalWords().map(item => item.id === word.id ? { ...item, categoryId } : item);
      localStorage.setItem(storageKey, JSON.stringify(words));
      renderWords(words);
    }
  } catch {
    if (version !== accountVersion) return;
    if (uid) account.words = account.words.map(item => item.id === word.id ? { ...item, categoryId: previousCategory } : item);
    renderWords(readWords());
    showMessage(categoryId
      ? 'Не удалось добавить слово в категорию. Попробуйте ещё раз.'
      : 'Не удалось убрать слово из категории. Попробуйте ещё раз.');
  } finally {
    pendingCategoryMoves.delete(word.id);
    if (version === accountVersion) renderWords(readWords());
  }
}

let categorySaving = false;
async function setWordCategory(categoryId) {
  if (!selectedWord || categorySaving || (selectedWord.categoryId || '') === categoryId) return;
  const target = selectedWord;
  categoryId ||= null;
  const uid = account.uid;
  categorySaving = true;
  for (const chip of categorySelect.children) chip.disabled = true;
  try {
    if (uid) {
      await setCloudWordCategory(uid, target.id, categoryId);
      selectedWord = { ...target, categoryId };
      account.words = account.words.map(word => word.id === target.id ? selectedWord : word);
      renderWords(readWords());
    }
    else {
      const words = readLocalWords().map(word => word.id === target.id ? { ...word, categoryId } : word);
      localStorage.setItem(storageKey, JSON.stringify(words));
      selectedWord = words.find(word => word.id === target.id);
      renderWords(words);
    }
    renderCategorySelect();
    showMessage();
  } catch {
    pageMessage.textContent = 'Не удалось изменить категорию. Попробуйте ещё раз.';
    pageMessage.hidden = false;
  } finally {
    categorySaving = false;
    for (const chip of categorySelect.children) chip.disabled = false;
  }
}

renderCategories();
