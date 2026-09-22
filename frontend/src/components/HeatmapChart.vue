<template>
  <div class="panel"><h4>🔥 日志级别热力图</h4><div ref="chart" class="chart"></div></div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { useLogStore } from '../store/log'
const store = useLogStore(); const chart = ref<HTMLDivElement>(); let inst: echarts.ECharts|null=null

// 图例（visualMap）选中区间持久化，重新进入页面时恢复，不回退到默认全量程
const RANGE_KEY = 'heatmap:visualRange'
function loadRange(): [number, number] | null {
  try {
    const raw = localStorage.getItem(RANGE_KEY)
    if (!raw) return null
    const a = JSON.parse(raw)
    if (Array.isArray(a) && a.length === 2 && a.every(Number.isFinite)) return [a[0], a[1]]
  } catch { /* ignore */ }
  return null
}
function saveRange(r: [number, number]) {
  try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)) } catch { /* ignore */ }
}
function clampRange(r: [number, number], max: number): [number, number] {
  let [a, b] = r
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(a <= b)) return [0, max]
  a = Math.min(Math.max(a, 0), max)
  b = Math.min(Math.max(b, 0), max)
  return a > b ? [0, max] : [a, b]
}
let savedRange = loadRange()

interface Cell { x: number; y: number; value: number | null }

const normLevel = (k: string) => String(k ?? '').toUpperCase()
const CANON_RANK: Record<string, number> = { ERROR: 0, WARN: 1, WARNING: 1, NOTICE: 2, INFO: 3, DEBUG: 4 }
const CANON_LABEL: Record<string, string> = { ERROR: 'ERROR', WARN: 'WARN', WARNING: 'WARN', NOTICE: 'NOTICE', INFO: 'INFO', DEBUG: 'DEBUG' }

// 所有坐标轴、格子数值、颜色量程、图例均共用同一份窗口聚合派生结果，避免数值与图例错位
function buildCells(): { levels: string[]; cells: Cell[]; values: number[] } {
  const ws = store.result?.windows || []
  // 行（级别）直接取自接口窗口聚合中真实出现过的键，并做大小写/同义词归一
  const firstLabel = new Map<string, string>()
  ws.forEach(w => Object.keys(w.levels || {}).forEach(k => {
    const nk = normLevel(k)
    if (!firstLabel.has(nk)) firstLabel.set(nk, CANON_LABEL[nk] || String(k).toUpperCase())
  }))
  const keys = [...firstLabel.keys()].sort((a, b) => {
    const ra = CANON_RANK[a], rb = CANON_RANK[b]
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.localeCompare(b)
  })
  const levels = keys.map(k => firstLabel.get(k)!)
  const cells: Cell[] = []
  const values: number[] = []
  ws.forEach((w, i) => keys.forEach((nk, j) => {
    // 按归一化后的级别名在当前窗口聚合里取值，缺失即为空（不得用 0 顶替）
    let v: number | null = 0
    let hit = false
    Object.keys(w.levels || {}).forEach(k => {
      if (normLevel(k) === nk) { v = (v || 0) + Number(w.levels![k] || 0); hit = true }
    })
    if (!hit) v = null
    cells.push({ x: i, y: j, value: v })
    if (v !== null && v > 0) values.push(v)
  }))
  return { levels, cells, values }
}

// 软量程：用高分位数封顶，避免单个极值把其余格子全压到最暗色；超出部分仍染成最高色
function softMaxOf(values: number[]): number {
  if (!values.length) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return Math.max(1, Math.ceil(sorted[Math.max(0, idx)]))
}

const COLOR_MIN = '#164e63' // 与面板底色区分，低值格不再“隐形”
const COLOR_MID = '#fef08a'
const COLOR_MAX = '#ef4444'
const EMPTY_BORDER = '#475569'

function update(resetRange: boolean) {
  if (!inst || !store.result) return
  const ws = store.result.windows
  const { levels, cells, values } = buildCells()
  const softMax = softMaxOf(values)
  // 数据切换（重新生成/换来源/检测后窗口变化）时图例量程重置；首次进入则恢复持久化区间
  const range: [number, number] = resetRange ? [0, softMax]
    : savedRange ? clampRange(savedRange, softMax) : [0, softMax]
  savedRange = range
  saveRange(range)

  const valuedData = cells.filter(c => c.value !== null).map(c => [c.x, c.y, c.value])
  // 空级别格子也挂在 visualMap 上（heatmap 必须有 visualMap），通过数据项样式覆盖成透明虚线占位
  const emptyData = cells.filter(c => c.value === null).map(c => ({
    value: [c.x, c.y, 0],
    itemStyle: { color: 'transparent', borderColor: EMPTY_BORDER, borderType: 'dashed', borderWidth: 1 }
  }))

  inst.setOption({
    backgroundColor: 'transparent',
    grid: { left: 60, right: 15, top: 8, bottom: 38 },
    xAxis: { type: 'category', data: ws.map((_, i) => 'W' + i), axisLabel: { color: '#94a3b8', fontSize: 8 } },
    yAxis: { type: 'category', data: levels, inverse: true, axisLabel: { color: '#94a3b8', fontSize: 9 } },
    tooltip: {
      formatter: (p: { seriesIndex?: number; value?: number[] }) => {
        if (p.seriesIndex !== 0 || !p.value) return ''
        return `窗口 W${p.value[0]} · ${levels[p.value[1]]}<br/>${p.value[2]} 条`
      }
    },
    // 图例与格子共用同一批 values 推导的量程，数值不会错位
    visualMap: {
      type: 'continuous', min: 0, max: softMax, range,
      calculable: true, show: true,
      orient: 'horizontal', left: 'center', bottom: 2, itemWidth: 130, itemHeight: 10,
      textStyle: { color: '#94a3b8', fontSize: 9 },
      inRange: { color: [COLOR_MIN, COLOR_MID, COLOR_MAX] },
      outOfRange: { color: COLOR_MAX }
    },
    series: [
      {
        type: 'heatmap', data: valuedData,
        itemStyle: { borderColor: '#1e293b', borderWidth: 1 },
        label: { show: true, fontSize: 8, color: '#e2e8f0' }
      },
      {
        // 空级别占位：透明底 + 虚线框 + “—”，明确表示该窗口聚合中没有此级别
        type: 'heatmap', data: emptyData, silent: true,
        itemStyle: { color: 'transparent', borderColor: EMPTY_BORDER, borderType: 'dashed', borderWidth: 1 },
        label: { show: true, formatter: '—', fontSize: 8, color: '#64748b' }
      }
    ],
    animation: false
  }, true) // notMerge：切换窗口区间后不残留上一段的坐标轴/图例范围与样式
}

onMounted(() => {
  if (chart.value) {
    inst = echarts.init(chart.value)
    inst.on('datarangeselected', (p: unknown) => {
      const sel = (p as { selected?: number[] }).selected
      if (Array.isArray(sel) && sel.length === 2 && sel.every(Number.isFinite)) {
        savedRange = [sel[0], sel[1]]
        saveRange(savedRange)
      }
    })
    update(false)
  }
})
watch(() => store.result, () => update(true))
onUnmounted(() => inst?.dispose())
</script>
<style scoped>.panel{background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155}.panel h4{color:#38bdf8;font-size:13px;margin-bottom:4px}.chart{width:100%;height:200px}</style>