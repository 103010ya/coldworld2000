import { firebaseConfig } from './firebase-config.js';

const wordInput = document.querySelector('#new-word');
const wordEntry = document.querySelector('#word-entry');
const addSlot = document.querySelector('#add-slot');

function updateAddButton() {
  // Пробелы без слова не показывают кнопку добавления.
  const hasWord = Boolean(wordInput.value.trim());
  wordEntry.classList.toggle('has-word', hasWord);
  addSlot.inert = !hasWord;
}

wordInput.addEventListener('input', updateAddButton);
window.addEventListener('pageshow', updateAddButton);
updateAddButton();

const button = document.querySelector('#profile-button');
const icon = document.querySelector('#profile-icon');
const avatar = document.querySelector('#profile-avatar');
const initial = document.querySelector('#profile-initial');
const menu = document.querySelector('#profile-menu');
const status = document.querySelector('#auth-status');
const signout = document.querySelector('#signout');

function showStatus(message = '') {
  status.textContent = message;
  status.hidden = !message;
}

function closeMenu() {
  menu.hidden = true;
  if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false');
}

avatar.addEventListener('error', () => {
  avatar.hidden = true;
  initial.hidden = false;
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.profile')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menu.hidden) {
    closeMenu();
    button.focus();
  }
});

try {
  // Загружаем только вход в аккаунт, без базы слов и переводчика.
  const [firebase, authSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js'),
  ]);
  const auth = authSdk.getAuth((firebase.getApps().length ? firebase.getApp() : firebase.initializeApp(firebaseConfig)));
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  authSdk.onAuthStateChanged(auth, (user) => {
    closeMenu();
    // У SVG скрытие задаём атрибутом: свойство hidden работает не во всех браузерах.
    icon.toggleAttribute('hidden', Boolean(user));
    avatar.hidden = true;
    avatar.removeAttribute('src');
    initial.hidden = true;
    const label = user ? 'Открыть профиль' : 'Войти через Google';
    button.setAttribute('aria-label', label);
    button.title = label;
    if (user) {
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'profile-menu');
      const name = user.displayName || 'Профиль';
      document.querySelector('#profile-name').textContent = name;
      initial.textContent = Array.from(name)[0].toUpperCase();
      initial.hidden = Boolean(user.photoURL);
      if (user.photoURL) {
        avatar.src = user.photoURL;
        avatar.hidden = false;
      }
    } else {
      button.removeAttribute('aria-expanded');
      button.removeAttribute('aria-controls');
    }
    button.disabled = false;
  }, () => showStatus('Не удалось восстановить вход. Обновите страницу.'));

  button.addEventListener('click', async () => {
    if (auth.currentUser) {
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) signout.focus();
      return;
    }
    button.disabled = true;
    showStatus();
    try {
      await authSdk.signInWithPopup(auth, provider);
    } catch (error) {
      const messages = {
        'auth/popup-blocked': 'Браузер заблокировал окно Google. Разрешите всплывающие окна и попробуйте ещё раз.',
        'auth/unauthorized-domain': 'Для входа нужно добавить localhost в разрешённые домены Firebase Authentication.',
        'auth/network-request-failed': 'Не удалось подключиться. Проверьте интернет и попробуйте ещё раз.',
      };
      if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) {
        showStatus(messages[error.code] || 'Не удалось войти через Google. Попробуйте ещё раз.');
      }
    } finally {
      button.disabled = false;
    }
  });

  signout.addEventListener('click', async () => {
    signout.disabled = true;
    showStatus();
    try {
      await authSdk.signOut(auth);
      button.focus();
    } catch {
      showStatus('Не удалось выйти. Попробуйте ещё раз.');
    } finally {
      signout.disabled = false;
    }
  });
} catch {
  showStatus('Не удалось загрузить вход Google. Проверьте интернет и обновите страницу.');
}
