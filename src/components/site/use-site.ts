import { ref } from 'vue'
import type { SiteSettings } from '@/types'
const settings = ref<SiteSettings | null>(null)
const theme = ref<'light' | 'dark'>('light')
export const SITE_CACHE_KEY = 'linkapi:site-settings:v1'
export const SITE_CACHE_TTL = 60 * 60_000
let loadedAt = 0
let pending: Promise<void> | null = null
function validSettings(value: unknown): value is SiteSettings {
  const s = value as SiteSettings
  return !!s && typeof s.siteName === 'string' && typeof s.subtitle === 'string'
    && typeof s.consoleUrl === 'string' && (s.consoleUrl === '' || /^https?:\/\//.test(s.consoleUrl))
    && typeof s.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.accentColor)
}
function setSettings(value: SiteSettings, savedAt: number) {
  settings.value = value
  loadedAt = savedAt
  document.documentElement.style.setProperty('--accent', value.accentColor)
}
export function applyTheme(value: 'light' | 'dark') {
  theme.value = value; document.documentElement.dataset.theme = value
  try { localStorage.setItem('docs-theme', value) } catch { /* Optional storage. */ }
}
export function useSite() {
  function initializeTheme() {
    let stored: string | null = null
    try { stored = localStorage.getItem('docs-theme') } catch { /* Light by default. */ }
    applyTheme(stored === 'dark' ? 'dark' : 'light')
  }
  async function loadSettings() {
    if (settings.value && Date.now() - loadedAt >= 0 && Date.now() - loadedAt < SITE_CACHE_TTL) return
    try {
      const raw = localStorage.getItem(SITE_CACHE_KEY)
      if (raw && raw.length < 10_000) {
        const cached = JSON.parse(raw)
        const age = Date.now() - cached.savedAt
        if (typeof cached.savedAt === 'number' && age >= 0 && age < SITE_CACHE_TTL && validSettings(cached.settings)) {
          setSettings(cached.settings, cached.savedAt)
          return
        }
      }
    } catch { /* Browser storage is optional. */ }
    if (!pending) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      pending = fetch('/api/public/site-config', { signal: controller.signal }).then(async r => {
        if (!r.ok) throw new Error('站点设置暂时不可用')
        const value = (await r.json()).settings
        if (!validSettings(value)) throw new Error('站点设置暂时不可用')
        setSettings(value, Date.now())
        try { localStorage.setItem(SITE_CACHE_KEY, JSON.stringify({ savedAt: loadedAt, settings: value })) } catch { /* Optional storage. */ }
      }).finally(() => { clearTimeout(timer); pending = null })
    }
    return pending
  }
  return { settings, theme, initializeTheme, loadSettings, applyTheme }
}
