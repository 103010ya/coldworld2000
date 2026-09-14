import { firebaseConfig } from './firebase-config.js';

let sdk, db, auth;
let unsubscribe = () => {};
let unsubscribeCategories = () => {};
let state = { uid: null, ready: false, words: [], categories: [], error: '' };
let listener = () => {};
let generation = 0;
const publish = (next) => { state = { ...state, ...next }; listener(state); };
export const cloudState = () => state;

export async function observeCloud(callback) {
  listener = callback;
  try {
    const [appSdk, authSdk, firestore] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js'),
    ]);
    sdk = firestore;
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(app);
    db = sdk.getFirestore(app, 'words');
    authSdk.onAuthStateChanged(auth, user => {
      const version = ++generation;
      unsubscribe();
      unsubscribeCategories();
      publish({ uid: user?.uid || null, ready: !user, words: [], categories: [], error: '' });
      if (!user) return;
      // Живой слушатель нужен для немедленного обновления списка на втором устройстве.
      unsubscribe = sdk.onSnapshot(sdk.collection(db, 'users', user.uid, 'words'), snapshot => {
        if (version !== generation) return;
        const words = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        words.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0) || a.id.localeCompare(b.id));
        publish({ words, ready: true, error: '' });
      }, () => {
        if (version === generation) publish({ ready: false, error: 'Не удалось подключить облачный словарь. Проверьте интернет и обновите страницу.' });
      });
      unsubscribeCategories = sdk.onSnapshot(sdk.collection(db, 'users', user.uid, 'categories'), snapshot => {
        if (version !== generation) return;
        const categories = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        categories.sort((a, b) => a.name.localeCompare(b.name));
        publish({ categories });
      }, () => {
        if (version === generation) publish({ error: 'Не удалось загрузить категории. Обновите страницу.' });
      });
    });
  } catch {
    publish({ ready: false, error: 'Не удалось загрузить облачное сохранение. Обновите страницу.' });
  }
}

function reference(uid, id) {
  if (!uid || auth?.currentUser?.uid !== uid || !state.ready) throw new Error('Дождитесь входа и загрузки словаря.');
  return sdk.doc(db, 'users', uid, 'words', id);
}
export async function saveNewWord(uid, word) {
  const ref = reference(uid, word.id);
  await sdk.runTransaction(db, async transaction => {
    if ((await transaction.get(ref)).exists()) return;
    transaction.set(ref, {
      word: word.word, originalInput: word.originalInput || word.word,
      details: word.details || null, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
      categoryId: word.categoryId || null,
    });
  });
}
export async function saveTranslation(uid, id, details) {
  // updateDoc не создаст заново слово, удалённое на другом устройстве.
  await sdk.updateDoc(reference(uid, id), { word: details.koreanWord, details, updatedAt: sdk.serverTimestamp() });
}
export async function removeCloudWord(uid, id) {
  await sdk.deleteDoc(reference(uid, id));
}
export async function setCloudWordCategory(uid, id, categoryId) {
  await sdk.updateDoc(reference(uid, id), { categoryId, updatedAt: sdk.serverTimestamp() });
}
export async function createCloudCategory(uid, category) {
  reference(uid, category.id);
  await sdk.setDoc(sdk.doc(db, 'users', uid, 'categories', category.id), {
    name: category.name, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
  });
}
export async function deleteCloudCategory(uid, categoryId, words) {
  reference(uid, categoryId);
  const affected = words.filter(word => word.categoryId === categoryId);
  // Каждая пачка укладывается в ограничение Firestore на количество записей.
  for (let offset = 0; offset < affected.length; offset += 400) {
    const batch = sdk.writeBatch(db);
    for (const word of affected.slice(offset, offset + 400)) {
      batch.update(sdk.doc(db, 'users', uid, 'words', word.id), { categoryId: null, updatedAt: sdk.serverTimestamp() });
    }
    await batch.commit();
  }
  await sdk.deleteDoc(sdk.doc(db, 'users', uid, 'categories', categoryId));
}
export async function confirmCloudWord(uid, id) {
  const snapshot = await sdk.getDocFromServer(reference(uid, id));
  if (!snapshot.exists()) throw new Error('Слово уже удалено из словаря.');
}

export async function requestCloudTranslation(uid, id) {
  reference(uid, id);
  const functionsSdk = await import('https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js');
  const call = functionsSdk.httpsCallable(functionsSdk.getFunctions(auth.app, 'asia-northeast3'), 'translateWord', { timeout: 180000 });
  const response = await call({ wordId: id });
  return response.data;
}
