import { modelCatalog } from './features/models/catalog-cache'
import { loadDocsView, loadModelsView } from './route-views'

const fallback = document.getElementById('app-loading')
const status = document.getElementById('app-loading-status')
const retry = document.getElementById('app-loading-retry') as HTMLAnchorElement | null
if (retry) retry.href = location.pathname + location.search + location.hash
try { document.documentElement.dataset.theme = localStorage.getItem('docs-theme') === 'dark' ? 'dark' : 'light' } catch { /* Light by default. */ }

function showLoadError() {
  if (!fallback?.isConnected) return
  fallback.dataset.failed = 'true'
  if (status) status.textContent = '加载较慢，请重试。'
}

const timeout = setTimeout(showLoadError, 12_000)
window.addEventListener('vite:preloadError', showLoadError)

const path = location.pathname.replace(/\/$/, '') || '/'
// This starts before downloading/parsing Vue and the page components.
if (path === '/models') void modelCatalog.load().catch(() => undefined)
const view = path === '/models' ? loadModelsView()
  : path === '/' || path.startsWith('/docs/') ? loadDocsView() : Promise.resolve()

void Promise.all([view, import('./main').then(({ mountApp }) => mountApp())])
  .then(() => { fallback?.remove() })
  .catch(showLoadError)
  .finally(() => { clearTimeout(timeout); window.removeEventListener('vite:preloadError', showLoadError) })
