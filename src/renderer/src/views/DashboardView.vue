<script setup>
import { ref, computed, onMounted, onActivated, watch, nextTick, onUnmounted } from 'vue'
import LogTradeForm from '../components/LogTradeForm.vue'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
} from 'chart.js'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
)

// ── Constants ─────────────────────────────────────────────────────────────────
const ALL_SESSIONS = ['New York', 'London', 'London Close', 'Asia', 'Tokyo']
const rrTypeOptions = ref([]) // replaces hardcoded ALL_RR_TYPES
const POSITIONS = ['Buy', 'Sell']
const DIRECTION_BIAS = ['Bullish', 'Bearish']
const TF_OPTIONS = ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4']
const RESULTS = ['Win', 'Loss', 'Breakeven']

// ── Add Trade Modal ───────────────────────────────────────────────────────────
const showAddModal = ref(false)
function onTradeSubmitted() {
  runQuery()
}

// ── State ─────────────────────────────────────────────────────────────────────
const setups = ref([])
const symbolOptions = ref([])

// All filter fields per slot — only dateFrom/dateTo are shared
function makeSlot() {
  return {
    setupId: '',
    sessions: [],
    rrTypeIds: [],
    symbols: [],
    strategyIds: [],
    customTagIds: [],
    hasNews: null,
    isTest: null,
    isExcluded: null,
    colorRatings: [],
    // loaded dynamically when setupId chosen
    strategies: [],
    customTags: [],
    // UI state: open dropdown panel
    openDropdown: null  // 'session'|'rrType'|'symbol'|null
  }
}

const filters = ref({
  setupSlots: [makeSlot()],
  dateFrom: '',
  dateTo: ''
})
const results = ref([])
const summary = ref(null)
const isLoading = ref(false)
const loadError = ref('')
const nativeDateFromRef = ref(null)
const nativeDateToRef = ref(null)

const COLOR_OPTIONS = ['red', 'orange', 'yellow', 'green']

// ── Edit Modal ────────────────────────────────────────────────────────────────
const showEditModal = ref(false)
const editLoading = ref(false)
const editError = ref('')
const editRow = ref(null)
const editForm = ref({})
const editStrategies = ref([])
const editAllCustomTags = ref([])
const editSelectedStrategyIds = ref([])
const editSelectedCustomTagIds = ref([])
const editImageUrlInputs = ref([''])
const nativeEditEntryRef = ref(null)
const nativeEditExitRef = ref(null)

// ── Image Gallery ─────────────────────────────────────────────────────────────
const showGallery = ref(false)
const galleryImages = ref([])
const galleryIndex = ref(0)

// ── Table Sort ────────────────────────────────────────────────────────────────
const sortCol = ref('entryDateTime')
const sortDir = ref('asc') // 'asc' | 'desc'

const SORT_OPTIONS = [
  { value: 'entryDateTime', label: 'Entry Date' },
  { value: 'exitDateTime',  label: 'Exit Date' },
  { value: 'symbol',        label: 'Symbol' },
  { value: 'result',        label: 'Result' },
  { value: 'session',       label: 'Session' },
  { value: 'position',      label: 'Position' },
  { value: 'rrr',           label: 'RRR' },
  { value: 'dollarPnl',     label: '$PnL' },
  { value: 'drawdown',      label: 'Drawdown' },
  { value: 'isTest',        label: 'Test Item' },
]

// ── Pagination ────────────────────────────────────────────────────────────────
const currentPage = ref(1)
const pageSize = ref(50)


// ── Account Settings ──────────────────────────────────────────────────────────
const initialBalance = ref(500)
const riskPercent = ref(6) // percent, e.g. 6 means 6%
const settingsLoaded = ref(false)
const customColumnName = ref('Custom Tag')
const dbPath = ref('')

