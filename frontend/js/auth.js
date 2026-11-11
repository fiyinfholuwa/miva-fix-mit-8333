/* Login and registration pages. */
(() => {
  'use strict';

  const { api, toast, validateForm, showServerErrors, liveValidate, setLoading, passwordToggles, setFieldError } = window.MivaFix;
  const $ = selector => document.querySelector(selector);
  const goToApp = () => { window.location.href = 'index.html'; };

  async function redirectIfAuthenticated() {
    try {
      const result = await api('/auth/me');
      if (result.authenticated) goToApp();
    } catch {
      // The form will show a useful message if the API is unavailable.
    }
  }

  async function signIn(form, credentials, button) {
    setLoading(button, true);
    try {
      const result = await api('/auth/login', { method: 'POST', body: credentials });
      toast(`${result.message} Redirecting to your desk…`);
      setTimeout(goToApp, 450);
    } catch (error) {
      setLoading(button, false);
      if (error.status === 401) {
        // Do not reveal which credential was wrong.
        showServerErrors(form, { message: 'That email and password combination was not recognised. Check both and try again.' });
      } else showServerErrors(form, error);
    }
  }

  const loginForm = $('#login-form');
  if (loginForm) {
    liveValidate(loginForm);
    loginForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!validateForm(loginForm)) return;
      signIn(loginForm, Object.fromEntries(new FormData(loginForm)), loginForm.querySelector('[type=submit]'));
    });
    document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
      loginForm.email.value = button.dataset.demo;
      loginForm.password.value = 'Password123!';
      signIn(loginForm, { email: button.dataset.demo, password: 'Password123!' }, loginForm.querySelector('[type=submit]'));
    }));
  }

  const registerForm = $('#register-form');
  if (registerForm) {
    liveValidate(registerForm);
    const password = registerForm.password;
    const confirm = registerForm.password_confirm;
    const meter = $('#password-strength');
    password.addEventListener('input', () => {
      const v = password.value;
      const score = !v ? 0 : [v.length >= 8, /[A-Z]/.test(v) && /[a-z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v) || v.length >= 12].filter(Boolean).length;
      meter.dataset.level = String(score);
      $('#password-hint').textContent = !v ? 'Use 8 or more characters.' : ['Too short', 'Weak — add numbers or symbols', 'Fair — add a capital letter or symbol', 'Good', 'Strong password'][score];
    });
    registerForm.addEventListener('submit', async event => {
      event.preventDefault();
      let valid = validateForm(registerForm);
      if (confirm.value && confirm.value !== password.value) { setFieldError(confirm, 'Passwords do not match.'); if (valid) confirm.focus(); valid = false; }
      if (!valid) return;
      const button = registerForm.querySelector('[type=submit]');
      const details = Object.fromEntries(new FormData(registerForm));
      delete details.password_confirm;
      setLoading(button, true);
      try {
        const result = await api('/auth/register', { method: 'POST', body: details });
        toast(`${result.message} Welcome to MivaFix.`);
        setTimeout(goToApp, 450);
      } catch (error) {
        setLoading(button, false);
        if (error.status === 409) setFieldError(registerForm.email, error.message);
        else showServerErrors(registerForm, error);
      }
    });
  }

  passwordToggles();
  redirectIfAuthenticated();
})();
