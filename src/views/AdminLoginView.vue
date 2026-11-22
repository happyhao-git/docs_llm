<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from 'lucide-vue-next'
import { api, jsonBody } from '@/lib/api'
import { BRAND_ICON_URL } from '@/lib/brand'

const router = useRouter(), route = useRoute()
const username = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const error = ref('')

async function login() {
  error.value = ''
  submitting.value = true
  try {
    await api('/api/admin/login', { method: 'POST', body: jsonBody({ username: username.value, password: password.value }) })
    await router.replace(route.query.redirect === '/admin/models' ? '/admin/models' : '/admin')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <a class="back-link" href="/"><ArrowLeft :size="17" /> 返回文档</a>
    <section class="login-panel">
      <div class="login-brand"><img class="brand-mark" :src="BRAND_ICON_URL" alt="" width="36" height="36" /><span>AiLink 文档中心</span></div>
      <div class="login-heading">
        <div class="login-icon"><LockKeyhole :size="23" /></div>
        <h1>管理后台</h1>
        <p>登录以编辑和发布文档</p>
      </div>
      <form @submit.prevent="login">
        <label class="field-label">
          <span>用户名</span>
          <input v-model.trim="username" autocomplete="username" required maxlength="80" />
        </label>
        <label class="field-label">
          <span>密码</span>
          <span class="password-input">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required />
            <button type="button" class="icon-button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
              <EyeOff v-if="showPassword" :size="17" /><Eye v-else :size="17" />
            </button>
          </span>
        </label>
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <button class="primary-button login-submit" type="submit" :disabled="submitting">
          <span v-if="submitting" class="button-spinner" />
          {{ submitting ? '正在登录' : '登录' }}
        </button>
      </form>
    </section>
  </main>
</template>
