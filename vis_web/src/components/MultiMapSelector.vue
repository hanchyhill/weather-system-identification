<script setup>
import { PanelsTopLeft } from 'lucide-vue-next'
import { NPopover } from 'naive-ui'
import { computed } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'

const { multiMapModeOptions, openMultiMap } = useWeatherViewContext()

const modeGroups = computed(() => [
  {
    label: '单轴模式',
    options: multiMapModeOptions.filter((option) => option.group === 'single')
  },
  {
    label: '多轴模式',
    options: multiMapModeOptions.filter((option) => option.group === 'dual')
  }
].filter((group) => group.options.length))
</script>

<template>
  <n-popover trigger="hover" placement="right-start" :show-arrow="false" style="width: auto;">
    <template #trigger>
      <button type="button" class="mm-fab" aria-label="多图模式" title="多图模式">
        <PanelsTopLeft :size="20" />
      </button>
    </template>

    <div class="mm-menu">
      <section v-for="group in modeGroups" :key="group.label" class="mm-mode-group">
        <span>{{ group.label }}</span>
        <button
          v-for="option in group.options"
          :key="option.value"
          type="button"
          @click="openMultiMap(option.value)"
        >
          {{ option.label }}
        </button>
      </section>
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
  grid-template-columns: repeat(2, max-content);
  gap: 10px;
}

.mm-mode-group {
  display: grid;
  gap: 3px;
  justify-items: start;
}

.mm-mode-group + .mm-mode-group {
  padding-left: 10px;
  border-left: 1px solid #e2e8f0;
}

.mm-mode-group > span {
  padding: 0 4px 2px;
  color: #7a8698;
  font-size: 11px;
}

.mm-menu button {
  width: max-content;
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
