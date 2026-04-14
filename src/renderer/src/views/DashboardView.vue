<script setup>
import { ref, computed, onMounted, onActivated, watch, nextTick, onUnmounted } from 'vue'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
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

// ── State ─────────────────────────────────────────────────────────────────────
const setups = ref([])
const strategies = ref([])
const symbolOptions = ref([])

const filters = ref({
  sessions: [],
  rrTypes: [],
  symbols: [],
  setupId: '',
  strategyId: '',
  customTagId: '',
  hasNews: null, // null = all, 1 = yes, 0 = no
  colorRatings: [],
  dateFrom: '',
  dateTo: ''
})

const symbolInput = ref('')
const results = ref([])
const summary = ref(null)
const isLoading = ref(false)
const loadError = ref('')
const nativeDateFromRef = ref(null)
const nativeDateToRef = ref(null)

const filterCustomTags = ref([])
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

// ── Account Settings ──────────────────────────────────────────────────────────
const initialBalance = ref(500)
const riskPercent = ref(6) // percent, e.g. 6 means 6%
const settingsLoaded = ref(false)
const customColumnName = ref('Custom Tag')
const dbPath = ref('')

const showCharts = ref(false) // toggle visibility
const returnType = ref('simple') // 'simple' or 'log'
const pnlGroupBy = ref('day') // day, symbol, session, rrType, rating, news
const equityChartCanvas = ref(null)
const drawdownChartCanvas = ref(null)
const pnlChartCanvas = ref(null)
let equityChart = null
let drawdownChart = null
let pnlChart = null

