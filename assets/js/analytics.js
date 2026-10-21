// Vercel Web Analytics initialization
// Import and inject analytics tracking
import { inject } from '../../vendor/vercel-analytics.mjs';

// O script de analytics só é servido em deploys da Vercel. Em qualquer outro
// host ele devolve 404 — o que polui o console com um erro que não tem
// relação com o dashboard. Por isso a injeção é condicionada:
//
//   1. hosts locais (dev)          -> não injeta e não faz nenhuma requisição;
//   2. hosts padrão da Vercel      -> injeta direto, sem round-trip;
//   3. domínio próprio na Vercel   -> um HEAD barato decide se o script existe.
const INSIGHTS_PATH = '/_vercel/insights/script.js';
// O HEAD é só uma checagem de existência: não pode atrasar nem travar a
// inicialização do analytics se o host estiver lento.
const INSIGHTS_TIMEOUT_MS = 5000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

function isLocalHost(hostname) {
  return LOCAL_HOSTS.indexOf(hostname) > -1 || hostname.endsWith('.local');
}

function headWithTimeout(url, timeoutMs) {
  if (typeof AbortController === 'undefined') return fetch(url, { method: 'HEAD' });
  const controller = new AbortController();
  const timeout = timeoutMs || INSIGHTS_TIMEOUT_MS;
  const timer = setTimeout(function () { controller.abort(); }, timeout);
  return fetch(url, { method: 'HEAD', signal: controller.signal }).then(function (response) {
    clearTimeout(timer);
    return response;
  }, function (error) {
    clearTimeout(timer);
    throw error;
  });
}

function shouldInjectAnalytics() {
  if (typeof location === 'undefined' || !location.hostname) return Promise.resolve(false);
  if (isLocalHost(location.hostname)) return Promise.resolve(false);
  if (location.hostname.endsWith('.vercel.app')) return Promise.resolve(true);
  return headWithTimeout(INSIGHTS_PATH, INSIGHTS_TIMEOUT_MS)
    .then(function (response) { return response.ok; })
    .catch(function () { return false; });
}

// Initialize Vercel Analytics (apenas onde o script existe).
shouldInjectAnalytics().then(function (enabled) {
  if (!enabled) return;
  inject({
    mode: 'auto',
    debug: false
  });
});
