import i18n from './i18n.js';

function updateGeneratedContent() {
  document.querySelectorAll('[data-current-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
}

function setupLanguageSwitch() {
  const select = document.getElementById('langSwitch');
  if (!select) return;
  select.value = i18n.resolveLocale(i18n.locale);
  select.addEventListener('change', async () => {
    const newLocale = i18n.resolveLocale(select.value);
    if (newLocale === i18n.locale) return;
    await i18n.switchLocale(newLocale);
    select.value = i18n.locale;
    updateGeneratedContent();
  });
}

function setupDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;

  const html = document.documentElement;
  if (
    localStorage.theme === 'dark' ||
    (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
  ) {
    html.classList.add('dark');
  }

  themeToggle.addEventListener('click', () => {
    if (html.classList.contains('dark')) {
      html.classList.remove('dark');
      localStorage.theme = 'light';
    } else {
      html.classList.add('dark');
      localStorage.theme = 'dark';
    }
  });
}

async function init() {
  try {
    await i18n.init();
    setupLanguageSwitch();
    setupDarkMode();
    updateGeneratedContent();
  } catch (error) {
    console.error('static page init failed:', error);
  }
}

init();
