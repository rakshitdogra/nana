const themeToggle = document.querySelector('#themeToggle');
const signupModal = document.querySelector('[data-modal="signup"]');
const signinModal = document.querySelector('[data-modal="signin"]');
const openSignupBtn = document.querySelector('#openSignup');
const openSigninBtn = document.querySelector('#openSignin');
const closeButtons = document.querySelectorAll('[data-close-modal]');
const signupForm = document.querySelector('#signupForm');
const signinForm = document.querySelector('#signinForm');
const signupFeedback = document.querySelector('#signupFeedback');
const signinFeedback = document.querySelector('#signinFeedback');

const modalMap = {
  signup: signupModal,
  signin: signinModal,
};

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gps-theme', theme);
  themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
}

function hydrateTheme() {
  const saved = localStorage.getItem('gps-theme') || 'dark';
  setTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  setTheme(next);
}

function openModal(type) {
  const modal = modalMap[type];
  if (!modal) return;
  modal.classList.add('is-visible');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('is-visible');
  modal.setAttribute('aria-hidden', 'true');
}

function closeAllModals() {
  Object.values(modalMap).forEach((modal) => closeModal(modal));
}

async function submitForm(form, endpoint, feedbackNode) {
  if (!form) return;
  feedbackNode.textContent = '';
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong');
    }

    // Store token for Vercel deployment
    if (data.token) {
      localStorage.setItem('authToken', data.token);
    }

    window.location.href = data.redirect || '/app.html';
  } catch (error) {
    feedbackNode.textContent = error.message;
  } finally {
    submitBtn.disabled = false;
  }
}

function bindEvents() {
  themeToggle.addEventListener('click', toggleTheme);
  openSignupBtn?.addEventListener('click', () => openModal('signup'));
  openSigninBtn?.addEventListener('click', () => openModal('signin'));
  closeButtons.forEach((btn) =>
    btn.addEventListener('click', (event) => closeModal(event.target.closest('.modal')))
  );
  Object.values(modalMap).forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });
  signupForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitForm(signupForm, '/sessions/signup', signupFeedback);
  });
  signinForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitForm(signinForm, '/sessions/login', signinFeedback);
  });
}

hydrateTheme();
bindEvents();
