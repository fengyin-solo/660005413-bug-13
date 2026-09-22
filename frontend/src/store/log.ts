import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import axios from 'axios'
import type { AnalysisResult, AlertRule } from '@/types'

const RESULT_STORAGE_KEY = 'log-analysis-result'

function loadResult(): AnalysisResult | null {
  try {
    const saved = localStorage.getItem(RESULT_STORAGE_KEY)
    return saved ? JSON.parse(saved) as AnalysisResult : null
  } catch {
    return null
  }
}

export const useLogStore = defineStore('log', () => {
  const result = ref<AnalysisResult | null>(loadResult())
  const loading = ref(false)
  const searchQuery = ref('')
  const logType = ref('nginx')
  const rules = ref<AlertRule[]>([
    { id:1, name:'高频ERROR', type:'level', threshold:5, enabled:true },
    { id:2, name:'异常流量', type:'count', threshold:200, enabled:false },
    { id:3, name:'关键词命中', type:'keyword', threshold:0, enabled:true }
  ])

  watch(result, (value) => {
    try {
      if (value) localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(value))
      else localStorage.removeItem(RESULT_STORAGE_KEY)
    } catch {
      // Legend/result persistence is optional when browser storage is unavailable.
    }
  })

  async function generate() {
    loading.value=true
    try {
      const { data } = await axios.post('/api/generate', { type: logType.value, count: 1000 })
      result.value = data
    } finally { loading.value=false }
  }

  async function detect() {
    if (!result.value) return
    loading.value=true
    try {
      const { data } = await axios.post('/api/detect', {
        logs: result.value.logs,
        rules: rules.value.filter(r => r.enabled),
        query: searchQuery.value
      })
      result.value = data
    } finally { loading.value=false }
  }

  return { result, loading, searchQuery, logType, rules, generate, detect }
})
