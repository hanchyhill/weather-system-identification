<script setup>
import { CalendarClock } from 'lucide-vue-next'
import { NPopover } from 'naive-ui'
import { computed, reactive } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'

const {
  applyInitAndFcHour,
  DEFAULT_FC_HOURS,
  fcHour,
  initTime
} = useWeatherViewContext()

// 起报时次每 12 小时一档，向前追溯的档数（与参考实现一致，共 11 行）。
const INIT_TIME_ROW_COUNT = 11
// 未来起报时次序列（相对当前起报时次的小时偏移），置于表格顶部，最新在最上。
const FUTURE_INIT_OFFSETS = [48, 36, 24, 12]
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 预报时效（小时），直接取本项目的 DEFAULT_FC_HOURS，保证时次与后端产品匹配。
const fcHoursNumeric = DEFAULT_FC_HOURS.map((value) => Number(value))

const tableHighlight = reactive({ columnIndex: NaN, rowIndex: NaN })

function pad2(value) {
  return String(value).padStart(2, '0')
}

// 由 YYYYMMDDHH 字符串解析出 UTC 时间戳（毫秒）。
function parseInitTimeMs(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour))
}

// UTC 毫秒 -> YYYYMMDDHH 字符串（起报时次格式）。
function formatInitTime(ms) {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}`
}

// 北京时（UTC+8）视图，用 getUTC* 读取即为北京墙钟时间。
function toBeijing(ms) {
  return new Date(ms + 8 * 60 * 60 * 1000)
}

// 北京时日期标签：DD-MMM。
function fmtBeijingDate(ms) {
  const bj = toBeijing(ms)
  return `${pad2(bj.getUTCDate())}-${MONTH_ABBR[bj.getUTCMonth()]}`
}

// 北京时小时标签：HH。
function fmtBeijingHour(ms) {
  return pad2(toBeijing(ms).getUTCHours())
}

// 行首标签（起报时次，北京时）：DD-MMM HH。
function fmtBeijingRow(ms) {
  return `${fmtBeijingDate(ms)} ${fmtBeijingHour(ms)}`
}

// 按北京时“同一天”把有效时刻分组，形成列分组。
function splitByDate(timeList) {
  return timeList.reduce((acc, ms, index) => {
    if (index === 0) return [[ms]]
    const prevDate = toBeijing(timeList[index - 1]).getUTCDate()
    const curDate = toBeijing(ms).getUTCDate()
    if (prevDate === curDate) {
      acc[acc.length - 1].push(ms)
    } else {
      acc.push([ms])
    }
    return acc
  }, [])
}

// 表头（列分组）：日期标签 + 各列有效时刻的小时。
const timeTableHeader = computed(() => {
  const baseMs = parseInitTimeMs(initTime.value)
  if (baseMs == null) return []

  const firstRowTimes = fcHoursNumeric.map((fc) => baseMs + fc * 60 * 60 * 1000)
  const columns = splitByDate(firstRowTimes)

  let columnIndex = 0
  return columns.map((group) => {
    const hourList = group.map((ms) => {
      const info = { hourFmt: fmtBeijingHour(ms), columnIndex }
      columnIndex += 1
      return info
    })
    return {
      localDateFmt: fmtBeijingDate(group[0]),
      hourList
    }
  })
})

// 矩阵主体：行=各起报时次（顶部为未来 4 个起报时次，其后为当前起报时次及向前追溯的历史时次），
// 列分组固定沿用“当前起报时次”的有效时刻分组；未来时次超出当前最大有效时刻的部分因无对应列而不显示。
const timeTable = computed(() => {
  const baseMs = parseInitTimeMs(initTime.value)
  if (baseMs == null) return []

  const rawRows = []
  // 未来起报时次（+48h → +12h，最新在最上）。
  FUTURE_INIT_OFFSETS.forEach((offset) => {
    const rowInitMs = baseMs + offset * 60 * 60 * 1000
    rawRows.push({
      initMs: rowInitMs,
      isFuture: true,
      times: fcHoursNumeric.map((fc) => rowInitMs + fc * 60 * 60 * 1000)
    })
  })
  // 当前起报时次及向前追溯的历史时次。
  for (let i = 0; i < INIT_TIME_ROW_COUNT; i += 1) {
    const rowInitMs = baseMs - i * 12 * 60 * 60 * 1000
    rawRows.push({
      initMs: rowInitMs,
      isFuture: false,
      times: fcHoursNumeric.map((fc) => rowInitMs + fc * 60 * 60 * 1000)
    })
  }

  // 列分组始终以当前起报时次为基准，保证未来/历史行的显示范围都对齐当前起报时次。
  const baseTimes = fcHoursNumeric.map((fc) => baseMs + fc * 60 * 60 * 1000)
  const firstColumns = splitByDate(baseTimes)

  return rawRows.map((row, rowIndex) => {
    const timeSet = new Map(row.times.map((ms, index) => [ms, index]))
    let columnIndex = 0
    const columns = firstColumns.map((group) => (
      group.map((cellMs) => {
        const hitIndex = timeSet.has(cellMs) ? timeSet.get(cellMs) : -1
        const info = { columnIndex, rowIndex }
        if (hitIndex !== -1) {
          info.isAvailable = true
          info.fc = fcHoursNumeric[hitIndex]
          info.initMs = row.initMs
          info.validMs = cellMs
        } else {
          info.isAvailable = false
        }
        columnIndex += 1
        return info
      })
    ))
    return {
      initMs: row.initMs,
      isFuture: row.isFuture,
      isBase: row.initMs === baseMs,
      rowLabel: fmtBeijingRow(row.initMs),
      columns
    }
  })
})

// 当前选中的起报时次 / 预报时效（用于高亮已选单元格）。
const activeSelection = computed(() => ({
  initMs: parseInitTimeMs(initTime.value),
  fc: Number(fcHour.value)
}))

function isActiveCell(cell) {
  return cell.isAvailable
    && cell.initMs === activeSelection.value.initMs
    && cell.fc === activeSelection.value.fc
}

function selectCell(cell) {
  if (!cell.isAvailable) return
  applyInitAndFcHour(formatInitTime(cell.initMs), String(cell.fc).padStart(3, '0'))
}

function highlightCell(cell) {
  if (!cell.isAvailable) return
  tableHighlight.rowIndex = cell.rowIndex
  tableHighlight.columnIndex = cell.columnIndex
}

function cancelHighlight() {
  tableHighlight.rowIndex = NaN
  tableHighlight.columnIndex = NaN
}
</script>

<template>
  <n-popover trigger="hover" placement="right-start" style="max-width: 94vw;">
    <template #trigger>
      <button type="button" class="mts-fab" aria-label="多时次选择器">
        <CalendarClock :size="20" />
      </button>
    </template>

    <div class="mts-popover">
      <div class="mts-header">
        <strong>多时次选择器</strong>
        <span>行=起报时次（北京时，含未来 4 档），列=预报有效时刻，绿格可选</span>
      </div>
      <div class="mts-table-box">
        <table class="mts-table">
          <thead>
            <tr>
              <th class="mts-corner">日期(北京时)</th>
              <th
                v-for="(col, colIndex) in timeTableHeader"
                :key="`d-${colIndex}`"
                class="mts-header-date"
                :class="{ 'mts-single-cell': col.hourList.length === 1 }"
              >
                {{ col.localDateFmt }}
              </th>
            </tr>
            <tr>
              <td class="mts-slide">起报<br />↓</td>
              <td
                v-for="(col, colIndex) in timeTableHeader"
                :key="`h-${colIndex}`"
                class="mts-cell-box"
              >
                <div class="mts-hour-row">
                  <div
                    v-for="(cellHour, hourIndex) in col.hourList"
                    :key="hourIndex"
                    class="mts-hour"
                    :class="{ 'mts-highlight': cellHour.columnIndex === tableHighlight.columnIndex }"
                  >
                    {{ cellHour.hourFmt }}
                  </div>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in timeTable" :key="`r-${rowIndex}`">
              <th
                class="mts-row-head"
                :class="{
                  'mts-highlight': rowIndex === tableHighlight.rowIndex,
                  'mts-row-future': row.isFuture,
                  'mts-row-base': row.isBase
                }"
                :title="row.isFuture ? '未来起报时次' : (row.isBase ? '当前起报时次' : '历史起报时次')"
              >
                {{ row.rowLabel }}
              </th>
              <td
                v-for="(col, colIndex) in row.columns"
                :key="`c-${rowIndex}-${colIndex}`"
                class="mts-cell-box"
              >
                <div class="mts-cell-row">
                  <div
                    v-for="(cell, cellIndex) in col"
                    :key="cellIndex"
                    class="mts-cell"
                    :class="{
                      'mts-available': cell.isAvailable,
                      'mts-active': isActiveCell(cell)
                    }"
                    :title="cell.isAvailable ? `${row.rowLabel} 起报 +${cell.fc}h` : ''"
                    @click="selectCell(cell)"
                    @mouseover="highlightCell(cell)"
                    @mouseout="cancelHighlight"
                  ></div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </n-popover>
</template>

<style scoped>
.mts-fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(21, 31, 46, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 24px rgba(22, 33, 47, 0.12);
  backdrop-filter: blur(8px);
  color: #1f7a8c;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.mts-fab:hover {
  color: #fff;
  background: #1f7a8c;
  border-color: #1f7a8c;
}

.mts-popover {
  display: grid;
  gap: 10px;
}

.mts-header {
  display: grid;
  gap: 3px;
}

.mts-header strong {
  color: #172033;
  font-size: 14px;
}

.mts-header span {
  color: #667487;
  font-size: 12px;
}

.mts-table-box {
  max-width: 90vw;
  overflow: auto;
}

.mts-table,
.mts-table tr,
.mts-table th,
.mts-table td {
  border: 1px solid #cbd5e1;
  border-collapse: collapse;
  text-align: center;
  white-space: nowrap;
}

.mts-table {
  border-collapse: collapse;
  font-size: 12px;
  color: #384456;
}

.mts-corner,
.mts-row-head {
  padding: 0 8px;
  background: #f1f5f9;
  font-weight: 600;
}

/* 未来起报时次行：暖色底以区别于历史行。 */
.mts-row-future {
  background: #fff7ed;
  color: #9a3412;
}

/* 当前（基准）起报时次行：加左侧色条并高亮，强调“以当前起报时次为基准”。 */
.mts-row-base {
  background: #ecfeff;
  color: #0e7490;
  box-shadow: inset 3px 0 0 #0891b2;
}

.mts-header-date {
  padding: 2px 4px;
  background: #f8fafc;
  color: #526173;
  font-weight: 600;
}

.mts-header-date.mts-single-cell {
  max-width: 23px;
  overflow: hidden;
  text-overflow: clip;
}

.mts-slide {
  padding: 0 6px;
  color: #526173;
  font-size: 11px;
  line-height: 1.1;
  background: #f8fafc;
}

.mts-cell-box {
  padding: 0;
}

.mts-hour-row,
.mts-cell-row {
  display: inline-flex;
}

.mts-hour,
.mts-cell {
  display: inline-block;
  width: 21px;
  height: 21px;
  line-height: 21px;
  vertical-align: middle;
}

.mts-hour {
  color: #64748b;
  font-size: 11px;
}

.mts-cell {
  background: #f0f2f5;
}

.mts-cell.mts-available {
  background: #16a34a;
  cursor: pointer;
}

.mts-cell.mts-available:hover {
  background: #4ade80;
}

.mts-cell.mts-available:active {
  background: #2563eb;
}

.mts-cell.mts-active {
  background: #2563eb;
  box-shadow: inset 0 0 0 2px #1e3a8a;
}

.mts-highlight {
  background: #dbeafe !important;
  color: #1e3a8a;
}
</style>
