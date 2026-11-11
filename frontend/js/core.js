/* Shared helpers for every MivaFix page: AJAX client, toasts, icons and inline form validation. */
(() => {
  'use strict';

  const API = window.MIVAFIX_API_BASE || 'https://miva.unifiechat.com/api';

  const ICONS = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    send: '<path d="m22 2-11 11M22 2l-7 20-4-9-9-4z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  };

  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  async function api(path, options = {}) {
    const config = { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } };
    if (config.body instanceof FormData) delete config.headers['Content-Type'];
    else if (config.body && typeof config.body !== 'string') config.body = JSON.stringify(config.body);
    let response;
    try {
      response = await fetch(`${API}${path}`, config);
    } catch {
      const error = new Error('We could not reach the MivaFix server. Check your connection and try again.');
      error.network = true;
      throw error;
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: 'The server returned an unexpected response.' }; }
    if (!response.ok) {
      const error = new Error(data.message || 'Something went wrong.');
      error.status = response.status;
      error.details = data.details || {};
      throw error;
    }
    return data;
  }

  function toast(message, type = 'success') {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const glyph = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
    item.innerHTML = `<span class="toast-icon">${icon(glyph, 'icon-sm')}</span><span class="toast-message"></span><button class="toast-close" type="button" aria-label="Dismiss">&times;</button>`;
    item.querySelector('.toast-message').textContent = message;
    const dismiss = () => { item.classList.add('leaving'); setTimeout(() => item.remove(), 200); };
    item.querySelector('.toast-close').addEventListener('click', dismiss);
    region.append(item);
    setTimeout(dismiss, type === 'error' ? 6000 : 4200);
  }

  /* ---------- Inline form validation ---------- */
  function fieldWrapper(input) { return input.closest('.field, label'); }

  function setFieldError(input, message) {
    const wrapper = fieldWrapper(input);
    if (!wrapper) return;
    let slot = wrapper.querySelector('.field-error');
    if (!slot) { slot = document.createElement('span'); slot.className = 'field-error'; wrapper.append(slot); }
    slot.textContent = message || '';
    wrapper.classList.toggle('has-error', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearErrors(form) {
    form.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    form.querySelector('.form-alert')?.remove();
  }

  function messageFor(input) {
    const name = input.dataset.label || 'This field';
    const v = input.validity;
    if (v.valueMissing) return input.tagName === 'SELECT' ? `Please choose a ${name.toLowerCase()}.` : `${name} is required.`;
    if (v.typeMismatch && input.type === 'email') return 'Enter a valid email address, e.g. name@miva.edu.ng.';
    if (v.tooShort) return `${name} must be at least ${input.minLength} characters (currently ${input.value.trim().length}).`;
    if (v.patternMismatch) return input.dataset.patternMessage || `${name} is not in the expected format.`;
    return input.validationMessage;
  }

  /** Validates every field with HTML constraints; shows inline messages; returns true when valid. */
  function validateForm(form) {
    clearErrors(form);
    let first = null;
    form.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.type === 'file' || input.disabled) return;
      if (typeof input.value === 'string' && input.type !== 'password') {
        // Treat whitespace-only answers as empty.
        if (input.required && !input.value.trim()) input.value = '';
      }
      if (!input.checkValidity()) { setFieldError(input, messageFor(input)); first = first || input; }
    });
    if (first) first.focus();
    return !first;
  }

  /** Maps API 422 `details` onto fields; falls back to a form-level alert. */
  function showServerErrors(form, error) {
    const details = error.details || {};
    let mapped = false;
    Object.entries(details).forEach(([name, message]) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (input) { setFieldError(input, message); mapped = true; }
    });
    if (!mapped) {
      form.querySelector('.form-alert')?.remove();
      const alert = document.createElement('div');
      alert.className = 'form-alert';
      alert.setAttribute('role', 'alert');
      alert.innerHTML = `${icon('alert')}<span></span>`;
      alert.querySelector('span').textContent = error.message;
      form.prepend(alert);
    } else {
      form.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus();
    }
  }

  /** Re-validates a field as the user corrects it, once it has shown an error. */
  function liveValidate(form) {
    form.noValidate = true;
    form.addEventListener('input', event => {
      const input = event.target;
      if (fieldWrapper(input)?.classList.contains('has-error')) setFieldError(input, input.checkValidity() ? '' : messageFor(input));
    });
    form.addEventListener('change', event => {
      const input = event.target;
      if (input.tagName === 'SELECT' && fieldWrapper(input)?.classList.contains('has-error')) setFieldError(input, input.checkValidity() ? '' : messageFor(input));
    });
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    button.setAttribute('aria-busy', String(loading));
  }

  function passwordToggles(root = document) {
    root.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
      const input = button.closest('.password-wrap').querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(show));
    }));
  }

  window.MivaFix = { API, api, toast, icon, escapeHtml, validateForm, showServerErrors, liveValidate, setFieldError, clearErrors, setLoading, passwordToggles };
})();