// ── Manual row exclusion (UI-only, reset on each query) ──────────────────────
const manualExcludeIds = ref(new Set())
function toggleManualExclude(id) {
  const s = new Set(manualExcludeIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  manualExcludeIds.value = s
}

const showCharts = ref(false) // toggle visibility
const returnType = ref('simple') // 'simple' or 'log'
const pnlGroupBy = ref('day') // day, symbol, session, rrType, rating, news
const equityChartCanvas = ref(null)
const drawdownChartCanvas = ref(null)
const pnlChartCanvas = ref(null)
const winrateChartCanvas = ref(null)
let equityChart = null
let drawdownChart = null
let pnlChart = null
let winrateChart = null

onUnmounted(() => {
  if (equityChart) equityChart.destroy()
  if (drawdownChart) drawdownChart.destroy()
  if (pnlChart) pnlChart.destroy()
  if (winrateChart) winrateChart.destroy()
  document.removeEventListener('click', closeAllSlotDropdowns)
})

function closeAllSlotDropdowns() {
  filters.value.setupSlots.forEach((sl) => { sl.openDropdown = null })
}


async function loadSettings() {
  try {
    const s = await window.api.getAllSettings()
    if (s.initialBalance) initialBalance.value = parseFloat(s.initialBalance)
    if (s.riskPercent) riskPercent.value = parseFloat(s.riskPercent)
    if (s.customColumnName) customColumnName.value = s.customColumnName
  } catch (_) {}
  try {
    dbPath.value = await window.api.getDbPath()
  } catch (e) {
    console.warn('getDbPath failed', e)
  }
  settingsLoaded.value = true
}

async function changeDbFolder() {
  const result = await window.api.chooseDbFolder()
  if (result.ok) dbPath.value = 'Restarting…'
}

async function exportDb() {
  const result = await window.api.exportDb()
  if (result.ok) alert(`Exported to:\n${result.path}`)
}

async function importDb() {
  if (!confirm('Import will replace ALL current data and restart the app. Continue?')) return
  await window.api.importDb()
}

async function saveSettings() {
  await Promise.all([
    window.api.setSetting('initialBalance', initialBalance.value),
    window.api.setSetting('riskPercent', riskPercent.value)
  ])
}

watch([initialBalance, riskPercent], saveSettings)

// ── RR Helpers ────────────────────────────────────────────────────────────────
function parseRRLegacy(rrTypeStr) {
  // Supports "1:2" or "Fixed 2R" or just "2"
  const m = rrTypeStr?.match(/(?:1:)?(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

// Returns { risk, reward, rrr } based on ratio or legacy string
function calcRRR(result, rrTypeRatio, legacyRrTypeStr) {
  const rr = rrTypeRatio != null ? parseFloat(rrTypeRatio) : parseRRLegacy(legacyRrTypeStr)
  if (result === 'Win') return { risk: 0, reward: rr, rrr: rr }
  if (result === 'Loss') return { risk: -1, reward: 0, rrr: -1 }
  return { risk: 0, reward: 0, rrr: 0 } // Breakeven
}

// ── Sort raw results before enriching (so `no` follows sorted order) ──────────
const sortedResults = computed(() => {
  if (!sortCol.value) return results.value
  const col = sortCol.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...results.value].sort((a, b) => {
    let va = a[col]
    let vb = b[col]
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
})

// ── Computed table rows with running balance/drawdown ─────────────────────────
const sortedRows = computed(() => {
  const bal0 = initialBalance.value
  const baseRiskPct = riskPercent.value / 100
  let runningBalance = bal0
  let peakBalance = bal0
  let cumLogReturn = 0
  let currentConsecutiveLosses = 0

  return sortedResults.value.map((row, i) => {
    // Manually excluded rows don't affect running balance/stats
    if (manualExcludeIds.value.has(row.id)) {
      return {
        ...row,
        risk: 0, reward: 0, rrr: 0, dollarPnl: 0, pctPnl: 0,
        balance: runningBalance,
        drawdown: +((runningBalance / peakBalance - 1) * 100).toFixed(2),
        holding: '—',
        no: i + 1,
        _manualExcluded: true
      }
    }

    const { risk, reward, rrr } = calcRRR(row.result, row.rrTypeRatio, row.rrType)
    let appliedRiskPct = baseRiskPct
    if (currentConsecutiveLosses >= 3) {
      appliedRiskPct = 0.5 / 100 // Temporary 0.5% risk
    }
    const appliedRiskAmt = bal0 * appliedRiskPct

    // 1. Simple PnL (Fixed $ risk)
    const simpleDollarPnl = +(rrr * appliedRiskAmt).toFixed(2)

    // 2. Log PnL (Compounding)
    const tradePctReturn = rrr * appliedRiskPct
    const logTradeReturn = Math.log(1 + tradePctReturn)
    cumLogReturn += logTradeReturn

    // Determine values based on returnType
    let dollarPnl, currentBalance
    if (returnType.value === 'log') {
      currentBalance = +(bal0 * Math.exp(cumLogReturn)).toFixed(2)
      dollarPnl = +(currentBalance - runningBalance).toFixed(2)
    } else {
      dollarPnl = simpleDollarPnl
      currentBalance = +(runningBalance + dollarPnl).toFixed(2)
    }

    // Update consecutive losses state for the next trade
    if (row.result === 'Loss') {
      currentConsecutiveLosses++
    } else if (row.result === 'Win') {
      currentConsecutiveLosses = 0
    }

    runningBalance = currentBalance
    if (runningBalance > peakBalance) peakBalance = runningBalance
    const drawdown = +((runningBalance / peakBalance - 1) * 100).toFixed(2)
    const pctPnl = +((dollarPnl / bal0) * 100).toFixed(2)

    // Holding time
    let holding = '—'
    if (row.entryDateTime && row.exitDateTime) {
      const diff = new Date(row.exitDateTime) - new Date(row.entryDateTime)
      const hh = Math.floor(diff / 3600000)
      const mm = Math.floor((diff % 3600000) / 60000)
      holding = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    }

    return {
      ...row,
      risk,
      reward,
      rrr,
      dollarPnl,
      pctPnl,
      balance: runningBalance,
      drawdown,
      holding,
      no: i + 1
    }
  })
})

// ── Table Search ──────────────────────────────────────────────────────────────
const tableSearch = ref('')

const filteredRows = computed(() => {
  const q = tableSearch.value.trim().toLowerCase()
  if (!q) return sortedRows.value
  return sortedRows.value.filter((row) => {
    return [
      row.no,
      row.symbol,
      row.session,
      row.position,
      row.directionBias,
      row.tf,
      row.result,
      row.setupName,
      row.strategyNames,
      row.timeBos,
      row.customTagNames,
      row.notes,
      row.rrType,
      row.rrTypeName,
      row.dollarPnl,
      row.pctPnl,
      row.rrr,
      row.slPoint,
      row.tpPoint,
      row.balance,
      row.drawdown,
      row.holding,
      row.hasNews ? 'news' : '',
      row.colorRating,
      row.entryDateTime ? fmtDate(row.entryDateTime) : '',
      row.exitDateTime  ? fmtDate(row.exitDateTime)  : '',
      row.entryDateTime ? fmtTime(row.entryDateTime) : '',
      row.exitDateTime  ? fmtTime(row.exitDateTime)  : '',
    ].some((v) => v != null && String(v).toLowerCase().includes(q))
  })
})

const totalPages = computed(() => Math.ceil(filteredRows.value.length / pageSize.value) || 1)

const paginatedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

function goToPage(p) {
  currentPage.value = Math.max(1, Math.min(p, totalPages.value))
}

watch([filteredRows, pageSize], () => {
  currentPage.value = 1
})

// ── Enhanced Summary ──────────────────────────────────────────────────────────
const enhancedSummary = computed(() => {
  if (!summary.value) return null
  const rows = sortedRows.value.filter(r => !r._manualExcluded)
  const wins = rows.filter((r) => r.result === 'Win')
  const losses = rows.filter((r) => r.result === 'Loss')

  const totalDollarPnl = +rows.reduce((s, r) => s + r.dollarPnl, 0).toFixed(2)
  const grossProfit = +wins.reduce((s, r) => s + r.dollarPnl, 0).toFixed(2)
  const grossLoss = +losses.reduce((s, r) => s + Math.abs(r.dollarPnl), 0).toFixed(2)
  const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : '∞'
  const avgWin = wins.length ? +(grossProfit / wins.length).toFixed(2) : 0
  const avgLoss = losses.length ? +(grossLoss / losses.length).toFixed(2) : 0
  const avgRR = avgLoss !== 0 ? +(Math.abs(avgWin) / Math.abs(avgLoss)).toFixed(2) : (avgWin !== 0 ? '∞' : 0)

  // Consecutive wins/losses
  let maxConsecWin = 0,
    maxConsecLoss = 0,
    curW = 0,
    curL = 0
  for (const r of rows) {
    if (r.result === 'Win') {
      curW++
      curL = 0
      maxConsecWin = Math.max(maxConsecWin, curW)
    } else if (r.result === 'Loss') {
      curL++
      curW = 0
      maxConsecLoss = Math.max(maxConsecLoss, curL)
    } else {
      curW = 0
      curL = 0
    }
  }

  const finalBalance = rows.length ? rows[rows.length - 1].balance : initialBalance.value
  const minDrawdown = rows.length ? Math.min(...rows.map((r) => r.drawdown)) : 0

  const winCount = wins.length
  const lossCount = losses.length
  const total = rows.length
  const winRate = (winCount + lossCount) > 0
    ? +((winCount / (winCount + lossCount)) * 100).toFixed(2)
    : null

  return {
    ...summary.value,
    total,
    wins: winCount,
    losses: lossCount,
    winRate,
    totalDollarPnl,
    grossProfit,
    grossLoss,
    profitFactor,
    avgWin,
    avgLoss,
    avgRR,
    maxConsecWin,
    maxConsecLoss,
    finalBalance,
    minDrawdown
  }
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onActivated(runQuery)

// ── Per-slot helpers ──────────────────────────────────────────────────────────
async function onSlotSetupChange(slot) {
  slot.strategyIds = []
  slot.customTagIds = []
  slot.strategies = []
  slot.customTags = []
  if (slot.setupId) {
    const [strats, tags] = await Promise.all([
      window.api.getStrategiesForSetup(Number(slot.setupId)),
      window.api.getCustomTagsForSetup(Number(slot.setupId))
    ])
    slot.strategies = strats
    slot.customTags = tags.slice().sort((a, b) => {
      const na = parseFloat(a.name), nb = parseFloat(b.name)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.name.localeCompare(b.name)
    })
  }
}

function addSetupSlot() {
  filters.value.setupSlots.push(makeSlot())
}

function removeSetupSlot(idx) {
  filters.value.setupSlots.splice(idx, 1)
  if (filters.value.setupSlots.length === 0) filters.value.setupSlots.push(makeSlot())
}

function toggleSlotMulti(arr, val) {
  const idx = arr.indexOf(val)
  if (idx === -1) arr.push(val)
  else arr.splice(idx, 1)
}

function toggleSlotColor(slot, c) {
  toggleSlotMulti(slot.colorRatings, c)
}

function normalizeThaiDateInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function onFilterDateInput(field, e) {
  filters.value[field] = normalizeThaiDateInput(e.target.value)
}

function parseThaiDisplayDateToIso(displayDate) {
  if (!displayDate) return null
  const m = displayDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null

  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])

  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isoToThaiDisplayDate(isoDate) {
  if (!isoDate) return ''
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

function openNativePicker(refEl) {
  if (!refEl) return
  if (typeof refEl.showPicker === 'function') {
    refEl.showPicker()
    return
  }
  refEl.focus()
  refEl.click()
}

function pickFilterDate(field, refEl) {
  const currentIso = parseThaiDisplayDateToIso(filters.value[field])
  if (currentIso) refEl.value = currentIso
  openNativePicker(refEl)
}

function onNativeFilterDateChange(field, isoValue) {
  filters.value[field] = isoToThaiDisplayDate(isoValue)
}

// ── Query ─────────────────────────────────────────────────────────────────────
async function runQuery() {
  isLoading.value = true
  loadError.value = ''
  try {
    const isoFrom = parseThaiDisplayDateToIso(filters.value.dateFrom)
    const isoTo = parseThaiDisplayDateToIso(filters.value.dateTo)

    if (filters.value.dateFrom && !isoFrom) {
      throw new Error('Date From ต้องเป็นรูปแบบ dd/mm/yyyy (ค.ศ.)')
    }
    if (filters.value.dateTo && !isoTo) {
      throw new Error('Date To ต้องเป็นรูปแบบ dd/mm/yyyy (ค.ศ.)')
    }

    const normBool = (v) => v === null ? null : v === true || v === 'true'
    const f = {
      setupSlots: filters.value.setupSlots.map((sl) => ({
        setupId: sl.setupId ? Number(sl.setupId) : null,
        sessions: [...sl.sessions],
        rrTypeIds: sl.rrTypeIds.map(Number),
        symbols: [...sl.symbols],
        strategyIds: sl.strategyIds.map(Number),
        customTagIds: sl.customTagIds.map(Number),
        hasNews: sl.hasNews,
        isTest: normBool(sl.isTest),
        isExcluded: normBool(sl.isExcluded),
        colorRatings: [...sl.colorRatings]
      })),
      dateFrom: isoFrom ? `${isoFrom}T00:00` : null,
      dateTo: isoTo ? `${isoTo}T23:59` : null
    }
    const [rows, stat] = await Promise.all([
      window.api.queryJournals(f),
      window.api.getJournalSummary(f)
    ])
    results.value = rows
    summary.value = stat
    manualExcludeIds.value = new Set()

  } catch (e) {
    loadError.value = e.message ?? 'โหลดข้อมูลไม่สำเร็จ'
  } finally {
    isLoading.value = false
  }
}

watch(showCharts, (val) => {
  if (val && sortedRows.value.length) {
    nextTick(() => {
      updateCharts(sortedRows.value)
      updatePnlChart(sortedRows.value)
    })
  }
})

watch(pnlGroupBy, () => {
  if (showCharts.value && sortedRows.value.length) {
    updatePnlChart(sortedRows.value)
  }
})

watch(sortedRows, (newVal) => {
  if (showCharts.value && newVal?.length) {
    nextTick(() => {
      updateCharts(newVal)
      updatePnlChart(newVal)
    })
  }
})

function updateCharts(rows) {
  if (!equityChartCanvas.value || !drawdownChartCanvas.value) return

  const startBal = initialBalance.value || 0
  const labels = ['Start', ...rows.map((r) => r.no.toString())]
  const equityPoints = [startBal, ...rows.map((r) => r.balance)]
  const drawdownPoints = [0, ...rows.map((r) => r.drawdown)]

  // Trend line: start balance to final balance
  const trendLine = equityPoints.map((_, i) => {
    const start = equityPoints[0]
    const end = equityPoints[equityPoints.length - 1]
    return start + (i / (equityPoints.length - 1)) * (end - start)
  })

  // 1. Equity Curve
  if (equityChart) equityChart.destroy()
  const ctxE = equityChartCanvas.value.getContext('2d')
  const isDark = document.documentElement.dataset.theme !== 'light'
  
  const gradE = ctxE.createLinearGradient(0, 0, 0, 300)
  gradE.addColorStop(0, isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(37, 99, 235, 0.1)')
  gradE.addColorStop(1, 'rgba(59, 130, 246, 0)')

  equityChart = new Chart(ctxE, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Equity',
          data: equityPoints,
          borderColor: isDark ? '#3b82f6' : '#2563eb',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          backgroundColor: gradE,
          pointRadius: 0,
          pointHoverRadius: 4,
          z: 10
        },
        {
          label: 'Trend',
          data: trendLine,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
          borderWidth: 1.5,
          borderDash: [5, 5],
          tension: 0,
          fill: false,
          pointRadius: 0,
          z: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { 
          grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }, 
          ticks: { color: isDark ? '#636363' : '#9ca3af', font: { size: 10, weight: '600' } } 
        },
        y: { 
          grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }, 
          ticks: { color: isDark ? '#636363' : '#9ca3af', font: { size: 10, weight: '600' } } 
        }
      }
    }
  })

  // 2. Drawdown Chart
  if (drawdownChart) drawdownChart.destroy()
  const ctxD = drawdownChartCanvas.value.getContext('2d')
  const gradD = ctxD.createLinearGradient(0, 0, 0, 150)
  gradD.addColorStop(0, isDark ? 'rgba(248, 113, 113, 0.15)' : 'rgba(220, 38, 38, 0.1)')
  gradD.addColorStop(1, 'rgba(248, 113, 113, 0)')

  drawdownChart = new Chart(ctxD, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Drawdown (%)',
          data: drawdownPoints,
          borderColor: isDark ? '#f87171' : '#dc2626',
          borderWidth: 1.5,
          tension: 0.4,
          fill: true,
          backgroundColor: gradD,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' },
          ticks: {
            color: isDark ? '#636363' : '#9ca3af',
            font: { size: 10, weight: '600' },
            callback: (v) => v.toFixed(1) + '%'
          }
        }
      }
    }
  })
}

function updatePnlChart(rows) {
  if (!pnlChartCanvas.value) return

  const groups = {}
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

  rows.forEach((r) => {
    let key = ''
    if (pnlGroupBy.value === 'day') {
      key = dayNames[new Date(r.entryDateTime).getDay()]
    } else if (pnlGroupBy.value === 'symbol') {
      key = r.symbol || 'Unknown'
    } else if (pnlGroupBy.value === 'session') {
      key = r.session || 'N/A'
    } else if (pnlGroupBy.value === 'rrType') {
      key = r.rrTypeName || r.rrType || 'N/A'
    } else if (pnlGroupBy.value === 'rating') {
      key = r.colorRating ? r.colorRating.toUpperCase() : 'NONE'
    } else if (pnlGroupBy.value === 'news') {
      key = r.hasNews ? 'NEWS' : 'NO NEWS'
    }

    if (!groups[key]) groups[key] = { profit: 0, loss: 0 }
    if (r.dollarPnl > 0) groups[key].profit += r.dollarPnl
    else groups[key].loss += Math.abs(r.dollarPnl)
  })

  // Sort keys (especially for days)
  let sortedKeys = Object.keys(groups)
  if (pnlGroupBy.value === 'day') {
    sortedKeys = ['MON', 'TUE', 'WED', 'THU', 'FRI'].filter((d) => groups[d] || d)
  }

  const profits = sortedKeys.map((k) => groups[k]?.profit || 0)
  const losses = sortedKeys.map((k) => -(groups[k]?.loss || 0))

  if (pnlChart) pnlChart.destroy()
  const ctx = pnlChartCanvas.value.getContext('2d')

  pnlChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedKeys,
      datasets: [
        {
          label: 'Gross Profit',
          data: profits,
          backgroundColor: '#10b981',
          borderRadius: 6,
          borderSkipped: false
        },
        {
          label: 'Gross Loss',
          data: losses,
          backgroundColor: '#ef4444',
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: $${Math.abs(ctx.raw).toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: '#999', font: { weight: '600', size: 10 } }
        },
        y: {
          stacked: true,
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: {
            color: '#666',
            font: { size: 10 },
            callback: (v) => '$' + Math.abs(v).toLocaleString()
          }
        }
      }
    }
  })
}

