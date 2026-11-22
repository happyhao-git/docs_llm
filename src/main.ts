import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/main.css'
import './styles/refinement.css'
import './styles/site.css'

export async function mountApp() {
  const app = createApp(App).use(createPinia()).use(router)
  // Preserve the HTML loading surface until the first route is ready; an empty
  // RouterView must not replace it while route chunks are still downloading.
  await router.isReady()
  app.mount('#app')
}
