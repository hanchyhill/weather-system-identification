<script setup>
import { ChevronDown, ChevronUp, Palette } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { colorLegendsForLayers } from '../utils/colorLegend'

const props = defineProps({
  level: {
    type: [String, Number],
    required: true
  },
  selectedLayerTypes: {
    type: Array,
    default: () => []
  }
})

const collapsed = ref(false)
const legends = computed(() => colorLegendsForLayers(props.selectedLayerTypes, props.level))

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <aside v-if="legends.length" class="color-legend" :class="{ 'color-legend-collapsed': collapsed }">
    <button
      type="button"
      class="color-legend-toggle"
      :aria-expanded="!collapsed"
      :aria-label="collapsed ? '展开色标' : '折叠色标'"
      @click="toggle"
    >
      <Palette :size="14" />
      <span>色标</span>
      <ChevronDown v-if="collapsed" :size="15" />
      <ChevronUp v-else :size="15" />
    </button>

    <div v-show="!collapsed" class="color-legend-list">
      <section v-for="item in legends" :key="item.type" class="color-legend-item">
        <header>{{ item.title }} <span>({{ item.unit }})</span></header>
        <div class="color-legend-content">
          <div class="color-legend-scale" aria-hidden="true">
            <i v-for="(color, index) in item.colors" :key="index" :style="{ backgroundColor: color }" />
          </div>
          <div class="color-legend-ticks" aria-hidden="true">
            <span
              v-for="tick in item.ticks"
              :key="tick.label"
              :style="{ bottom: `${tick.offset}%` }"
            >{{ tick.label }}</span>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.color-legend {
  position: absolute;
  right: 14px;
  bottom: 52px;
  z-index: 6;
  width: fit-content;
  max-width: min(132px, calc(100% - 28px));
  overflow: hidden;
  border: 1px solid rgba(21, 31, 46, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 24px rgba(22, 33, 47, 0.12);
  backdrop-filter: blur(8px);
}

.color-legend-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-bottom: 1px solid rgba(21, 31, 46, 0.1);
  background: transparent;
  color: #253244;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.color-legend-toggle svg:last-child {
  margin-left: auto;
}

.color-legend-toggle:hover {
  background: rgba(31, 122, 140, 0.08);
  color: #176474;
}

.color-legend-collapsed {
  min-width: 0;
}

.color-legend-collapsed .color-legend-toggle {
  border-bottom: 0;
}

.color-legend-list {
  display: grid;
  gap: 8px;
  max-height: min(430px, calc(100vh - 190px));
  padding: 8px;
  overflow-y: auto;
}

.color-legend-item header {
  margin-bottom: 4px;
  color: #253244;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
}

.color-legend-item header span {
  color: #6b7788;
  font-weight: 400;
}

.color-legend-content {
  display: flex;
  gap: 5px;
  height: 128px;
}

.color-legend-scale {
  display: flex;
  flex: 0 0 15px;
  flex-direction: column-reverse;
  overflow: hidden;
  border: 1px solid rgba(21, 31, 46, 0.22);
}

.color-legend-scale i {
  flex: 1 1 0;
}

.color-legend-ticks {
  position: relative;
  flex: 0 0 38px;
  color: #59677a;
  font-size: 10px;
  line-height: 1;
}

.color-legend-ticks span {
  position: absolute;
  transform: translateY(50%);
  white-space: nowrap;
}

.color-legend-ticks span::before {
  display: inline-block;
  width: 3px;
  margin-right: 3px;
  border-top: 1px solid #8994a3;
  content: '';
  vertical-align: middle;
}
</style>
