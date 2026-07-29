<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'

const { multiMapMode, multiMapModeOptions, openMultiMap, openMultiMapWindow } = useWeatherViewContext()

const menuOpen = ref(false)
let closeTimer = 0

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

// 离开时留一点延迟，避免鼠标从按钮移到菜单的间隙里菜单被收起。
function openMenu() {
  window.clearTimeout(closeTimer)
  menuOpen.value = true
}

function closeMenu() {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => {
    menuOpen.value = false
  }, 120)
}

function selectMode(mode) {
  window.clearTimeout(closeTimer)
  menuOpen.value = false
  openMultiMap(mode)
}

// 右键在独立窗口打开多图工作区。
//
// 监听挂在 wrapper 上而不是图标按钮上：hover 会立即展开模式菜单，用户的光标
// 通常已经落在某个菜单项上，右键事件的 target 是菜单项而非图标本身。wrapper
// 同时包含图标与菜单，两处右键都能冒泡到这里。
//
// 命中菜单项时用该项对应的模式开窗；点在图标或菜单空白处则沿用当前模式。
// contextmenu 是 Firefox/Edge 认可的用户激活事件，同步调用 window.open()
// 不会被弹窗拦截；preventDefault 阻止默认右键菜单。
function handleContextMenu(event) {
  event.preventDefault()
  const modeEl = event.target instanceof Element ? event.target.closest('[data-mode]') : null
  const mode = modeEl?.dataset.mode || multiMapMode.value || 'forecast'
  window.clearTimeout(closeTimer)
  menuOpen.value = false
  openMultiMapWindow(mode)
}

onBeforeUnmount(() => {
  window.clearTimeout(closeTimer)
})
</script>

<template>
  <div
    class="mm-fab-wrapper"
    @mouseenter="openMenu"
    @mouseleave="closeMenu"
    @contextmenu="handleContextMenu"
  >
    <button
      type="button"
      class="mm-fab"
      aria-label="多图模式"
      title="多图模式（右键在独立窗口打开）"
      :aria-expanded="menuOpen"
      aria-haspopup="true"
      @focus="openMenu"
      @blur="closeMenu"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    </button>

    <div v-if="menuOpen" class="mm-menu" role="menu">
      <section v-for="group in modeGroups" :key="group.label" class="mm-mode-group">
        <span>{{ group.label }}</span>
        <button
          v-for="option in group.options"
          :key="option.value"
          type="button"
          role="menuitem"
          :data-mode="option.value"
          :title="`${option.label}（右键在独立窗口打开）`"
          @click="selectMode(option.value)"
        >
          {{ option.label }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mm-fab-wrapper {
  position: relative;
  display: inline-flex;
}

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

.mm-fab:hover,
.mm-fab:focus-visible {
  color: #fff;
  background: #1f7a8c;
  border-color: #1f7a8c;
}

.mm-menu {
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(2, max-content);
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(21, 31, 46, 0.1);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(22, 33, 47, 0.16);
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
  white-space: nowrap;
}

.mm-menu button {
  width: max-content;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #384456;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.mm-menu button:hover,
.mm-menu button:focus-visible {
  border-color: #b7d6dc;
  background: #edf7f8;
  color: #176677;
}
</style>