onUnmounted(() => {
  if (equityChart) equityChart.destroy()
  if (drawdownChart) drawdownChart.destroy()
  if (pnlChart) pnlChart.destroy()
})

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
function parseRR(rrType) {
  // Supports "1:2" or "Fixed 2R" or just "2"
  const m = rrType?.match(/(?:1:)?(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

// Returns { risk, reward, rrr } based on result and rrType
function calcRRR(result, rrType) {
  const rr = parseRR(rrType)
  if (result === 'Win') return { risk: 0, reward: rr, rrr: rr }
  if (result === 'Loss') return { risk: -1, reward: 0, rrr: -1 }
  return { risk: 0, reward: 0, rrr: 0 } // Breakeven
}

// ── Computed table rows with running balance/drawdown ─────────────────────────
const enrichedRows = computed(() => {
  const bal0 = initialBalance.value
  const riskPct = riskPercent.value / 100
  const riskAmt = bal0 * riskPct // Standard fixed risk amount
  let runningBalance = bal0
  let peakBalance = bal0
  let cumLogReturn = 0

  return results.value.map((row, i) => {
    const { risk, reward, rrr } = calcRRR(row.result, row.rrType)

    // 1. Simple PnL (Fixed $ risk)
    const simpleDollarPnl = +(rrr * riskAmt).toFixed(2)

    // 2. Log PnL (Compounding)
    // Risk per trade as fractional (e.g. 0.01 for 1%)
    // Reward multiplier is rrr
    const tradePctReturn = rrr * riskPct // e.g. 2RR * 0.01 = 0.02 (2%)
    const logTradeReturn = Math.log(1 + tradePctReturn)
    cumLogReturn += logTradeReturn

    // Determine values based on returnType
    let dollarPnl, currentBalance
    if (returnType.value === 'log') {
      currentBalance = +(bal0 * Math.exp(cumLogReturn)).toFixed(2)
      // The "dollar PnL" for this specific trade in log mode is the change in balance
      const prevBal = i === 0 ? bal0 : 0 // will be calculated below
      // Actually simpler:
      dollarPnl = +(currentBalance - runningBalance).toFixed(2)
    } else {
      dollarPnl = simpleDollarPnl
      currentBalance = +(runningBalance + dollarPnl).toFixed(2)
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

// ── Enhanced Summary ──────────────────────────────────────────────────────────
const enhancedSummary = computed(() => {
  if (!summary.value) return null
  const rows = enrichedRows.value
  const wins = rows.filter((r) => r.result === 'Win')
  const losses = rows.filter((r) => r.result === 'Loss')

  const totalDollarPnl = +rows.reduce((s, r) => s + r.dollarPnl, 0).toFixed(2)
  const grossProfit = +wins.reduce((s, r) => s + r.dollarPnl, 0).toFixed(2)
  const grossLoss = +losses.reduce((s, r) => s + Math.abs(r.dollarPnl), 0).toFixed(2)
  const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : '∞'
  const avgWin = wins.length ? +(grossProfit / wins.length).toFixed(2) : 0
  const avgLoss = losses.length ? +(grossLoss / losses.length).toFixed(2) : 0
  const avgRR = rows.length ? +(rows.reduce((s, r) => s + r.rrr, 0) / rows.length).toFixed(2) : 0

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

  return {
    ...summary.value,
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
onMounted(async () => {
  await loadSettings()
  const [s, sym, rr] = await Promise.all([
    window.api.getAllSetups(),
    window.api.getDistinctSymbols(),
    window.api.getAllRRTypes()
  ])
  setups.value = s
  symbolOptions.value = sym
  rrTypeOptions.value = rr.map((r) => r.name)
})
onActivated(runQuery)

// ── Strategy & Tag dropdown filtered by setup ────────────────────────────────
async function onSetupChange() {
  filters.value.strategyId = ''
  filters.value.customTagId = ''
  strategies.value = []
  filterCustomTags.value = []
  if (filters.value.setupId) {
    ;[strategies.value, filterCustomTags.value] = await Promise.all([
      window.api.getStrategiesForSetup(Number(filters.value.setupId)),
      window.api.getCustomTagsForSetup(Number(filters.value.setupId))
    ])
  }
}

// ── Symbol chips ──────────────────────────────────────────────────────────────
function addSymbol() {
  const s = symbolInput.value.trim().toUpperCase()
  if (s && !filters.value.symbols.includes(s)) filters.value.symbols.push(s)
  symbolInput.value = ''
}
function removeSymbol(s) {
  filters.value.symbols = filters.value.symbols.filter((x) => x !== s)
}
function toggleSymbolOption(sym) {
  const idx = filters.value.symbols.indexOf(sym)
  if (idx === -1) filters.value.symbols.push(sym)
  else filters.value.symbols.splice(idx, 1)
}

function toggleColorFilter(c) {
  const idx = filters.value.colorRatings.indexOf(c)
  if (idx === -1) filters.value.colorRatings.push(c)
  else filters.value.colorRatings.splice(idx, 1)
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

    const f = {
      sessions: [...filters.value.sessions],
      rrTypes: [...filters.value.rrTypes],
      symbols: [...filters.value.symbols],
      setupId: filters.value.setupId ? Number(filters.value.setupId) : null,
      strategyId: filters.value.strategyId ? Number(filters.value.strategyId) : null,
      customTagId: filters.value.customTagId ? Number(filters.value.customTagId) : null,
      hasNews: filters.value.hasNews,
      colorRatings: [...filters.value.colorRatings],
      dateFrom: isoFrom ? `${isoFrom}T00:00` : null,
      dateTo: isoTo ? `${isoTo}T23:59` : null
    }
    const [rows, stat] = await Promise.all([
      window.api.queryJournals(f),
      window.api.getJournalSummary(f)
    ])
    results.value = rows
    summary.value = stat
  } catch (e) {
    loadError.value = e.message ?? 'โหลดข้อมูลไม่สำเร็จ'
  } finally {
    isLoading.value = false
  }
}

watch(showCharts, (val) => {
  if (val && enrichedRows.value.length) {
    nextTick(() => {
      updateCharts(enrichedRows.value)
      updatePnlChart(enrichedRows.value)
    })
  }
})

watch(pnlGroupBy, () => {
  if (showCharts.value && enrichedRows.value.length) {
    updatePnlChart(enrichedRows.value)
  }
})

watch(enrichedRows, (newVal) => {
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
  const gradE = ctxE.createLinearGradient(0, 0, 0, 300)
  gradE.addColorStop(0, 'rgba(16, 185, 129, 0.25)')
  gradE.addColorStop(1, 'rgba(16, 185, 129, 0)')

  equityChart = new Chart(ctxE, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Equity',
          data: equityPoints,
          borderColor: '#10b981',
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          backgroundColor: gradE,
          pointRadius: 0,
          pointHoverRadius: 4,
          z: 10
        },
        {
          label: 'Trend',
          data: trendLine,
          borderColor: 'rgba(255, 255, 255, 0.2)',
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
        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#555', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#555', font: { size: 10 } } }
      }
    }
  })

  // 2. Drawdown Chart
  if (drawdownChart) drawdownChart.destroy()
  const ctxD = drawdownChartCanvas.value.getContext('2d')
  const gradD = ctxD.createLinearGradient(0, 0, 0, 150)
  gradD.addColorStop(0, 'rgba(239, 68, 68, 0.25)')
  gradD.addColorStop(1, 'rgba(239, 68, 68, 0)')

  drawdownChart = new Chart(ctxD, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Drawdown (%)',
          data: drawdownPoints,
          borderColor: '#ef4444',
          borderWidth: 2,
          tension: 0.35,
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
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: {
            color: '#666',
            font: { size: 10 },
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
      key = r.rrType || 'N/A'
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
  filters.value = {
    sessions: [],
    rrTypes: [],
    symbols: [],
    setupId: '',
    strategyId: '',
    customTagId: '',
    hasNews: null,
    colorRatings: [],
    dateFrom: '',
    dateTo: ''
  }
  strategies.value = []
  symbolInput.value = ''
  runQuery()
}

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
    rrType: row.rrType ?? 'RR 1:2',
    slPoint: row.slPoint != null ? String(row.slPoint) : '',
    tpPoint: row.tpPoint != null ? String(row.tpPoint) : '',
    result: row.result ?? 'Win',
    notes: row.notes ?? '',
    hasNews: row.hasNews ? true : false,
    colorRating: row.colorRating ?? ''
  }
  editImageUrlInputs.value = row.imageUrls?.length ? [...row.imageUrls] : ['']
  editSelectedStrategyIds.value = []
  editSelectedCustomTagIds.value = []
  editStrategies.value = []
  editAllCustomTags.value = []

  const [strats, tags] = await Promise.all([
    row.setupId ? window.api.getStrategiesForSetup(Number(row.setupId)) : Promise.resolve([]),
    row.setupId ? window.api.getCustomTagsForSetup(Number(row.setupId)) : Promise.resolve([])
  ])
  editStrategies.value = strats
  editAllCustomTags.value = tags

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
  if (editForm.value.setupId) {
    ;[editStrategies.value, editAllCustomTags.value] = await Promise.all([
      window.api.getStrategiesForSetup(Number(editForm.value.setupId)),
      window.api.getCustomTagsForSetup(Number(editForm.value.setupId))
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
      rrType: editForm.value.rrType,
      slPoint: editForm.value.slPoint !== '' ? parseFloat(editForm.value.slPoint) : null,
      tpPoint: editForm.value.tpPoint !== '' ? parseFloat(editForm.value.tpPoint) : null,
      result: editForm.value.result,
      notes: editForm.value.notes || null,
      setupId: Number(editForm.value.setupId),
      hasNews: editForm.value.hasNews ? 1 : 0,
      colorRating: editForm.value.colorRating || null,
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

function openGallery(imageUrls) {
  if (!imageUrls?.length) return
  galleryImages.value = imageUrls
  galleryIndex.value = 0
  isFullView.value = false
  showGallery.value = true
  // Pre-fetch all images
  for (const url of imageUrls) fetchGalleryImage(url)
}
function closeGallery() {
  showGallery.value = false
  isFullView.value = false
}
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
      <div class="filter-group">
        <div class="filter-label">Session</div>
        <div class="checkbox-row">
          <label v-for="s in ALL_SESSIONS" :key="s" class="check-label">
            <input v-model="filters.sessions" type="checkbox" :value="s" />{{ s }}
          </label>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-label">RR Type</div>
        <div class="checkbox-row">
          <label v-for="r in rrTypeOptions" :key="r" class="check-label">
            <input v-model="filters.rrTypes" type="checkbox" :value="r" />{{ r }}
          </label>
          <span v-if="!rrTypeOptions.length" class="empty-hint">No RR Types defined</span>
        </div>
      </div>

      <div class="filter-row-top">
        <div class="filter-group">
          <div class="filter-label">News</div>
          <select v-model="filters.hasNews" class="sm-select">
            <option :value="null">All</option>
            <option :value="1">With News (✓)</option>
            <option :value="0">No News (—)</option>
          </select>
        </div>

        <div class="filter-group">
          <div class="filter-label">Rating</div>
          <div class="color-filter-row">
            <button
              v-for="c in COLOR_OPTIONS"
              :key="c"
              class="color-filter-chip"
              :class="[`color-filter-chip--${c}`, { active: filters.colorRatings.includes(c) }]"
              @click="toggleColorFilter(c)"
            ></button>
          </div>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-label">Symbol</div>
        <div class="symbol-row">
          <button
            v-for="sym in symbolOptions"
            :key="sym"
            class="sym-chip"
            :class="{ active: filters.symbols.includes(sym) }"
            type="button"
            @click="toggleSymbolOption(sym)"
          >
            {{ sym }}
          </button>
          <form class="sym-input-row" @submit.prevent="addSymbol">
            <input v-model="symbolInput" placeholder="Type symbol…" />
            <button type="submit">+</button>
          </form>
        </div>
        <div v-if="filters.symbols.length" class="active-chips">
          <span v-for="s in filters.symbols" :key="s" class="active-chip">
            {{ s }} <button @click="removeSymbol(s)">×</button>
          </span>
        </div>
      </div>

      <div class="filter-row">
        <div class="filter-group sm">
          <div class="filter-label">Trade Setup</div>
          <select v-model="filters.setupId" @change="onSetupChange">
            <option value="">All Setups</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="filter-group sm">
          <div class="filter-label">Strategy</div>
          <select v-model="filters.strategyId" :disabled="!filters.setupId">
            <option value="">All Strategies</option>
            <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="filter-group sm">
          <div class="filter-label">{{ customColumnName }}</div>
          <select v-model="filters.customTagId" :disabled="!filters.setupId">
            <option value="">All {{ customColumnName }}s</option>
            <option v-for="t in filterCustomTags" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
        <div class="filter-group sm">
          <div class="filter-label">Date From</div>
          <div class="date-input-wrap">
            <input
              :value="filters.dateFrom"
              type="text"
              placeholder="dd/mm/yyyy"
              maxlength="10"
              @input="onFilterDateInput('dateFrom', $event)"
            />
            <button
              type="button"
              class="date-picker-btn"
              @click="pickFilterDate('dateFrom', nativeDateFromRef)"
            >
              📅
            </button>
            <input
              ref="nativeDateFromRef"
              class="native-date-picker"
              type="date"
              tabindex="-1"
              aria-hidden="true"
              @change="onNativeFilterDateChange('dateFrom', $event.target.value)"
            />
          </div>
        </div>
        <div class="filter-group sm">
          <div class="filter-label">Date To</div>
          <div class="date-input-wrap">
            <input
              :value="filters.dateTo"
              type="text"
              placeholder="dd/mm/yyyy"
              maxlength="10"
              @input="onFilterDateInput('dateTo', $event)"
            />
            <button
              type="button"
              class="date-picker-btn"
              @click="pickFilterDate('dateTo', nativeDateToRef)"
            >
              📅
            </button>
            <input
              ref="nativeDateToRef"
              class="native-date-picker"
              type="date"
              tabindex="-1"
              aria-hidden="true"
              @change="onNativeFilterDateChange('dateTo', $event.target.value)"
            />
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
      <div class="stat">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value">{{ winRateDisplay }}</div>
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
      <table v-if="enrichedRows.length">
        <thead>
          <tr>
            <th>No.</th>
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in enrichedRows"
            :key="row.id"
            :class="row.result === 'Win' ? 'row-win' : row.result === 'Loss' ? 'row-loss' : ''"
          >
            <td class="num">{{ row.no }}</td>
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
              <select v-model="editForm.rrType">
                <option v-for="r in ALL_RR_TYPES" :key="r" :value="r">{{ r }}</option>
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
                  v-for="c in [
                    ['red', 'แดง'],
                    ['orange', 'ส้ม'],
                    ['yellow', 'เหลือง'],
                    ['green', 'เขียว']
                  ]"
                  :key="c[0]"
                  type="button"
                  class="edit-color-chip"
                  :class="[`color-chip--${c[0]}`, { active: editForm.colorRating === c[0] }]"
                  @click="editForm.colorRating = editForm.colorRating === c[0] ? '' : c[0]"
                >
                  {{ c[1] }}
                </button>
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
</template>

<style scoped>
.view-container {
  padding: 24px;
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
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 0.84rem;
}
.db-label {
  font-weight: 700;
  color: #666;
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.db-path {
  flex: 1;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 0.78rem;
  min-width: 0;
}
.btn-sm {
  padding: 4px 12px;
  background: #252525;
  color: #aaa;
  border: 1px solid #333;
  border-radius: 5px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.btn-sm:hover {
  background: #333;
  color: #e0e0e0;
}
.btn-danger {
  border-color: #5a1a1a;
  color: #f87171;
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
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
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
  color: #777;
  letter-spacing: 0.05em;
}
.setting-item input {
  width: 120px;
  padding: 6px 10px;
  background: #252525;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.9rem;
}
.setting-derived {
  font-size: 0.88rem;
  color: #aaa;
  padding-bottom: 6px;
}
.setting-derived strong {
  color: #4f9cf9;
}

/* Filter panel */
.filter-panel {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.filter-group.sm {
  min-width: 160px;
  flex: 1;
}
.filter-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #777;
}
.filter-row {
  display: flex;
  gap: 16px;
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
  color: #ccc;
}

.symbol-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sym-chip {
  padding: 4px 10px;
  border: 1px solid #333;
  border-radius: 14px;
  background: #252525;
  color: #bbb;
  font-size: 0.82rem;
  cursor: pointer;
}
.sym-chip.active {
  background: #4f9cf9;
  color: #fff;
  border-color: #4f9cf9;
}
.sym-input-row {
  display: flex;
  gap: 4px;
}
.sym-input-row input {
  width: 100px;
  padding: 4px 8px;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 0.85rem;
}
.sym-input-row button {
  padding: 4px 10px;
  background: #333;
  border: none;
  border-radius: 6px;
  color: #e0e0e0;
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
  background: #2a3f5f;
  color: #7fb3f5;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 0.82rem;
}
.active-chip button {
  background: none;
  border: none;
  color: #7fb3f5;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
}

select,
input[type='text'] {
  padding: 7px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  color: #e0e0e0;
  font-size: 0.88rem;
}
.date-input-wrap {
  position: relative;
}
.date-input-wrap > input[type='text'] {
  width: 100%;
  padding-right: 38px;
}
.date-picker-btn {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  padding: 3px 7px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #252525;
  color: #ccc;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
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
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.btn-primary {
  padding: 8px 20px;
  background: #4f9cf9;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.btn-secondary {
  padding: 8px 16px;
  background: #333;
  color: #ccc;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
}
.result-count {
  font-size: 0.85rem;
  color: #777;
  margin-left: 8px;
}

/* Stats grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}
.stat {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px 14px;
  text-align: center;
}
.stat.win {
  border-color: #166534;
  background: #052e16;
}
.stat.loss {
  border-color: #7f1d1d;
  background: #2d0a0a;
}
.stat-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  color: #777;
  letter-spacing: 0.05em;
}
.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  margin-top: 4px;
}
.stat.win .stat-value {
  color: #4ade80;
}
.stat.loss .stat-value {
  color: #f87171;
}

/* Table */
.table-wrapper {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
th {
  text-align: left;
  padding: 8px 10px;
  background: #1a1a1a;
  color: #888;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #2a2a2a;
  white-space: nowrap;
}
td {
  padding: 7px 10px;
  border-bottom: 1px solid #1f1f1f;
  color: #ccc;
  white-space: nowrap;
}
tr:hover td {
  background: #1e1e1e;
}
tr.row-win td {
  background: #040e09;
}
tr.row-loss td {
  background: #0e0404;
}

.sym {
  font-weight: 700;
  color: #e0e0e0;
}
.num {
  color: #555;
}
.bull {
  color: #4ade80;
  font-weight: 600;
}
.bear {
  color: #f87171;
  font-weight: 600;
}
.pos {
  color: #4ade80;
}
.neg {
  color: #f87171;
}

.result-cell.win {
  color: #4ade80;
  font-weight: 600;
}
.result-cell.loss {
  color: #f87171;
  font-weight: 600;
}
.result-cell.breakeven {
  color: #facc15;
  font-weight: 600;
}

.btn-delete {
  background: none;
  border: 1px solid #444;
  border-radius: 4px;
  color: #666;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 0.8rem;
}
.btn-delete:hover {
  color: #f87171;
  border-color: #f87171;
}
.empty-msg {
  text-align: center;
  color: #555;
  padding: 40px;
}
.err-banner {
  background: #2d0a0a;
  border: 1px solid #7f1d1d;
  border-radius: 8px;
  color: #f87171;
  padding: 10px 16px;
  margin-bottom: 16px;
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
  border: 1px solid #384f6e;
  border-radius: 4px;
  color: #4f9cf9;
  cursor: pointer;
  padding: 2px 7px;
  font-size: 0.8rem;
  line-height: 1.4;
}
.btn-edit:hover {
  border-color: #4f9cf9;
  background: #0f2a4a;
}
.btn-img {
  background: none;
  border: 1px solid #3d2e5e;
  border-radius: 4px;
  color: #a78bfa;
  cursor: pointer;
  padding: 2px 7px;
  font-size: 0.8rem;
  line-height: 1.4;
}
.btn-img:hover {
  border-color: #a78bfa;
  background: #1e1040;
}

/* ── Modal Backdrop & Panel ──────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
  backdrop-filter: blur(3px);
}
.modal-panel {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 14px;
  width: 100%;
  max-width: 820px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.modal-header h3 {
  font-size: 1rem;
  font-weight: 700;
  color: #e0e0e0;
  margin: 0;
}
.modal-close {
  background: none;
  border: none;
  color: #555;
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
  color: #f87171;
  background: #2d0a0a;
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
  border-top: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.btn-save {
  padding: 8px 24px;
  background: #4f9cf9;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-save:hover:not(:disabled) {
  background: #3b82f6;
}
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-cancel {
  padding: 8px 20px;
  background: #252525;
  color: #aaa;
  border: 1px solid #383838;
  border-radius: 7px;
  font-size: 0.9rem;
  cursor: pointer;
}
.btn-cancel:hover {
  background: #333;
  color: #e0e0e0;
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
  color: #666;
}
.edit-auto-tag {
  font-weight: 400;
  text-transform: none;
  color: #4f9cf9;
  margin-left: 4px;
}
.edit-group input[type='text'],
.edit-group input[type='number'],
.edit-group input[type='url'],
.edit-group select,
.edit-group textarea {
  padding: 7px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  color: #e0e0e0;
  font-size: 0.88rem;
  transition: border-color 0.2s;
}
.edit-group input:focus,
.edit-group select:focus,
.edit-group textarea:focus {
  outline: none;
  border-color: #4f9cf9;
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
  border: 1px solid #3a3a3a;
  border-radius: 20px;
  background: #1e1e1e;
  color: #999;
  cursor: pointer;
  font-size: 0.83rem;
  transition: all 0.15s;
}
.edit-chip.active {
  background: #052e16;
  border-color: #4ade80;
  color: #4ade80;
}
.edit-chip.chip--blue.active {
  background: #0f2a4a;
  border-color: #4f9cf9;
  color: #4f9cf9;
}
.edit-chip:hover:not(.active) {
  border-color: #555;
  color: #ccc;
}
.chip-empty {
  font-size: 0.82rem;
  color: #444;
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
  border: 1px solid #333;
  border-radius: 6px;
  background: #252525;
  color: #bbb;
  cursor: pointer;
  font-size: 0.82rem;
  padding: 5px 11px;
  white-space: nowrap;
}
.btn-url-add {
  align-self: flex-start;
}
.edit-error {
  color: #f87171;
  font-size: 0.87rem;
  background: #2d0a0a;
  border: 1px solid #7f1d1d;
  border-radius: 6px;
  padding: 8px 12px;
}

/* ── Image Gallery ───────────────────────────────────────────────────────────── */
.gallery-panel {
  background: #0e0e0e;
  border: 1px solid #252525;
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
  border-bottom: 1px solid #1e1e1e;
  color: #777;
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
  border: 1px solid #252525;
}
.gallery-nav {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid #333;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 1.6rem;
  color: #bbb;
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
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.gallery-footer {
  padding: 10px 20px;
  border-top: 1px solid #1e1e1e;
  text-align: center;
  flex-shrink: 0;
}
.gallery-link {
  color: #4f9cf9;
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
  background: #252525;
  border: 1px solid #333;
  color: #bbb;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-fullscreen-toggle:hover {
  background: #333;
  color: #fff;
  border-color: #555;
}

/* ── Gallery Web-Card (non-image URLs) ────────────────────────────────────── */
.gallery-webcard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px 32px;
  background: #111;
  border: 1px solid #2a2a2a;
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
  color: #4f9cf9;
  word-break: break-all;
  max-width: 100%;
  background: #0a1a2e;
  border: 1px solid #1a3a5c;
  border-radius: 6px;
  padding: 8px 12px;
  font-family: monospace;
}
.webcard-note {
  font-size: 0.84rem;
  color: #666;
  margin: 0;
}
.webcard-btn {
  padding: 10px 28px;
  background: #4f9cf9;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.webcard-btn:hover {
  background: #3b82f6;
}

/* News + Color Rating */
.news-cell {
  color: #4ade80;
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
  background: #ef4444;
}
.rating-dot--orange {
  background: #f97316;
}
.rating-dot--yellow {
  background: #eab308;
}
.rating-dot--green {
  background: #22c55e;
}

/* Edit modal — news checkbox */
.edit-checkbox-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  cursor: pointer;
  font-size: 0.88rem;
  color: #e0e0e0;
  user-select: none;
}
.edit-checkbox-field input[type='checkbox'] {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: #4f9cf9;
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
  padding: 5px 13px;
  border-radius: 20px;
  border: 1px solid #3a3a3a;
  background: #1e1e1e;
  color: #999;
  cursor: pointer;
  font-size: 0.83rem;
  transition: all 0.15s;
}
.color-chip--red.active {
  background: #450a0a;
  border-color: #ef4444;
  color: #ef4444;
}
.color-chip--orange.active {
  background: #431407;
  border-color: #f97316;
  color: #f97316;
}
.color-chip--yellow.active {
  background: #422006;
  border-color: #eab308;
  color: #eab308;
}
.color-chip--green.active {
  background: #052e16;
  border-color: #22c55e;
  color: #22c55e;
}
.edit-color-chip:hover:not(.active) {
  border-color: #555;
  color: #ccc;
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
  color: #555;
  font-style: italic;
}

/* ── Dashboard New Filters ── */
.filter-row-top {
  display: flex;
  gap: 24px;
  margin-bottom: 8px;
  align-items: flex-start;
}
.sm-select {
  padding: 6px 12px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  color: #e0e0e0;
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
  background: #111;
  padding: 0;
}
.color-filter-chip--red { background: #7f1d1d; border-color: #450a0a; }
.color-filter-chip--orange { background: #7c2d12; border-color: #431407; }
.color-filter-chip--yellow { background: #713f12; border-color: #422006; }
.color-filter-chip--green { background: #064e3b; border-color: #052e16; }

.color-filter-chip.active {
  border-color: #fff;
  transform: scale(1.1);
}
.color-filter-chip--red.active { background: #ef4444; }
.color-filter-chip--orange.active { background: #f97316; }
.color-filter-chip--yellow.active { background: #eab308; }
.color-filter-chip--green.active { background: #22c55e; }

/* ── Toggle Group ── */
.toggle-group {
  display: flex;
  background: #1a1a1f;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid #333;
}
.toggle-btn {
  background: transparent;
  border: none;
  color: #777;
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.toggle-btn.active {
  background: #2d2d35;
  color: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.toggle-btn:hover:not(.active) {
  color: #aaa;
}

.btn-charts-toggle {
  background: #1e1e24;
  border: 1px solid #2d2d35;
  color: #aaa;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: 8px;
}
.btn-charts-toggle:hover {
  background: #2d2d35;
  color: #fff;
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
  background: #0f0f12;
  border: 1px solid #1e1e24;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
.chart-header {
  font-size: 0.95rem;
  font-weight: 600;
  color: #e0e0e0;
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
  background: #1a1a1f;
  border: 1px solid #333;
  color: #ccc;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  outline: none;
  cursor: pointer;
}
.chart-group-select:hover {
  border-color: #555;
  color: #fff;
}

</style>
