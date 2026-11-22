// Shared loaders let startup request the initial view alongside the app runtime,
// while other public sections and admin tools stay off the critical path.
export const loadDocsView = () => import('./views/DocsView.vue')
export const loadModelsView = () => import('./features/models/ModelsView.vue')
