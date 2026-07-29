<script setup>
import { ChevronLeft, ChevronRight, CircleAlert } from 'lucide-vue-next'
import {
  NButton,
  NButtonGroup,
  NTooltip
} from 'naive-ui'
import VueSlider from 'vue-slider-component'
import 'vue-slider-component/theme/default.css'

import { useWeatherViewContext } from '../context/weatherViewContext'

const {
  changeFcHour,
  fcHour,
  fcHourIndex,
  forecastValidTimeLabel,
  getSliderTooltip,
  filteredFcHourCount,
  markSlider,
  scrollForecastSlider,
  sliderIndexCount,
  sliderOpts
} = useWeatherViewContext()
</script>

<template>
  <div class="forecast-slider-row">
    <div class="forecast-slider-actions">
      <span>预报时效</span>
      <n-tooltip v-if="filteredFcHourCount" trigger="hover">
        <template #trigger>
          <CircleAlert class="forecast-slider-filter-hint" :size="15" aria-label="存在已过滤的无数据时效" />
        </template>
        当前图层组合已过滤 {{ filteredFcHourCount }} 个无数据时效
      </n-tooltip>
      <n-button-group size="small">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button secondary @click="changeFcHour('index', -1)" @contextmenu.prevent="changeFcHour('hour', -24)">
              <ChevronLeft :size="16" />
            </n-button>
          </template>
          左键减 1 档，右键减 24 小时
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button secondary @click="changeFcHour('index', 1)" @contextmenu.prevent="changeFcHour('hour', 24)">
              <ChevronRight :size="16" />
            </n-button>
          </template>
          左键加 1 档，右键加 24 小时
        </n-tooltip>
      </n-button-group>
    </div>
    <div class="forecast-slider-container" @wheel="scrollForecastSlider">
      <vue-slider
        v-if="sliderIndexCount"
        v-model="fcHourIndex"
        v-bind="sliderOpts"
        :tooltip-formatter="getSliderTooltip"
        :marks="markSlider"
        :min="0"
        :max="sliderIndexCount - 1"
        aria-label="预报时效"
      />
      <span v-else class="forecast-slider-empty">当前图层组合暂无可用预报时效</span>
    </div>
    <div class="forecast-slider-readout">
      <strong v-if="sliderIndexCount">+{{ fcHour }} h</strong>
      <strong v-else>暂无时效</strong>
      <span v-if="sliderIndexCount">{{ forecastValidTimeLabel }} UTC</span>
      <span v-else>当前组合无可用数据</span>
    </div>
  </div>
</template>
