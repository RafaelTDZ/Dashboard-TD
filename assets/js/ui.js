(function (global) {
  'use strict';

  const TOAST_STYLES = {
    success: { icon: 'fa-circle-check', accent: 'text-emerald-400', border: 'border-emerald-500/40' },
    error: { icon: 'fa-circle-exclamation', accent: 'text-red-400', border: 'border-red-500/40' },
    warning: { icon: 'fa-triangle-exclamation', accent: 'text-amber-400', border: 'border-amber-500/40' },
    info: { icon: 'fa-circle-info', accent: 'text-brand-400', border: 'border-brand-500/40' }
  };

  let lastModalTrigger = null;
  let modalKeydownHandler = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function toNumber(value) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatUSDFull(value) {
    return '$' + toNumber(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatCurrencyFull(value, currency) {
    const requested = String(currency || 'USD').trim().toUpperCase();
    const code = ['USD', 'CNY', 'BRL', 'EUR', 'GBP', 'JPY'].indexOf(requested) > -1 ? requested : 'USD';
    const locale = code === 'USD' ? 'en-US' : (code === 'CNY' ? 'zh-CN' : 'pt-BR');
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: code === 'CNY' ? 'code' : 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(toNumber(value));
  }

  function formatCompactUSD(value) {
    const number = toNumber(value);
    const abs = Math.abs(number);
    if (abs >= 1e9) return '$' + (number / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'B';
    if (abs >= 1e6) return '$' + (number / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
    if (abs >= 1e3) return '$' + (number / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'K';
    return '$' + number.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  function formatNumber(value, decimals) {
    const digits = decimals || 0;
    return toNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatPercent(value) {
    return toNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function formatDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR') + ' às ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const context = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, wait);
    };
  }

  function toast(message, type, title) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const style = TOAST_STYLES[type] || TOAST_STYLES.info;
    const card = document.createElement('div');
    card.className = 'toast-card pointer-events-auto bg-slate-900/95 backdrop-blur border ' + style.border +
      ' rounded-xl shadow-2xl p-3.5 pr-9 text-xs text-slate-200 relative';
    card.setAttribute('role', 'status');
    card.innerHTML =
      '<div class="flex items-start gap-2.5">' +
      '<i class="fa-solid ' + style.icon + ' ' + style.accent + ' mt-0.5"></i>' +
      '<div class="min-w-0">' +
      (title ? '<p class="font-bold text-white mb-0.5">' + escapeHtml(title) + '</p>' : '') +
      '<p class="leading-relaxed break-words">' + escapeHtml(message) + '</p>' +
      '</div></div>' +
      '<button type="button" data-toast-close class="absolute top-2 right-2 text-slate-500 hover:text-white transition" aria-label="Fechar aviso">' +
      '<i class="fa-solid fa-xmark"></i></button>';
    container.appendChild(card);
    requestAnimationFrame(function () { card.classList.add('toast-in'); });
    const remove = function () {
      card.classList.remove('toast-in');
      card.classList.add('toast-out');
      setTimeout(function () { card.remove(); }, 220);
    };
    card.querySelector('[data-toast-close]').addEventListener('click', remove);
    setTimeout(remove, type === 'error' ? 7000 : 4500);
    return card;
  }

  function copyText(text) {
    const fallback = function () {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      area.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    }
    return Promise.resolve(fallback());
  }

  function downloadFile(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function setChartEmpty(canvasId, isEmpty) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const box = canvas.closest('.chart-box');
    if (!box) return;
    const overlay = box.querySelector('.chart-empty');
    if (!overlay) return;
    overlay.classList.toggle('hidden', !isEmpty);
  }

  function openModal(options) {
    options = options || {};
    const modal = document.getElementById('modal');
    if (!modal) return;
    lastModalTrigger = document.activeElement;
    document.getElementById('modal-title').innerHTML = escapeHtml(options.title || '');
    document.getElementById('modal-body').innerHTML = options.html || '';
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
    const closeButton = modal.querySelector('[data-modal-close-button]');
    if (closeButton) closeButton.focus();

    if (modalKeydownHandler) document.removeEventListener('keydown', modalKeydownHandler);
    modalKeydownHandler = function (event) {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(function (element) { return !element.disabled && element.getClientRects().length > 0; });
      if (!focusable.length) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', modalKeydownHandler);
  }

  function closeModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    if (modalKeydownHandler) {
      document.removeEventListener('keydown', modalKeydownHandler);
      modalKeydownHandler = null;
    }
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
    if (lastModalTrigger && lastModalTrigger.isConnected && typeof lastModalTrigger.focus === 'function') lastModalTrigger.focus();
    lastModalTrigger = null;
  }

  global.UI = {
    escapeHtml: escapeHtml,
    toNumber: toNumber,
    formatUSDFull: formatUSDFull,
    formatCurrencyFull: formatCurrencyFull,
    formatCompactUSD: formatCompactUSD,
    formatNumber: formatNumber,
    formatPercent: formatPercent,
    formatDateTime: formatDateTime,
    debounce: debounce,
    toast: toast,
    copyText: copyText,
    downloadFile: downloadFile,
    setChartEmpty: setChartEmpty,
    openModal: openModal,
    closeModal: closeModal
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
