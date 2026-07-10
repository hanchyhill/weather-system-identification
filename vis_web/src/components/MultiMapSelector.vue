<script setup>
import { PanelsTopLeft } from 'lucide-vue-next'
import { NPopover } from 'naive-ui'

import { useWeatherViewContext } from '../context/weatherViewContext'

const { multiMapModeOptions, openMultiMap } = useWeatherViewContext()
</script>

<template>
  <n-popover trigger="hover" placement="right-start" :show-arrow="false" style="width: 156px;">
    <template #trigger>
      <button type="button" class="mm-fab" aria-label="多图模式" title="多图模式">
        <PanelsTopLeft :size="20" />
      </button>
    </template>

    <div class="mm-menu">
      <strong>多图模式</strong>
      <button
        v-for="option in multiMapModeOptions"
        :key="option.value"
        type="button"
        @click="openMultiMap(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </n-popover>
</template>

<style scoped>
.mm-fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(21, 31, 46, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 24px rgba(22, 33, 47, 0.12);
  backdrop-filter: blur(8px);
  color: #1f7a8c;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.mm-fab:hover {
  color: #fff;
  background: #1f7a8c;
  border-color: #1f7a8c;
}

.mm-menu {
  display: grid;
  gap: 6px;
}

.mm-menu strong {
  padding: 2px 4px 6px;
  color: #172033;
  font-size: 13px;
}

.mm-menu button {
  min-height: 30px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #384456;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.mm-menu button:hover {
  border-color: #b7d6dc;
  background: #edf7f8;
  color: #176677;
}
</style>