function clearFilters() {
  filters.value = { setupSlots: [makeSlot()], dateFrom: '', dateTo: '' }
  runQuery()
}

onMounted(async () => {
  document.addEventListener('click', closeAllSlotDropdowns)
  await loadSettings()
  const [s, sym, rrList] = await Promise.all([
    window.api.getAllSetups(),
    window.api.getDistinctSymbols(),
    window.api.getAllRRTypes()
  ])
  setups.value = s
  symbolOptions.value = sym
  rrTypeOptions.value = rrList
  await runQuery()
})

function updateWinrateChart() {
  if (!winrateChartCanvas.value || !enhancedSummary.value) return
  const s = enhancedSummary.value
  const wins = s.wins ?? 0
  const losses = s.losses ?? 0
  const breakeven = (s.total ?? 0) - wins - losses
  const isLight = document.documentElement.dataset.theme === 'light'
  const bg = isLight
    ? ['#bbf7d0', '#fecaca', '#fef3c7']
    : ['#166534', '#7f1d1d', '#713f12']
  const border = isLight
    ? ['#16a34a', '#dc2626', '#ca8a04']
    : ['#4ade80', '#f87171', '#fbbf24']
  if (winrateChart) winrateChart.destroy()
  winrateChart = new Chart(winrateChartCanvas.value, {
    type: 'doughnut',
    data: {
      labels: ['Win', 'Loss', 'Breakeven'],
      datasets: [{
        data: [wins, losses, breakeven],
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
              const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0
              return ` ${ctx.label}: ${ctx.raw} (${pct}%)`
            }
          }
        }
      }
    }
  })
}

watch(enhancedSummary, () => {
  nextTick(() => updateWinrateChart())
}, { immediate: false })

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}


async function deleteRow(id) {
  if (!confirm('Delete this journal entry?')) return
  await window.api.deleteJournal(id)
  await runQuery()
}

const winRateDisplay = computed(() =>
  enhancedSummary.value?.winRate != null ? `${enhancedSummary.value.winRate}%` : '—'
)

// ── Win Rate pie drag ─────────────────────────────────────────────────────────
const piePos = ref({ top: 24, right: 24, left: null })
let _drag = null

function onPieMousedown(e) {
  if (e.button !== 0) return
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  _drag = { startX: e.clientX, startY: e.clientY, origTop: rect.top, origLeft: rect.left }
  e.preventDefault()
  window.addEventListener('mousemove', onPieMousemove)
  window.addEventListener('mouseup', onPieMouseup)
}

function onPieMousemove(e) {
  if (!_drag) return
  const dx = e.clientX - _drag.startX
  const dy = e.clientY - _drag.startY
  piePos.value = { top: _drag.origTop + dy, left: _drag.origLeft + dx, right: null }
}

function onPieMouseup() {
  _drag = null
  window.removeEventListener('mousemove', onPieMousemove)
  window.removeEventListener('mouseup', onPieMouseup)
}

// ── Sorted edit lists ─────────────────────────────────────────────────────────
const sortedEditStrategies = computed(() =>
  [...editStrategies.value].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
)
const sortedEditCustomTags = computed(() =>
  [...editAllCustomTags.value].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
)

// ── Edit Modal ────────────────────────────────────────────────────────────────
const editRRTypes = ref([])
async function openEdit(row) {
  editError.value = ''
  editRow.value = row
  const entryIso = row.entryDateTime ? row.entryDateTime.slice(0, 10) : ''
  const exitIso = row.exitDateTime ? row.exitDateTime.slice(0, 10) : ''
  editForm.value = {
    entryDate: isoToThaiDisplayDate(entryIso),
    entryTime: row.entryDateTime ? row.entryDateTime.slice(11, 16) : '',
    exitDate: isoToThaiDisplayDate(exitIso),
    exitTime: row.exitDateTime ? row.exitDateTime.slice(11, 16) : '',
    symbol: row.symbol ?? '',
    session: row.session ?? '',
    position: row.position ?? 'Buy',
    directionBias: row.directionBias ?? 'Bullish',
    setupId: String(row.setupId ?? ''),
    tf: row.tf ?? 'M1',
    rrTypeId: row.rrTypeId != null ? String(row.rrTypeId) : '',
    rrType: row.rrType ?? 'RR 1:2',
    slPoint: row.slPoint != null ? String(row.slPoint) : '',
    tpPoint: row.tpPoint != null ? String(row.tpPoint) : '',
    result: row.result ?? 'Win',
    notes: row.notes ?? '',
    colorRating: row.colorRating ?? '',
    hasNews: !!row.hasNews,
    isTest: !!row.isTest,
    isExcluded: !!row.isExcluded
  }
  editImageUrlInputs.value = row.imageUrls?.length ? [...row.imageUrls] : ['']
  editSelectedStrategyIds.value = []
  editSelectedCustomTagIds.value = []
  editStrategies.value = []
  editAllCustomTags.value = []
  editRRTypes.value = []

  const [strats, tags, rrTypes] = await Promise.all([
    row.setupId ? window.api.getStrategiesForSetup(Number(row.setupId)) : Promise.resolve([]),
    row.setupId ? window.api.getCustomTagsForSetup(Number(row.setupId)) : Promise.resolve([]),
    row.setupId ? window.api.getRRTypesForSetup(Number(row.setupId)) : Promise.resolve([])
  ])
  editStrategies.value = strats
  editAllCustomTags.value = tags
  editRRTypes.value = rrTypes

  if (strats.length && row.strategyNames) {
    const names = row.strategyNames.split(',').map((n) => n.trim())
    editSelectedStrategyIds.value = strats.filter((s) => names.includes(s.name)).map((s) => s.id)
  }
  if (tags.length && row.customTagNames) {
    const names = row.customTagNames.split(',').map((n) => n.trim())
    editSelectedCustomTagIds.value = tags.filter((t) => names.includes(t.name)).map((t) => t.id)
  }
  showEditModal.value = true
}

async function onEditSetupChange() {
  editSelectedStrategyIds.value = []
  editSelectedCustomTagIds.value = []
  editStrategies.value = []
  editAllCustomTags.value = []
  editRRTypes.value = []
  if (editForm.value.setupId) {
    ;[editStrategies.value, editAllCustomTags.value, editRRTypes.value] = await Promise.all([
      window.api.getStrategiesForSetup(Number(editForm.value.setupId)),
      window.api.getCustomTagsForSetup(Number(editForm.value.setupId)),
      window.api.getRRTypesForSetup(Number(editForm.value.setupId))
    ])
  }
}

