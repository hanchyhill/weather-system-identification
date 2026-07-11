<script setup>
// 实时更新订阅按钮：让用户显式确认订阅 Web Push。
// 状态：不支持 / 通知被拒 / 未订阅 / 已订阅 / 处理中。
// 非安全上下文（局域网 IP + HTTP）下按钮禁用并提示需 https。
import { onMounted, ref } from 'vue'

import {
  getNotificationPermission,
  getSubscriptionState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush
} from '../utils/pushClient'

const supported = ref(false)
const subscribed = ref(false)
const permission = ref('default')
const busy = ref(false)
const message = ref('')

async function refreshState() {
  supported.value = isPushSupported()
  permission.value = getNotificationPermission()
  subscribed.value = supported.value ? await getSubscriptionState() : false
}

onMounted(refreshState)

async function onClick() {
  if (busy.value || !supported.value) return
  busy.value = true
  message.value = ''
  try {
    if (subscribed.value) {
      await unsubscribeFromPush()
      subscribed.value = false
      message.value = '已取消订阅'
    } else {
      await subscribeToPush()
      subscribed.value = true
      message.value = '订阅成功，新数据就绪时会通知你'
    }
  } catch (error) {
    message.value = error && error.message ? error.message : '操作失败'
    permission.value = getNotificationPermission()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="push-subscribe">
    <button
      class="push-subscribe__btn"
      :class="{ 'is-on': subscribed }"
      :disabled="busy || !supported || permission === 'denied'"
      :title="!supported ? '当前环境不支持实时推送（需 https 或 localhost）' : ''"
      @click="onClick"
    >
      <span class="push-subscribe__dot" :class="{ 'is-on': subscribed }"></span>
      <template v-if="!supported">实时推送不可用</template>
      <template v-else-if="permission === 'denied'">通知已被拒绝</template>
      <template v-else-if="busy">处理中…</template>
      <template v-else-if="subscribed">已订阅实时更新</template>
      <template v-else>订阅实时更新</template>
    </button>
    <span v-if="message" class="push-subscribe__msg">{{ message }}</span>
  </div>
</template>

<style scoped>
.push-subscribe {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
}

.push-subscribe__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  line-height: 1;
  color: #1f2937;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #d1d5db;
  border-radius: 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.push-subscribe__btn:hover:not(:disabled) {
  background: #ffffff;
  border-color: #9ca3af;
}

.push-subscribe__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.push-subscribe__btn.is-on {
  color: #065f46;
  border-color: #34d399;
  background: rgba(209, 250, 229, 0.95);
}

.push-subscribe__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
}

.push-subscribe__dot.is-on {
  background: #10b981;
}

.push-subscribe__msg {
  max-width: 240px;
  padding: 4px 8px;
  font-size: 12px;
  color: #374151;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
</style>
