import { createRouter, createWebHistory } from 'vue-router'
import { loadDocsView, loadModelsView } from './route-views'
import { DEFAULT_MODELS_QUERY } from './lib/model-entry'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'docs-home', component: loadDocsView },
    { path: '/docs/:slug', name: 'docs-document', component: loadDocsView },
    { path: '/models', name: 'models', component: loadModelsView },
    { path: '/admin/models', name: 'admin-models', component: () => import('@/features/models/AdminModelsView.vue') },
    { path: '/admin/login', name: 'admin-login', component: () => import('@/views/AdminLoginView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 86 }
    return { top: 0, behavior: 'instant' }
  }
})

router.beforeEach(to => {
  if (to.name === 'models' && Object.keys(to.query).length === 0) {
    return { path: '/models', query: { ...DEFAULT_MODELS_QUERY }, hash: to.hash, replace: true }
  }
})

router.afterEach((to) => {
  if (to.name === 'models') document.title = '模型广场 · 模型与价格 | AiLink'
  if (to.name === 'admin-models') document.title = '模型广场管理 | AiLink'
  if (to.name === 'admin') document.title = '文档管理 | AiLink'
  if (to.name === 'admin-login') document.title = '管理员登录 | AiLink'
})
