<template>
  <div class="panel">
    <h4>🔥 日志级别热力图</h4>
    <div ref="chart" class="chart"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { useLogStore } from '../store/log'
import type { TimeWindow } from '../types'

const store = useLogStore()
const chart = ref<HTMLDivElement>()
let inst: echarts.ECharts | null = null
const LEVEL_ORDER = ['INFO', 'WARN', 'ERROR', 'DEBUG', 'UNKNOWN']
const EMPTY_VALUE = -1
const STORAGE_KEY = 'log-heatmap-legend-state'
const LEVEL_LABELS: Record<string, string> = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
  UNKNOWN: '空级别'
}

type HeatmapDatum = [number, number, number]
type LegendSelection = Record<string, boolean>

interface StoredLegendState {
  signature: string
  pieces: number
  selected: LegendSelection
}

function getWindowLevelCount(window: TimeWindow, level: string): number | null {
  return Object.prototype.hasOwnProperty.call(window.levels, level)
    ? Number(window.levels[level]) || 0
    : null
}

function getHeatmapLevels(windows: TimeWindow[]): string[] {
  const present = new Set<string>()
  windows.forEach((window) => {
    Object.keys(window.levels).forEach((level) => present.add(level))
  })

  return LEVEL_ORDER.filter((level) => present.has(level))
}

function quantile(sortedValues: number[], ratio: number): number {
  if (!sortedValues.length) return 0
  const index = Math.min(sortedValues.length - 1, Math.round((sortedValues.length - 1) * ratio))
  return sortedValues[index]
}

function buildPieces(values: number[]) {
  const positiveValues = values.filter((value) => value > 0).sort((a, b) => a - b)
  const colors = ['#1e3a5f', '#fef08a', '#fb923c', '#ef4444', '#7f1d1d']

  if (!positiveValues.length) {
    return {
      pieces: [{ gte: 0, lte: 0, color: colors[0], label: '0 条' }],
      colors: [colors[0]]
    }
  }

  const maximum = positiveValues[positiveValues.length - 1]
  const quantileValues = [0.25, 0.5, 0.75, 1].map((ratio) =>
    Math.min(maximum, Math.ceil(quantile(positiveValues, ratio)))
  )
  const bounds = [...new Set([0, ...quantileValues])].sort((a, b) => a - b)
  const pieces = []
  const intervalCount = Math.max(1, bounds.length - 1)

  for (let i = 0; i < bounds.length - 1; i += 1) {
    const lower = bounds[i]
    const upper = bounds[i + 1]
    if (lower >= upper) continue

    pieces.push({
      gte: lower === 0 ? 0 : lower + 1,
      lte: upper,
      color: colors[Math.round((pieces.length / Math.max(1, intervalCount - 1)) * (colors.length - 1))],
      label: lower === 0 ? `0-${upper} 条` : `${lower + 1}-${upper} 条`
    })
  }

  return { pieces, colors }
}

function getSignature(windows: TimeWindow[], levels: string[]): string {
  const values = windows.flatMap((window) =>
    levels.map((level) => getWindowLevelCount(window, level) ?? EMPTY_VALUE)
  )
  const total = windows.reduce((sum, window) => sum + window.count, 0)
  return `${windows.length}:${levels.join('.')}:${total}:${values.join('.')}`
}

function readLegendState(signature: string, pieceCount: number): LegendSelection {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as StoredLegendState | null
    if (saved?.signature === signature && saved.pieces === pieceCount) {
      return saved.selected
    }
  } catch {
    // Ignore stale or malformed legend state.
  }
  return {}
}

function saveLegendState(signature: string, pieceCount: number, selected: LegendSelection) {
  try {
    const state: StoredLegendState = { signature, pieces: pieceCount, selected }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Legend persistence is optional.
  }
}

function update() {
  if (!inst || !store.result) return

  const windows = store.result.windows
  const levels = getHeatmapLevels(windows)
  const data: HeatmapDatum[] = []

  windows.forEach((window, windowIndex) => {
    levels.forEach((level, levelIndex) => {
      const value = getWindowLevelCount(window, level)
      data.push([windowIndex, levelIndex, value ?? EMPTY_VALUE])
    })
  })

  const values = data.map((item) => item[2]).filter((value) => value !== EMPTY_VALUE)
  const { pieces } = buildPieces(values)
  const signature = getSignature(windows, levels)
  const pieceCount = pieces.length + 1
  const selected = readLegendState(signature, pieceCount)

  inst.setOption({
    backgroundColor: 'transparent',
    grid: { left: 60, right: 100, top: 8, bottom: 25 },
    xAxis: {
      type: 'category',
      data: windows.map((_, index) => `W${index}`),
      axisLabel: { color: '#94a3b8', fontSize: 8 },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { show: false },
      splitArea: { show: false }
    },
    yAxis: {
      type: 'category',
      data: levels.map((level) => LEVEL_LABELS[level] || level),
      axisLabel: { color: '#94a3b8', fontSize: 9 },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { show: false }
    },
    tooltip: {
      formatter(params: { data: HeatmapDatum; dataIndex: number }) {
        const [windowIndex, levelIndex, value] = params.data
        const level = levels[levelIndex]
        const countText = value === EMPTY_VALUE ? '空值' : `${value} 条`
        return `W${windowIndex} · ${LEVEL_LABELS[level] || level}<br/>${countText}`
      }
    },
    visualMap: {
      type: 'piecewise',
      min: 0,
      max: Math.max(...values, 1),
      show: true,
      inverse: false,
      orient: 'vertical',
      right: 0,
      top: 18,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 4,
      textStyle: { color: '#94a3b8', fontSize: 8 },
      backgroundColor: 'rgba(15,23,42,0.72)',
      borderColor: '#334155',
      borderWidth: 1,
      padding: [5, 7],
      selectedMode: 'multiple',
      selected,
      pieces: [
        ...pieces,
        { value: EMPTY_VALUE, label: '空值', color: 'rgba(100,116,139,0.22)' }
      ]
    },
    series: [{
      type: 'heatmap',
      data,
      label: {
        show: true,
        fontSize: 8,
        color: '#e2e8f0',
        formatter(params: { value: HeatmapDatum }) {
          return params.value[2] === EMPTY_VALUE ? '-' : String(params.value[2])
        }
      },
      itemStyle: {
        borderColor: '#1e293b',
        borderWidth: 1
      },
      emphasis: { itemStyle: { borderColor: '#38bdf8', borderWidth: 1 } }
    }],
    animation: false
  }, true)

  inst.off('dataRangeSelected')
  inst.on('dataRangeSelected', () => {
    const option = inst?.getOption() as { visualMap?: Array<{ selected?: LegendSelection }> }
    const currentSelected = option.visualMap?.[0]?.selected
    if (currentSelected) saveLegendState(signature, pieceCount, currentSelected)
  })
}

onMounted(() => {
  if (chart.value) {
    inst = echarts.init(chart.value)
    update()
  }
})

watch(() => store.result, update)

onUnmounted(() => {
  inst?.dispose()
  inst = null
})
</script>

<style scoped>
.panel {
  background: #1e293b;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #334155;
}
.panel h4 {
  color: #38bdf8;
  font-size: 13px;
  margin-bottom: 4px;
}
.chart {
  width: 100%;
  height: 200px;
}
</style>
