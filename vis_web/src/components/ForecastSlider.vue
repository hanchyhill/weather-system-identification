<script setup>
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
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
        v-model="fcHourIndex"
        v-bind="sliderOpts"
        :tooltip-formatter="getSliderTooltip"
        :marks="markSlider"
        :min="0"
        :max="sliderIndexCount - 1"
      />
    </div>
    <div class="forecast-slider-readout">
      <strong>+{{ fcHour }} h</strong>
      <span>{{ forecastValidTimeLabel }} UTC</span>
    </div>
  </div>
</template>