function toggleEditStrategy(id) {
  const idx = editSelectedStrategyIds.value.indexOf(id)
  if (idx === -1) editSelectedStrategyIds.value.push(id)
  else editSelectedStrategyIds.value.splice(idx, 1)
}
function toggleEditCustomTag(id) {
  const idx = editSelectedCustomTagIds.value.indexOf(id)
  if (idx === -1) editSelectedCustomTagIds.value.push(id)
  else editSelectedCustomTagIds.value.splice(idx, 1)
}
function addEditImageUrl() {
  editImageUrlInputs.value.push('')
}
function removeEditImageUrl(i) {
  if (editImageUrlInputs.value.length === 1) {
    editImageUrlInputs.value[0] = ''
    return
  }
  editImageUrlInputs.value.splice(i, 1)
}
function onEditDateInput(field, e) {
  editForm.value[field] = normalizeThaiDateInput(e.target.value)
}
function pickEditDate(field, refEl) {
  const iso = parseThaiDisplayDateToIso(editForm.value[field])
  if (iso && refEl) refEl.value = iso
  openNativePicker(refEl)
}
function onNativeEditDateChange(field, val) {
  editForm.value[field] = isoToThaiDisplayDate(val)
}
function onTimeInputEdit(field, e) {
  let v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
  if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2)
  e.target.value = v
  editForm.value[field] = v
}
function buildEditIso(date, time) {
  const iso = parseThaiDisplayDateToIso(date)
  if (!iso) return null
  return time ? `${iso}T${time}` : `${iso}T00:00`
}
async function saveEdit() {
  editError.value = ''
  if (!editForm.value.entryDate || !editForm.value.entryTime) {
    editError.value = 'กรุณากรอกวันและเวลา Entry'
    return
  }
  if (!parseThaiDisplayDateToIso(editForm.value.entryDate)) {
    editError.value = 'รูปแบบวันที่ Entry ต้องเป็น dd/mm/yyyy (ค.ศ.)'
    return
  }
  editLoading.value = true
  try {
    const imageUrls = editImageUrlInputs.value.map((u) => u.trim()).filter(Boolean)
    await window.api.updateJournal({
      id: editRow.value.id,
      entryDateTime: buildEditIso(editForm.value.entryDate, editForm.value.entryTime),
      exitDateTime: buildEditIso(editForm.value.exitDate, editForm.value.exitTime),
      symbol: editForm.value.symbol,
      session: editForm.value.session || 'New York',
      position: editForm.value.position,
      directionBias: editForm.value.directionBias,
      tf: editForm.value.tf,
      rrTypeId: editForm.value.rrTypeId ? Number(editForm.value.rrTypeId) : null,
      rrType: editForm.value.rrType, 
      slPoint: editForm.value.slPoint !== '' ? parseFloat(editForm.value.slPoint) : null,
      tpPoint: editForm.value.tpPoint !== '' ? parseFloat(editForm.value.tpPoint) : null,
      result: editForm.value.result,
      notes: editForm.value.notes || null,
      setupId: Number(editForm.value.setupId),
      colorRating: editForm.value.colorRating || null,
      hasNews: editForm.value.hasNews ? 1 : 0,
      isTest: editForm.value.isTest ? 1 : 0,
      isExcluded: editForm.value.isExcluded ? 1 : 0,
      timeBos: editSelectedCustomTagIds.value
        .map((id) => editAllCustomTags.value.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .join(',') || null,
      strategyIds: [...editSelectedStrategyIds.value],
      customTagIds: [...editSelectedCustomTagIds.value],
      imageUrls
    })
    showEditModal.value = false
    await runQuery()
  } catch (e) {
    editError.value = e.message ?? 'บันทึกไม่สำเร็จ'
  } finally {
    editLoading.value = false
  }
}
function closeEdit() {
  showEditModal.value = false
}

// ── Image Gallery ─────────────────────────────────────────────────────────────
const galleryDataUrls = ref({})   // cache: originalUrl → base64 data URL or 'error'
const galleryLoadStates = ref({}) // 'loading' | 'ok' | 'error'
const isFullView = ref(false)

function getTradingViewImageUrl(url) {
  const m = url?.match(/tradingview\.com\/x\/([A-Za-z0-9]+)\/?/)
  if (!m) return null
  const id = m[1]
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`
}

function rawImageUrl(url) {
  return getTradingViewImageUrl(url) ?? (isDirectImage(url) ? url : null)
}

function isDirectImage(url) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?)(\?.*)?$/i.test(url)
}

function resolvedImageUrl(url) {
  return getTradingViewImageUrl(url) ?? (isDirectImage(url) ? url : null)
}

async function fetchGalleryImage(url) {
  if (galleryLoadStates.value[url]) return // already loading or loaded
  const fetchUrl = rawImageUrl(url)
  if (!fetchUrl) {
    galleryLoadStates.value[url] = 'no-image'
    return
  }
  galleryLoadStates.value[url] = 'loading'
  try {
    const res = await window.api.fetchImageAsBase64(fetchUrl)
    if (res.ok) {
      galleryDataUrls.value[url] = res.dataUrl
      galleryLoadStates.value[url] = 'ok'
    } else {
      galleryLoadStates.value[url] = 'error'
    }
  } catch {
    galleryLoadStates.value[url] = 'error'
  }
}

const handleGalleryKeydown = (e) => {
  if (!showGallery.value) return
  if (e.key === 'ArrowLeft') galleryPrev()
  else if (e.key === 'ArrowRight') galleryNext()
  else if (e.key === 'Escape') closeGallery()
}

function openGallery(imageUrls) {
  if (!imageUrls?.length) return
  galleryImages.value = imageUrls
  galleryIndex.value = 0
  isFullView.value = false
  showGallery.value = true
  // Pre-fetch all images
  for (const url of imageUrls) fetchGalleryImage(url)
  window.addEventListener('keydown', handleGalleryKeydown)
}
function closeGallery() {
  showGallery.value = false
  isFullView.value = false
  window.removeEventListener('keydown', handleGalleryKeydown)
}

onUnmounted(() => {
  window.removeEventListener('keydown', handleGalleryKeydown)
})
function toggleFullView() {
  isFullView.value = !isFullView.value
}
function galleryPrev() {
  galleryIndex.value =
    (galleryIndex.value - 1 + galleryImages.value.length) % galleryImages.value.length
}
function galleryNext() {
  galleryIndex.value = (galleryIndex.value + 1) % galleryImages.value.length
}
function openInBrowser(url) {
  window.api.openExternal(url)
}
</script>

<template>
  <div class="view-container">
    <h2 class="view-title">Dashboard</h2>

    <p v-if="loadError" class="err-banner">⚠ {{ loadError }}</p>

    <!-- ── Account Settings ──────────────────────────────────────────────── -->
    <div class="settings-bar">
      <div class="setting-item">
        <label>Initial Balance ($)</label>
        <input v-model.number="initialBalance" type="number" min="1" step="1" />
      </div>
      <div class="setting-item">
        <label>Risk per Trade (%)</label>
        <input v-model.number="riskPercent" type="number" min="0.1" step="0.1" />
      </div>
      <div class="setting-derived">
        <span
          >Risk $: <strong>${{ ((initialBalance * riskPercent) / 100).toFixed(2) }}</strong></span
        >
      </div>

      <div class="setting-item">
        <label>Return Calculation</label>
        <div class="toggle-group">
          <button
            class="toggle-btn"
            :class="{ active: returnType === 'simple' }"
            @click="returnType = 'simple'"
          >
            Simple
          </button>
          <button
            class="toggle-btn"
            :class="{ active: returnType === 'log' }"
            @click="returnType = 'log'"
          >
            Log (Compounded)
          </button>
        </div>
      </div>
    </div>

    <!-- ── Database Management ───────────────────────────────────────────── -->
    <div class="db-settings">
      <div class="db-path-row">
        <span class="db-label">Database</span>
        <span class="db-path" :title="dbPath">{{ dbPath }}</span>
        <button class="btn-sm" @click="changeDbFolder">Change Folder</button>
        <button class="btn-sm" @click="exportDb">Export</button>
        <button class="btn-sm btn-danger" @click="importDb">Import</button>
      </div>
    </div>

    <!-- ── Filter Panel ──────────────────────────────────────────────────── -->
    <div class="filter-panel">

      <!-- ── Setup Slots ──────────────────────────────────────────────────── -->
      <div class="setup-slots">
        <div v-for="(slot, idx) in filters.setupSlots" :key="idx" class="setup-slot">
          <!-- slot header -->
          <div class="setup-slot-header">
            <span class="slot-title">Setup {{ filters.setupSlots.length > 1 ? idx + 1 : '' }}</span>
            <button v-if="filters.setupSlots.length > 1" type="button" class="slot-remove-btn" @click="removeSetupSlot(idx)">✕</button>
          </div>

          <!-- row 1: Setup + Session + RR Type + Symbol -->
          <div class="slot-row">
            <div class="slot-field">
              <div class="slot-field-label">Trade Setup</div>
              <select v-model="slot.setupId" @change="onSlotSetupChange(slot)">
                <option value="">All</option>
                <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>

            <div class="slot-field">
              <div class="slot-field-label">Session <span v-if="slot.sessions.length" class="filter-count">{{ slot.sessions.length }}</span></div>
              <div class="slot-dropdown-wrap" @click.stop>
                <button type="button" class="slot-dropdown-btn" @click="slot.openDropdown = slot.openDropdown === 'session' ? null : 'session'">
                  {{ slot.sessions.length ? slot.sessions.join(', ') : 'All' }} ▾
                </button>
                <div v-if="slot.openDropdown === 'session'" class="slot-dropdown-panel">
                  <label v-for="s in ALL_SESSIONS" :key="s" class="slot-dd-item">
                    <input type="checkbox" :checked="slot.sessions.includes(s)" @change="toggleSlotMulti(slot.sessions, s)" />{{ s }}
                  </label>
                </div>
              </div>
            </div>

            <div class="slot-field">
              <div class="slot-field-label">RR Type <span v-if="slot.rrTypeIds.length" class="filter-count">{{ slot.rrTypeIds.length }}</span></div>
              <div class="slot-dropdown-wrap" @click.stop>
                <button type="button" class="slot-dropdown-btn" @click="slot.openDropdown = slot.openDropdown === 'rrType' ? null : 'rrType'">
                  {{ slot.rrTypeIds.length ? slot.rrTypeIds.length + ' selected' : 'All' }} ▾
                </button>
                <div v-if="slot.openDropdown === 'rrType'" class="slot-dropdown-panel">
                  <label v-for="r in rrTypeOptions" :key="r.id" class="slot-dd-item">
                    <input type="checkbox" :checked="slot.rrTypeIds.includes(r.id)" @change="toggleSlotMulti(slot.rrTypeIds, r.id)" />{{ r.name }}
                  </label>
                  <span v-if="!rrTypeOptions.length" class="empty-hint">No RR Types</span>
                </div>
              </div>
            </div>

            <div class="slot-field">
              <div class="slot-field-label">Symbol <span v-if="slot.symbols.length" class="filter-count">{{ slot.symbols.length }}</span></div>
              <div class="slot-dropdown-wrap" @click.stop>
                <button type="button" class="slot-dropdown-btn" @click="slot.openDropdown = slot.openDropdown === 'symbol' ? null : 'symbol'">
                  {{ slot.symbols.length ? slot.symbols.join(', ') : 'All' }} ▾
                </button>
                <div v-if="slot.openDropdown === 'symbol'" class="slot-dropdown-panel">
                  <label v-for="sym in symbolOptions" :key="sym" class="slot-dd-item">
                    <input type="checkbox" :checked="slot.symbols.includes(sym)" @change="toggleSlotMulti(slot.symbols, sym)" />{{ sym }}
                  </label>
                  <span v-if="!symbolOptions.length" class="empty-hint">No symbols</span>
                </div>
              </div>
            </div>
          </div>

          <!-- row 2: News + Test + Excluded + Rating -->
          <div class="slot-row">
            <div class="slot-field sm">
              <div class="slot-field-label">News</div>
              <select v-model="slot.hasNews" class="sm-select">
                <option :value="null">All</option>
                <option :value="1">With News</option>
                <option :value="0">No News</option>
              </select>
            </div>
            <div class="slot-field sm">
              <div class="slot-field-label">Test</div>
              <select v-model="slot.isTest" class="sm-select">
                <option :value="null">All</option>
                <option :value="true">Test Only</option>
                <option :value="false">Real Only</option>
              </select>
            </div>
            <div class="slot-field sm">
              <div class="slot-field-label">Excluded</div>
              <select v-model="slot.isExcluded" class="sm-select">
                <option :value="null">All</option>
                <option :value="true">Excluded</option>
                <option :value="false">Non-Excluded</option>
              </select>
            </div>
            <div class="slot-field sm">
              <div class="slot-field-label">Rating</div>
              <div class="color-filter-row">
                <button
                  v-for="c in COLOR_OPTIONS" :key="c"
                  type="button"
                  class="color-filter-chip"
                  :class="[`color-filter-chip--${c}`, { active: slot.colorRatings.includes(c) }]"
                  @click="toggleSlotColor(slot, c)"
                ></button>
              </div>
            </div>
          </div>

          <!-- row 3: Strategy chips + TimeBOS chips -->
          <div class="slot-row wrap-row">
            <div class="slot-field grow">
              <div class="slot-field-label">Strategy <span v-if="slot.strategyIds.length" class="filter-count">{{ slot.strategyIds.length }}</span></div>
              <div class="chip-row">
                <template v-if="slot.setupId">
                  <button
                    v-for="s in slot.strategies" :key="s.id"
                    type="button" class="filter-chip"
                    :class="{ active: slot.strategyIds.includes(s.id) }"
                    @click="toggleSlotMulti(slot.strategyIds, s.id)"
                  >{{ s.name }}</button>
                  <span v-if="!slot.strategies.length" class="empty-hint">No strategies</span>
                </template>
                <span v-else class="empty-hint">Select a setup first</span>
              </div>
            </div>
            <div class="slot-field grow">
              <div class="slot-field-label">{{ customColumnName }} <span v-if="slot.customTagIds.length" class="filter-count">{{ slot.customTagIds.length }}</span></div>
              <div class="chip-row">
                <template v-if="slot.setupId">
                  <button
                    v-for="t in slot.customTags" :key="t.id"
                    type="button" class="filter-chip"
                    :class="{ active: slot.customTagIds.includes(t.id) }"
                    @click="toggleSlotMulti(slot.customTagIds, t.id)"
                  >{{ t.name }}</button>
                  <span v-if="!slot.customTags.length" class="empty-hint">No tags</span>
                </template>
                <span v-else class="empty-hint">Select a setup first</span>
              </div>
            </div>
          </div>
        </div>

        <button type="button" class="slot-add-btn" @click="addSetupSlot">+ Add Setup</button>
      </div>

      <!-- ── Date range (shared) ──────────────────────────────────────────── -->
      <div class="filter-row">
        <div class="filter-group sm">
          <div class="filter-label">Date From</div>
          <div class="date-input-wrap">
            <input :value="filters.dateFrom" type="text" placeholder="dd/mm/yyyy" maxlength="10" @input="onFilterDateInput('dateFrom', $event)" />
            <button type="button" class="date-picker-btn" @click="pickFilterDate('dateFrom', nativeDateFromRef)">📅</button>
            <input ref="nativeDateFromRef" class="native-date-picker" type="date" tabindex="-1" aria-hidden="true" @change="onNativeFilterDateChange('dateFrom', $event.target.value)" />
          </div>
        </div>
        <div class="filter-group sm">
          <div class="filter-label">Date To</div>
          <div class="date-input-wrap">
            <input :value="filters.dateTo" type="text" placeholder="dd/mm/yyyy" maxlength="10" @input="onFilterDateInput('dateTo', $event)" />
            <button type="button" class="date-picker-btn" @click="pickFilterDate('dateTo', nativeDateToRef)">📅</button>
            <input ref="nativeDateToRef" class="native-date-picker" type="date" tabindex="-1" aria-hidden="true" @change="onNativeFilterDateChange('dateTo', $event.target.value)" />
          </div>
        </div>
      </div>

      <div class="filter-actions">
        <button class="btn-primary" :disabled="isLoading" @click="runQuery">
          {{ isLoading ? 'Loading…' : 'Apply Filters' }}
        </button>
        <button class="btn-secondary" @click="clearFilters">Clear</button>
        <button class="btn-charts-toggle" @click="showCharts = !showCharts">
          {{ showCharts ? '👁 Hide Charts' : '📊 Show Charts' }}
        </button>
        <span class="result-count"
          >{{ results.length }} record{{ results.length !== 1 ? 's' : '' }}</span
        >
      </div>
    </div>

    <!-- ── Win Rate Pie (floating top-right, draggable) ─────────────────── -->
    <div
      v-if="enhancedSummary"
      class="winrate-float"
      :style="{
        top: piePos.top + 'px',
        left: piePos.left != null ? piePos.left + 'px' : 'auto',
        right: piePos.right != null ? piePos.right + 'px' : 'auto',
      }"
      @mousedown="onPieMousedown"
    >
      <div class="stat-label">Win Rate</div>
      <div class="winrate-pie-wrap">
        <canvas ref="winrateChartCanvas" class="winrate-canvas"></canvas>
        <div class="winrate-center">{{ winRateDisplay }}</div>
      </div>
      <div class="winrate-legend">
        <span class="wl-win">▮ W {{ enhancedSummary.wins }}</span>
        <span class="wl-loss">▮ L {{ enhancedSummary.losses }}</span>
        <span class="wl-be">▮ BE {{ enhancedSummary.total - enhancedSummary.wins - enhancedSummary.losses }}</span>
      </div>
    </div>

    <!-- ── Summary Stats ─────────────────────────────────────────────────── -->
    <div v-if="enhancedSummary" class="stats-grid">
      <div class="stat">
        <div class="stat-label">Total</div>
        <div class="stat-value">{{ enhancedSummary.total }}</div>
      </div>
      <div class="stat win">
        <div class="stat-label">Wins</div>
        <div class="stat-value">{{ enhancedSummary.wins }}</div>
      </div>
      <div class="stat loss">
        <div class="stat-label">Losses</div>
        <div class="stat-value">{{ enhancedSummary.losses }}</div>
      </div>
      <div class="stat" :class="enhancedSummary.totalDollarPnl >= 0 ? 'win' : 'loss'">
        <div class="stat-label">Net PnL</div>
        <div class="stat-value">${{ enhancedSummary.totalDollarPnl }}</div>
      </div>
      <div class="stat win">
        <div class="stat-label">Gross Profit</div>
        <div class="stat-value">${{ enhancedSummary.grossProfit }}</div>
      </div>
      <div class="stat loss">
        <div class="stat-label">Gross Loss</div>
        <div class="stat-value">${{ enhancedSummary.grossLoss }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Profit Factor</div>
        <div class="stat-value">{{ enhancedSummary.profitFactor }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg RR</div>
        <div class="stat-value">{{ enhancedSummary.avgRR }}</div>
      </div>
      <div class="stat win">
        <div class="stat-label">Avg Win $</div>
        <div class="stat-value">${{ enhancedSummary.avgWin }}</div>
      </div>
      <div class="stat loss">
        <div class="stat-label">Avg Loss $</div>
        <div class="stat-value">${{ enhancedSummary.avgLoss }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Consec. Wins</div>
        <div class="stat-value">{{ enhancedSummary.maxConsecWin }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Consec. Losses</div>
        <div class="stat-value">{{ enhancedSummary.maxConsecLoss }}</div>
      </div>
      <div class="stat" :class="enhancedSummary.finalBalance >= initialBalance ? 'win' : 'loss'">
        <div class="stat-label">Final Balance</div>
        <div class="stat-value">${{ enhancedSummary.finalBalance }}</div>
      </div>
      <div class="stat loss">
        <div class="stat-label">Max Drawdown</div>
        <div class="stat-value">{{ enhancedSummary.minDrawdown }}%</div>
      </div>
    </div>

    <!-- Performance Charts -->
    <div v-show="showCharts && results.length" class="charts-container">
      <div class="chart-box">
        <div class="chart-header">
          <span class="chart-icon">📈 Equity Curve</span>
        </div>
        <div class="chart-body">
          <canvas ref="equityChartCanvas"></canvas>
        </div>
      </div>

      <div class="chart-box">
        <div class="chart-header">
          <span class="chart-icon">📉 Drawdown (%)</span>
        </div>
        <div class="chart-body">
          <canvas ref="drawdownChartCanvas"></canvas>
        </div>
      </div>

      <!-- NPL Breakdown -->
      <div class="chart-box">
        <div class="chart-header">
          <div class="chart-header-title">
            <span class="chart-icon">📊 Net PnL Breakdown</span>
          </div>
          <select v-model="pnlGroupBy" class="chart-group-select">
            <option value="day">By Day (Mon-Fri)</option>
            <option value="symbol">By Symbol</option>
            <option value="session">By Session</option>
            <option value="rrType">By RR Type</option>
            <option value="rating">By Rating</option>
            <option value="news">By News</option>
          </select>
        </div>
        <div class="chart-body">
          <canvas ref="pnlChartCanvas"></canvas>
        </div>
      </div>
    </div>

    <!-- ── Results Table ─────────────────────────────────────────────────── -->
    <div class="table-wrapper">
      <!-- Sort bar -->
      <div v-if="sortedRows.length" class="sort-bar">
        <span class="sort-bar-label">Sort by</span>
        <select v-model="sortCol" class="sort-select">
          <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <button
          class="sort-dir-btn"
          :title="sortDir === 'asc' ? 'Ascending' : 'Descending'"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        >{{ sortDir === 'asc' ? '↑ Asc' : '↓ Desc' }}</button>

        <button class="btn-add-trade" @click="showAddModal = true">+ Add Trade</button>

        <div class="table-search-wrap">
          <input
            v-model="tableSearch"
            class="table-search-input"
            placeholder="Search in table…"
            type="text"
          />
          <button v-if="tableSearch" class="table-search-clear" @click="tableSearch = ''">
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="10" height="10">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <span v-if="tableSearch" class="search-result-count">
          {{ filteredRows.length }} / {{ sortedRows.length }}
        </span>
      </div>

      <table v-if="sortedRows.length">
        <thead>
          <tr>
            <th class="excl-check-th" title="ติ๊กเพื่อไม่นับรวม stat">—</th>
            <th>No.</th>
            <th>ทดสอบ</th>
            <th>Entry Date</th>
            <th>Symbol</th>
            <th>Direction</th>
            <th>TF</th>
            <th>Position</th>
            <th>Session</th>
            <th>Time Entry</th>
            <th>Time Exit</th>
            <th>Holding</th>
            <th>SL Pt</th>
            <th>TP Pt</th>
            <th>Result</th>
            <th>Risk</th>
            <th>Reward</th>
            <th>RRR</th>
            <th>$PnL</th>
            <th>%PnL</th>
            <th>$Balance</th>
            <th>Drawdown</th>
            <th>Setup</th>
            <th>Strategy</th>
            <th>{{ customColumnName }}</th>
            <th>News</th>
            <th>Rating</th>
            <th>Excl.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in paginatedRows"
            :key="row.id"
            :class="[
              row.result === 'Win' ? 'row-win' : row.result === 'Loss' ? 'row-loss' : '',
              row.isExcluded ? 'row-excluded' : '',
              row._manualExcluded ? 'row-manual-excl' : ''
            ]"
          >
            <td class="excl-check-cell">
              <input
                type="checkbox"
                :checked="manualExcludeIds.has(row.id)"
                @change="toggleManualExclude(row.id)"
                title="ไม่นับรวม stat"
              />
            </td>
            <td class="num">{{ row.no }}</td>
            <td class="test-cell">{{ row.isTest ? '🧪' : '—' }}</td>
            <td>{{ fmtDate(row.entryDateTime) }}</td>
            <td class="sym">{{ row.symbol }}</td>
            <td
              :class="
                row.directionBias === 'Bullish'
                  ? 'bull'
                  : row.directionBias === 'Bearish'
                    ? 'bear'
                    : ''
              "
            >
              {{ row.directionBias || '—' }}
            </td>
            <td>{{ row.tf || '—' }}</td>
            <td>{{ row.position }}</td>
            <td>{{ row.session }}</td>
            <td>{{ fmtTime(row.entryDateTime) }}</td>
            <td>{{ fmtTime(row.exitDateTime) }}</td>
            <td>{{ row.holding }}</td>
            <td>{{ row.slPoint ?? '—' }}</td>
            <td>{{ row.tpPoint ?? '—' }}</td>
            <td :class="['result-cell', row.result.toLowerCase()]">{{ row.result }}</td>
            <td :class="row.risk < 0 ? 'neg' : ''">{{ row.risk }}</td>
            <td :class="row.reward > 0 ? 'pos' : ''">{{ row.reward }}</td>
            <td :class="row.rrr > 0 ? 'pos' : row.rrr < 0 ? 'neg' : ''">{{ row.rrr }}</td>
            <td :class="row.dollarPnl > 0 ? 'pos' : row.dollarPnl < 0 ? 'neg' : ''">
              ${{ row.dollarPnl }}
            </td>
            <td :class="row.pctPnl > 0 ? 'pos' : row.pctPnl < 0 ? 'neg' : ''">{{ row.pctPnl }}%</td>
            <td>${{ row.balance }}</td>
            <td :class="row.drawdown < 0 ? 'neg' : ''">{{ row.drawdown }}%</td>
            <td>{{ row.setupName || '—' }}</td>
            <td>{{ row.strategyNames || '—' }}</td>
            <td>{{ row.timeBos || row.customTagNames || '—' }}</td>
            <td class="news-cell">{{ row.hasNews ? '✓' : '—' }}</td>
            <td>
              <span
                v-if="row.colorRating"
                :class="`rating-dot rating-dot--${row.colorRating}`"
              ></span>
              <span v-else>—</span>
            </td>
            <td class="excl-cell">{{ row.isExcluded ? '✖' : '—' }}</td>
            <td class="action-cell">
              <button
                v-if="row.imageUrls?.length"
                class="btn-img"
                title="ดูรูปภาพ"
                @click="openGallery(row.imageUrls)"
              >
                🖼
              </button>
              <button class="btn-edit" title="แก้ไข" @click="openEdit(row)">✏</button>
              <button class="btn-delete" title="ลบ" @click="deleteRow(row.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!isLoading" class="empty-msg">No records match the current filters.</p>

      <!-- ── Pagination Controls ─────────────────────────────────────────── -->
      <div v-if="sortedRows.length > 0" class="pagination-bar">
        <div class="pagination-info">
          <span>Rows per page:</span>
          <select v-model.number="pageSize" class="page-size-select">
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
          <span class="pagination-count">
            {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, sortedRows.length) }} of {{ sortedRows.length }}
          </span>
        </div>
        <div class="pagination-controls">
          <button class="page-btn" :disabled="currentPage === 1" @click="goToPage(1)">«</button>
          <button class="page-btn" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">‹</button>
          <template v-for="p in totalPages" :key="p">
            <button
              v-if="p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2"
              class="page-btn"
              :class="{ active: p === currentPage }"
              @click="goToPage(p)"
            >{{ p }}</button>
            <span
              v-else-if="p === currentPage - 3 || p === currentPage + 3"
              class="page-ellipsis"
            >…</span>
          </template>
          <button class="page-btn" :disabled="currentPage === totalPages" @click="goToPage(currentPage + 1)">›</button>
          <button class="page-btn" :disabled="currentPage === totalPages" @click="goToPage(totalPages)">»</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Edit Modal ──────────────────────────────────────────────────────── -->
  <teleport to="body">
    <div v-if="showEditModal" class="modal-backdrop" @click.self="closeEdit">
      <div class="modal-panel edit-modal">
        <div class="modal-header">
          <h3>✏ แก้ไขรายการ #{{ editRow?.id }}</h3>
          <button class="modal-close" @click="closeEdit">✕</button>
        </div>
        <div class="modal-body">
          <!-- Entry & Exit datetime -->
          <div class="edit-row">
            <div class="edit-group">
              <label>Entry Date &amp; Time *</label>
              <div class="dt-inputs">
                <div class="date-input-wrap">
                  <input
                    :value="editForm.entryDate"
                    type="text"
                    placeholder="dd/mm/yyyy"
                    maxlength="10"
                    @input="onEditDateInput('entryDate', $event)"
                  />
                  <button
                    type="button"
                    class="date-picker-btn"
                    @click="pickEditDate('entryDate', nativeEditEntryRef)"
                  >
                    📅
                  </button>
                  <input
                    ref="nativeEditEntryRef"
                    class="native-date-picker"
                    type="date"
                    tabindex="-1"
                    aria-hidden="true"
                    @change="onNativeEditDateChange('entryDate', $event.target.value)"
                  />
                </div>
                <input
                  :value="editForm.entryTime"
                  type="text"
                  placeholder="HH:MM"
                  maxlength="5"
                  class="time-input"
                  @input="onTimeInputEdit('entryTime', $event)"
                />
              </div>
            </div>
            <div class="edit-group">
              <label>Exit Date &amp; Time</label>
              <div class="dt-inputs">
                <div class="date-input-wrap">
                  <input
                    :value="editForm.exitDate"
                    type="text"
                    placeholder="dd/mm/yyyy"
                    maxlength="10"
                    @input="onEditDateInput('exitDate', $event)"
                  />
                  <button
                    type="button"
                    class="date-picker-btn"
                    @click="pickEditDate('exitDate', nativeEditExitRef)"
                  >
                    📅
                  </button>
                  <input
                    ref="nativeEditExitRef"
                    class="native-date-picker"
                    type="date"
                    tabindex="-1"
                    aria-hidden="true"
                    @change="onNativeEditDateChange('exitDate', $event.target.value)"
                  />
                </div>
                <input
                  :value="editForm.exitTime"
                  type="text"
                  placeholder="HH:MM"
                  maxlength="5"
                  class="time-input"
                  @input="onTimeInputEdit('exitTime', $event)"
                />
              </div>
            </div>
          </div>

          <!-- Symbol + Session + Position + Direction -->
          <div class="edit-row">
            <div class="edit-group">
              <label>Symbol *</label>
              <select v-model="editForm.symbol">
                <option v-for="s in symbolOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div class="edit-group">
              <label>Session</label>
              <select v-model="editForm.session">
                <option v-for="s in ALL_SESSIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div class="edit-group">
              <label>Position</label>
              <select v-model="editForm.position">
                <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div class="edit-group">
              <label>Direction Bias</label>
              <select v-model="editForm.directionBias">
                <option v-for="d in DIRECTION_BIAS" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
          </div>

          <!-- Setup + TF -->
          <div class="edit-row">
            <div class="edit-group">
              <label>Trade Setup *</label>
              <select v-model="editForm.setupId" @change="onEditSetupChange">
                <option value="" disabled>Select a setup…</option>
                <option v-for="s in setups" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
              </select>
            </div>
            <div class="edit-group">
              <label>TF</label>
              <select v-model="editForm.tf">
                <option v-for="t in TF_OPTIONS" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
          </div>

          <!-- Strategy -->
          <div class="edit-group edit-group--full">
            <label>Strategy <span class="edit-auto-tag">(multi-select)</span></label>
            <div class="edit-chips">
              <button
                v-for="s in sortedEditStrategies"
                :key="s.id"
                type="button"
                class="edit-chip chip--blue"
                :class="{ active: editSelectedStrategyIds.includes(s.id) }"
                @click="toggleEditStrategy(s.id)"
              >
                {{ s.name }}
              </button>
              <span v-if="!editForm.setupId" class="chip-empty">Select a setup first</span>
              <span v-else-if="!editStrategies.length" class="chip-empty">No strategies</span>
            </div>
          </div>

          <!-- RR + SL + TP + Result -->
          <div class="edit-row">
            <div class="edit-group">
              <label>RR Type</label>
              <select v-model="editForm.rrTypeId">
                <option value="" disabled>{{ !editForm.setupId ? 'Select Setup first' : 'Select RR Type' }}</option>
                <option v-for="r in editRRTypes" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
              </select>
            </div>
            <div class="edit-group">
              <label>SL Point</label>
              <input v-model="editForm.slPoint" type="number" step="0.1" min="0" />
            </div>
            <div class="edit-group">
              <label>TP Point</label>
              <input v-model="editForm.tpPoint" type="number" step="0.1" min="0" />
            </div>
            <div class="edit-group">
              <label>Result</label>
              <select v-model="editForm.result">
                <option v-for="r in RESULTS" :key="r" :value="r">{{ r }}</option>
              </select>
            </div>
          </div>

          <!-- News + Color Rating -->
          <div class="edit-row">
            <div class="edit-group">
              <label>News</label>
              <label class="edit-checkbox-field">
                <input v-model="editForm.hasNews" type="checkbox" />
                <span>{{ editForm.hasNews ? 'มีข่าว' : 'ไม่มีข่าว' }}</span>
              </label>
            </div>
            <div class="edit-group edit-group--wide">
              <label>ระดับสี (Quality)</label>
              <div class="edit-color-picker">
                <button
                  v-for="c in ['red', 'orange', 'yellow', 'green']"
                  :key="c"
                  type="button"
                  class="edit-color-chip"
                  :class="[`color-chip--${c}`, { active: editForm.colorRating === c }]"
                  @click="editForm.colorRating = editForm.colorRating === c ? '' : c"
                  :title="c"
                ></button>
              </div>
            </div>
          </div>

          <!-- Custom Tags -->
          <div class="edit-group edit-group--full">
            <label>{{ customColumnName }} <span class="edit-auto-tag">(multi-select)</span></label>
            <div class="edit-chips">
              <button
                v-for="t in sortedEditCustomTags"
                :key="t.id"
                type="button"
                class="edit-chip"
                :class="{ active: editSelectedCustomTagIds.includes(t.id) }"
                @click="toggleEditCustomTag(t.id)"
              >
                {{ t.name }}
              </button>
              <span v-if="!editForm.setupId" class="chip-empty">Select a setup first</span>
              <span v-else-if="!editAllCustomTags.length" class="chip-empty"
                >No tags linked to this setup</span
              >
            </div>
          </div>

          <!-- Image URLs -->
          <div class="edit-group edit-group--full">
            <label>Image URL(s)</label>
            <div class="edit-image-list">
              <div v-for="(_, idx) in editImageUrlInputs" :key="idx" class="edit-image-row">
                <input
                  v-model.trim="editImageUrlInputs[idx]"
                  type="url"
                  placeholder="https://example.com/image.png"
                />
                <button type="button" class="btn-url-remove" @click="removeEditImageUrl(idx)">
                  Remove
                </button>
              </div>
              <button type="button" class="btn-url-add" @click="addEditImageUrl">
                + Add Image URL
              </button>
            </div>
          </div>

          <div class="edit-row">
            <div class="edit-group">
              <label>News</label>
              <label class="checkbox-field">
                <input v-model="editForm.hasNews" type="checkbox" />
                <span>{{ editForm.hasNews ? 'มีข่าว' : 'ไม่มีข่าว' }}</span>
              </label>
            </div>
            <div class="edit-group">
              <label>รายการทดสอบ</label>
              <label class="checkbox-field">
                <input v-model="editForm.isTest" type="checkbox" />
                <span>{{ editForm.isTest ? 'เป็นรายการทดสอบ' : 'รายการจริง' }}</span>
              </label>
            </div>
            <div class="edit-group">
              <label>รายการไม่นับรวม</label>
              <label class="checkbox-field">
                <input v-model="editForm.isExcluded" type="checkbox" />
                <span>{{ editForm.isExcluded ? 'ไม่นับรวมสถิติ' : 'นับรวมสถิติปกติ' }}</span>
              </label>
            </div>
          </div>

          <!-- Notes -->
          <div class="edit-group edit-group--full">
            <label>Notes</label>
            <textarea
              v-model="editForm.notes"
              rows="3"
              placeholder="Optional trade notes…"
            ></textarea>
          </div>

          <p v-if="editError" class="edit-error">{{ editError }}</p>
        </div>
        <div class="modal-footer">
          <button class="btn-save" :disabled="editLoading" @click="saveEdit">
            {{ editLoading ? 'Saving…' : 'บันทึก' }}
          </button>
          <button class="btn-cancel" @click="closeEdit">ยกเลิก</button>
        </div>
      </div>
    </div>
  </teleport>

  <!-- ── Image Gallery Modal ─────────────────────────────────────────────── -->
  <teleport to="body">
    <div v-if="showGallery" class="modal-backdrop" :class="{ 'is-full-view-backdrop': isFullView }" @click.self="closeGallery">
      <div class="gallery-panel" :class="{ 'is-full-view-panel': isFullView }">
        <div class="gallery-header">
          <div class="gallery-header-info">
            <span>🖼 รูปภาพ {{ galleryIndex + 1 }} / {{ galleryImages.length }}</span>
            <button class="btn-fullscreen-toggle" @click="toggleFullView">
              {{ isFullView ? '🗗 ย่อหน้าต่าง' : '🗖 เต็มจอ' }}
            </button>
          </div>
          <button class="modal-close" @click="closeGallery">✕</button>
        </div>
        <div class="gallery-body">
          <button
            v-if="galleryImages.length > 1"
            class="gallery-nav gallery-prev"
            @click="galleryPrev"
          >
            &#8249;
          </button>

          <!-- Image Display (using base64 data if available) -->
          <div v-if="galleryLoadStates[galleryImages[galleryIndex]] === 'loading'" class="gallery-webcard">
             <div class="webcard-icon spinning">⌛</div>
             <p>กำลังโหลดรูปภาพ...</p>
          </div>

          <img
            v-else-if="galleryLoadStates[galleryImages[galleryIndex]] === 'ok'"
            :src="galleryDataUrls[galleryImages[galleryIndex]]"
            class="gallery-img"
            :alt="`Image ${galleryIndex + 1}`"
          />

          <!-- Fallback or Error webcard -->
          <div
            v-else-if="galleryLoadStates[galleryImages[galleryIndex]] === 'error'"
            class="gallery-webcard"
          >
            <div class="webcard-icon">⚠️</div>
            <div class="webcard-url">{{ galleryImages[galleryIndex] }}</div>
            <p class="webcard-note">โหลดรูปไม่สำเร็จ — กดเปิดในเบราว์เซอร์</p>
            <button class="webcard-btn" @click="openInBrowser(galleryImages[galleryIndex])">
              🌐 เปิดในเบราว์เซอร์
            </button>
          </div>

          <!-- Non-image link -->
          <div v-else class="gallery-webcard">
            <div class="webcard-icon">🔗</div>
            <div class="webcard-url">{{ galleryImages[galleryIndex] }}</div>
            <p class="webcard-note">
              URL นี้ไม่ใช่ไฟล์รูปโดยตรง — กดปุ่มด้านล่างเพื่อเปิดในเบราว์เซอร์
            </p>
            <button class="webcard-btn" @click="openInBrowser(galleryImages[galleryIndex])">
              🌐 เปิดในเบราว์เซอร์
            </button>
          </div>

          <button
            v-if="galleryImages.length > 1"
            class="gallery-nav gallery-next"
            @click="galleryNext"
          >
            &#8250;
          </button>
        </div>
        <div class="gallery-footer">
          <a
            href="#"
            class="gallery-link"
            @click.prevent="openInBrowser(galleryImages[galleryIndex])"
            >เปิดในเบราว์เซอร์ ↗</a
          >
        </div>
      </div>
    </div>
  </teleport>

  <!-- ── Add Trade Modal ──────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-show="showAddModal" class="add-modal-overlay" @click.self="showAddModal = false">
      <div class="add-modal-box">
        <div class="add-modal-header">
          <h3>New Journal Entry</h3>
          <button class="add-modal-close" @click="showAddModal = false">✕</button>
        </div>
        <div class="add-modal-body">
          <LogTradeForm @submitted="onTradeSubmitted" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.view-container {
  padding: 24px;
  position: relative;
}
.view-title {
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 20px;
}

/* Database management */
.db-settings {
  margin-bottom: 16px;
}
.db-path-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: var(--bg-mute);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 0.84rem;
}
.db-label {
  font-weight: 700;
  color: var(--text-3);
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.db-path {
  flex: 1;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 0.78rem;
  min-width: 0;
}
.btn-sm {
  padding: 4px 12px;
  background: var(--bg-input);
  color: var(--text-2);
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.btn-sm:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.btn-danger {
  border-color: var(--loss-border);
  color: var(--neg-text);
}
.btn-danger:hover {
  background: #5a1a1a;
}

/* Account settings */
.settings-bar {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
  background: var(--bg-mute);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 20px;
  margin-bottom: 16px;
}
.setting-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.setting-item label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-3);
  letter-spacing: 0.05em;
}
.setting-item input {
  width: 120px;
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-1);
  font-size: 0.9rem;
}
.setting-derived {
  font-size: 0.88rem;
  color: var(--text-2);
  padding-bottom: 6px;
}
.setting-derived strong {
  color: var(--accent);
}

/* Filter panel (Minimalist) */
.filter-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.filter-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-3);
  margin-bottom: 2px;
}
.filter-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
.checkbox-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.check-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.88rem;
  cursor: pointer;
  color: var(--text-1);
}

.symbol-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sym-chip {
  padding: 4px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  background: var(--bg-input);
  color: var(--text-2);
  font-size: 0.82rem;
  cursor: pointer;
}
.sym-chip.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 28px;
}
.filter-chip {
  padding: 3px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  background: var(--bg-input);
  color: var(--text-2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.filter-chip.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.filter-chip:hover:not(.active) {
  border-color: var(--border);
  color: var(--text-1);
}
.filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #fff;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 6px;
  margin-left: 4px;
  vertical-align: middle;
}
.sym-input-row {
  display: flex;
  gap: 4px;
}
.sym-input-row input {
  width: 100px;
  padding: 4px 8px;
  background: var(--bg-mute);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-1);
  font-size: 0.85rem;
}
.sym-input-row button {
  padding: 4px 10px;
  background: var(--bg-hover);
  border: none;
  border-radius: 6px;
  color: var(--text-1);
  cursor: pointer;
}
.active-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.active-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-bg);
  color: var(--text-active);
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 0.82rem;
}
.active-chip button {
  background: none;
  border: none;
  color: var(--text-active);
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
}

select,
input[type='text'],
input[type='number'] {
  appearance: none;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-1);
  font-size: 0.88rem;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
}
select:focus,
input[type='text']:focus,
input[type='number']:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
select {
  padding-right: 32px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(128,128,128,0.5)' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px;
  cursor: pointer;
}
.date-input-wrap {
  position: relative;
  display: flex;
  flex: 1;
}
.date-input-wrap > input[type='text'] {
  width: 100%;
}
.date-picker-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  padding: 5px;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 0.9rem;
  opacity: 0.6;
  transition: opacity 0.2s;
}
.date-picker-btn:hover {
  opacity: 1;
}
.native-date-picker {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}
.btn-primary {
  padding: 10px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--accent-bg);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  padding: 10px 20px;
  background: var(--bg-hover);
  color: var(--text-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}
.btn-secondary:hover {
  background: var(--bg-mute);
  color: var(--text-1);
}
.result-count {
  font-size: 0.85rem;
  color: var(--text-3);
  margin-left: 8px;
}

/* Stats grid (Minimalist Cards) */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.stat {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
}
.stat:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
}
.stat.win {
  border-color: var(--win-border);
  background: var(--win-bg);
}
.stat.loss {
  border-color: var(--loss-border);
  background: var(--loss-bg);
}
.stat-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-3);
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-1);
}
.stat.win .stat-value {
  color: var(--win-text);
}
.stat.loss .stat-value {
  color: var(--loss-text);
}

/* Win Rate Pie — floating card top-right */
.winrate-float {
  position: fixed;
  top: 24px;
  right: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  text-align: center;
  z-index: 100;
  min-width: 150px;
  cursor: grab;
  user-select: none;
}
.winrate-float:active {
  cursor: grabbing;
}
.winrate-pie-wrap {
  position: relative;
  width: 110px;
  height: 110px;
  margin: 6px auto 4px;
}
.winrate-canvas {
  width: 110px !important;
  height: 110px !important;
}
.winrate-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-1);
  pointer-events: none;
}
.winrate-legend {
  display: flex;
  justify-content: center;
  gap: 8px;
  font-size: 0.7rem;
  font-weight: 600;
  margin-top: 4px;
}
/* dark mode */
.wl-win  { color: #4ade80; }
.wl-loss { color: #f87171; }
.wl-be   { color: #fbbf24; }
/* light mode — softer */
[data-theme="light"] .wl-win  { color: #16a34a; }
[data-theme="light"] .wl-loss { color: #dc2626; }
[data-theme="light"] .wl-be   { color: #ca8a04; }

/* Table */
.table-wrapper {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th {
  text-align: left;
  padding: 14px 16px;
  background: var(--bg-soft);
  color: var(--text-3);
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.th-sort {
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, color 0.15s;
}
.th-sort:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.sort-icon {
  margin-left: 5px;
  font-size: 0.65rem;
  opacity: 0.5;
  vertical-align: middle;
}
.th-sort:hover .sort-icon,
.th-sort.active .sort-icon {
  opacity: 1;
}
.th-sort.active {
  color: var(--accent);
  background: var(--accent-bg);
}
td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-2);
  white-space: nowrap;
  font-size: 0.88rem;
  transition: background 0.15s;
}
tr:hover td {
  background: var(--bg-soft) !important;
}
tr.row-win td {
  background: var(--row-win-bg);
}
tr.row-loss td {
  background: var(--row-loss-bg);
}

.sym {
  font-weight: 700;
  color: var(--text-1);
}
.num {
  color: var(--text-3);
}
.bull {
  color: var(--pos-text);
  font-weight: 600;
}
.bear {
  color: var(--neg-text);
  font-weight: 600;
}
.pos {
  color: var(--pos-text);
}
.neg {
  color: var(--neg-text);
}

.result-cell.win {
  color: var(--win-text);
  font-weight: 600;
}
.result-cell.loss {
  color: var(--loss-text);
  font-weight: 600;
}
.result-cell.breakeven {
  color: var(--breakeven-text);
  font-weight: 600;
}

.btn-delete {
  background: none;
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  color: var(--text-3);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 0.8rem;
}
.btn-delete:hover {
  color: var(--neg-text);
  border-color: var(--neg-text);
}
tr.row-excluded {
  opacity: 0.6;
}
tr.row-manual-excl {
  opacity: 0.35;
  text-decoration: line-through;
  text-decoration-color: var(--text-3);
}
tr.row-manual-excl td {
  color: var(--text-3);
}
.test-cell, .excl-cell {
  text-align: center;
  font-size: 0.9rem;
}
.excl-check-th {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-3);
  min-width: 28px;
  width: 28px;
}
.excl-check-cell {
  text-align: center;
  padding: 0 4px;
}
.excl-check-cell input[type='checkbox'] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--neg-text);
}
.empty-msg {
  text-align: center;
  color: var(--text-3);
  padding: 40px;
}

/* Sort bar (Minimalist) */
.sort-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 14px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  flex-wrap: wrap;
}
.table-search-wrap {
  display: flex;
  align-items: center;
  position: relative;
  margin-left: auto;
}
.table-search-icon {
  position: absolute;
  left: 10px;
  width: 15px;
  height: 15px;
  pointer-events: none;
  color: var(--text-2);
  flex-shrink: 0;
}
.table-search-input {
  padding: 6px 30px 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-1);
  font-size: 0.82rem;
  width: 210px;
  outline: none;
  transition: border-color 0.15s, width 0.2s, box-shadow 0.15s;
}
.table-search-input::placeholder { color: var(--text-3); }
.table-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
  width: 270px;
}
.table-search-clear {
  position: absolute;
  right: 7px;
  background: none;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.table-search-clear:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}
.search-result-count {
  font-size: 0.78rem;
  color: var(--text-3);
  white-space: nowrap;
}
.sort-bar-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.sort-select {
  min-width: 140px;
  padding: 6px 10px;
  font-size: 0.82rem;
}
.sort-dir-btn {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-2);
  padding: 6px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}
.sort-dir-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.err-banner {
  background: var(--loss-bg);
  border: 1px solid var(--loss-border);
  border-radius: 12px;
  color: var(--loss-text);
  padding: 12px 20px;
  margin-bottom: 20px;
  font-size: 0.88rem;
}

/* ── Action buttons in table ─────────────────────────────────────────────────── */
.action-cell {
  display: flex;
  gap: 5px;
  align-items: center;
}
.btn-edit {
  background: none;
  border: 1px solid var(--accent-border);
  border-radius: 4px;
  color: var(--accent);
  cursor: pointer;
  padding: 2px 7px;
  font-size: 0.8rem;
  line-height: 1.4;
}
.btn-edit:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.btn-img {
  background: none;
  border: 1px solid var(--purple-border);
  border-radius: 4px;
  color: var(--purple);
  cursor: pointer;
  padding: 2px 7px;
  font-size: 0.8rem;
  line-height: 1.4;
}
.btn-img:hover {
  border-color: var(--purple);
  background: var(--purple-bg);
}

/* ── Modal Backdrop & Panel ──────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
  backdrop-filter: blur(8px);
}
.modal-panel {
  background: var(--bg-modal);
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  width: 100%;
  max-width: 820px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.modal-header h3 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-1);
  margin: 0;
}
.modal-close {
  background: none;
  border: none;
  color: var(--text-3);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1;
  transition:
    color 0.15s,
    background 0.15s;
}
.modal-close:hover {
  color: var(--loss-text);
  background: var(--loss-bg);
}
.modal-body {
  overflow-y: auto;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.modal-footer {
  display: flex;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.btn-save {
  padding: 8px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 7px;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-save:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-cancel {
  padding: 8px 20px;
  background: var(--bg-input);
  color: var(--text-2);
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  font-size: 0.9rem;
  cursor: pointer;
}
.btn-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

/* ── Edit Modal Form ─────────────────────────────────────────────────────────── */
.edit-modal .edit-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.edit-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 140px;
}
.edit-group--full {
  flex: 0 0 100%;
}
.edit-group label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-3);
}
.edit-auto-tag {
  font-weight: 400;
  text-transform: none;
  color: var(--accent);
  margin-left: 4px;
}
.edit-group input[type='text'],
.edit-group input[type='number'],
.edit-group input[type='url'],
.edit-group select,
.edit-group textarea {
  padding: 7px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-modal-inner);
  color: var(--text-1);
  font-size: 0.88rem;
  transition: border-color 0.2s;
}
.edit-group input:focus,
.edit-group select:focus,
.edit-group textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.edit-group textarea {
  resize: vertical;
}
.edit-modal .dt-inputs {
  display: flex;
  gap: 8px;
}
.edit-modal .date-input-wrap {
  flex: 3;
  position: relative;
  min-width: 0;
}
.edit-modal .date-input-wrap > input {
  width: 100%;
  padding-right: 38px;
}
.edit-modal .time-input {
  flex: 0 0 72px;
  text-align: center;
}
.edit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-height: 34px;
  align-items: center;
}
.edit-chip {
  padding: 5px 13px;
  border: 1px solid var(--border-soft);
  border-radius: 20px;
  background: var(--bg-mute);
  color: var(--text-2);
  cursor: pointer;
  font-size: 0.83rem;
  transition: all 0.15s;
}
.edit-chip.active {
  background: var(--win-bg);
  border-color: var(--win-border);
  color: var(--win-text);
}
.edit-chip.chip--blue.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}
.edit-chip:hover:not(.active) {
  border-color: var(--border);
  color: var(--text-1);
}
.chip-empty {
  font-size: 0.82rem;
  color: var(--text-3);
  font-style: italic;
}
.edit-image-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.edit-image-row {
  display: flex;
  gap: 8px;
}
.edit-image-row input {
  flex: 1;
}
.btn-url-add,
.btn-url-remove {
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-2);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 5px 11px;
  white-space: nowrap;
}
.btn-url-add {
  align-self: flex-start;
}
.edit-error {
  color: var(--neg-text);
  font-size: 0.87rem;
  background: var(--loss-bg);
  border: 1px solid var(--loss-border);
  border-radius: 6px;
  padding: 8px 12px;
}

/* ── Image Gallery ───────────────────────────────────────────────────────────── */
.gallery-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: 92vw;
  max-width: 1100px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.8);
}
.gallery-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
  font-size: 0.85rem;
  flex-shrink: 0;
}
.gallery-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 20px;
  min-height: 0;
  overflow: hidden;
}
.gallery-img {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.gallery-nav {
  background: rgba(128, 128, 128, 0.1);
  border: 1px solid var(--border-soft);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 1.6rem;
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background 0.15s,
    color 0.15s;
  padding: 0;
  line-height: 1;
}
.gallery-nav:hover {
  background: rgba(128, 128, 128, 0.2);
  color: var(--text-1);
}
.gallery-footer {
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  text-align: center;
  flex-shrink: 0;
}
.gallery-link {
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
}
.gallery-link:hover {
  text-decoration: underline;
}

/* ── Full Screen Mode ── */
.is-full-view-backdrop {
  background: black !important;
}
.is-full-view-panel {
  width: 100vw !important;
  max-width: 100vw !important;
  height: 100vh !important;
  max-height: 100vh !important;
  border: none !important;
  border-radius: 0 !important;
}
.is-full-view-panel .gallery-img {
  max-height: 85vh !important;
}
.gallery-header-info {
  display: flex;
  align-items: center;
  gap: 15px;
}
.btn-fullscreen-toggle {
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  color: var(--text-2);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-fullscreen-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-1);
  border-color: var(--border);
}

/* ── Gallery Web-Card (non-image URLs) ────────────────────────────────────── */
.gallery-webcard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px 32px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-width: 540px;
  width: 100%;
  text-align: center;
}
.webcard-icon {
  font-size: 3rem;
  line-height: 1;
}
.webcard-url {
  font-size: 0.82rem;
  color: var(--accent);
  word-break: break-all;
  max-width: 100%;
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  padding: 8px 12px;
  font-family: monospace;
}
.webcard-note {
  font-size: 0.84rem;
  color: var(--text-3);
  margin: 0;
}
.webcard-btn {
  padding: 10px 28px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.webcard-btn:hover {
  background: var(--accent-hover);
}

/* News + Color Rating */
.news-cell {
  color: var(--news-text);
  font-weight: 600;
}

.rating-dot {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  vertical-align: middle;
}
.rating-dot--red {
  background: var(--rating-red);
}
.rating-dot--orange {
  background: var(--rating-orange);
}
.rating-dot--yellow {
  background: var(--rating-yellow);
}
.rating-dot--green {
  background: var(--rating-green);
}

/* Edit modal — news checkbox */
.edit-checkbox-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-modal-inner);
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--text-1);
  user-select: none;
}
.edit-checkbox-field input[type='checkbox'] {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--accent);
}
.edit-group--wide {
  flex: 2;
  min-width: 200px;
}

/* Edit modal — color picker */
.edit-color-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.edit-color-chip {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--bg-mute);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
}
.edit-color-chip:hover {
  transform: scale(1.15);
  filter: brightness(1.2);
}
.edit-color-chip.active {
  border-color: #fff;
  transform: scale(1.2);
}
.color-chip--red { background: var(--rating-red); }
.color-chip--orange { background: var(--rating-orange); }
.color-chip--yellow { background: var(--rating-yellow); }
.color-chip--green { background: var(--rating-green); }

/* Active glows */
.color-chip--red.active { box-shadow: 0 0 10px var(--rating-red); }
.color-chip--orange.active { box-shadow: 0 0 10px var(--rating-orange); }
.color-chip--yellow.active { box-shadow: 0 0 10px var(--rating-yellow); }
.color-chip--green.active { box-shadow: 0 0 10px var(--rating-green); }

.edit-color-chip:hover:not(.active) {
  border-color: var(--border);
  color: var(--text-1);
}
.webcard-icon.spinning {
  display: inline-block;
  animation: spin 2s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.empty-hint {
  font-size: 0.8rem;
  color: var(--text-3);
  font-style: italic;
}

/* ── Setup Slots ── */
.setup-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.setup-slot {
  background: var(--bg-mute);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  min-width: 300px;
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setup-slot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.slot-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.slot-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}
.wrap-row { flex-wrap: wrap; }
.slot-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}
.slot-field.sm { min-width: 90px; max-width: 120px; }
.slot-field.grow { flex: 1 1 180px; }
.slot-field-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
/* dropdown multi-select */
.slot-dropdown-wrap { position: relative; }
.slot-dropdown-btn {
  width: 100%;
  padding: 5px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  color: var(--text-1);
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot-dropdown-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 200;
  background: var(--bg-modal);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 6px 4px;
  min-width: 160px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.slot-dd-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 0.82rem;
  cursor: pointer;
  border-radius: 4px;
}
.slot-dd-item:hover { background: var(--bg-hover); }
.slot-remove-btn {
  background: none;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px 4px;
  line-height: 1;
}
.slot-remove-btn:hover { color: var(--loss-text); }
.slot-add-btn {
  align-self: flex-start;
  padding: 8px 16px;
  background: none;
  border: 1px dashed var(--border-soft);
  border-radius: 8px;
  color: var(--text-2);
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s;
}
.slot-add-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Dashboard New Filters ── */
.filter-row-top {
  display: flex;
  gap: 24px;
  margin-bottom: 8px;
  align-items: flex-start;
}
.sm-select {
  padding: 6px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-mute);
  color: var(--text-1);
  font-size: 0.88rem;
  min-width: 140px;
}
.color-filter-row {
  display: flex;
  gap: 8px;
  padding: 4px 0;
}
.color-filter-chip {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg);
  padding: 0;
}
.color-filter-chip--red { background: var(--rating-red); opacity: 0.6; }
.color-filter-chip--orange { background: var(--rating-orange); opacity: 0.6; }
.color-filter-chip--yellow { background: var(--rating-yellow); opacity: 0.6; }
.color-filter-chip--green { background: var(--rating-green); opacity: 0.6; }

.color-filter-chip.active {
  border-color: var(--text-1);
  transform: scale(1.1);
  opacity: 1;
}
.color-filter-chip--red.active { background: var(--rating-red); }
.color-filter-chip--orange.active { background: var(--rating-orange); }
.color-filter-chip--yellow.active { background: var(--rating-yellow); }
.color-filter-chip--green.active { background: var(--rating-green); }

/* ── Toggle Group ── */
.toggle-group {
  display: flex;
  background: var(--bg-mute);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-soft);
}
.toggle-btn {
  background: transparent;
  border: none;
  color: var(--text-3);
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.toggle-btn.active {
  background: var(--bg-select);
  color: var(--text-1);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.toggle-btn:hover:not(.active) {
  color: var(--text-2);
}

.btn-charts-toggle {
  background: var(--bg-select-item);
  border: 1px solid var(--bg-select);
  color: var(--text-2);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: 8px;
}
.btn-charts-toggle:hover {
  background: var(--bg-select);
  color: var(--text-1);
}

/* ── Performance Charts ── */
.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 10px;
}
.charts-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.chart-box {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}
.chart-header {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.chart-icon {
  font-size: 1.1rem;
}
.chart-body {
  height: 320px;
  position: relative;
}
.chart-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chart-header {
  justify-content: space-between;
}
.chart-group-select {
  background: var(--bg-mute);
  border: 1px solid var(--border-soft);
  color: var(--text-2);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  outline: none;
  cursor: pointer;
}
.chart-group-select:hover {
  border-color: var(--border);
  color: var(--text-1);
}

/* ── Pagination ── */
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 4px 4px;
}
.pagination-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  color: var(--text-3);
}
.page-size-select {
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-2);
  padding: 3px 6px;
  font-size: 0.82rem;
  cursor: pointer;
  outline: none;
}
.pagination-count {
  color: var(--text-2);
}
.pagination-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.page-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s;
}
.page-btn:hover:not(:disabled) {
  background: var(--bg-select);
  border-color: var(--border);
  color: var(--text-1);
}
.page-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 700;
}
.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.page-ellipsis {
  color: var(--text-3);
  font-size: 0.82rem;
  padding: 0 2px;
}

/* ── Add Trade Button ─────────────────────────────────────────────────────── */
.btn-add-trade {
  padding: 6px 14px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn-add-trade:hover {
  opacity: 0.88;
}

/* ── Add Trade Modal ──────────────────────────────────────────────────────── */
.add-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.add-modal-box {
  background: var(--bg-modal);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  width: 70vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}
.add-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.add-modal-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}
.add-modal-close {
  background: none;
  border: none;
  font-size: 1rem;
  color: var(--text-2);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.add-modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.add-modal-body {
  overflow-y: auto;
  padding: 20px;
  flex: 1;
}
</style>
