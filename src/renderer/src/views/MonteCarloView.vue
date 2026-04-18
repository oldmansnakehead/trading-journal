<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import {
  Chart, LineController, LineElement, PointElement,
  BarController, BarElement, LinearScale, CategoryScale,
  Tooltip, Filler
} from 'chart.js'

Chart.register(
  LineController, LineElement, PointElement,
  BarController, BarElement, LinearScale, CategoryScale,
  Tooltip, Filler
)

// ── Settings ──────────────────────────────────────────────────────────────────
const initialBalance = ref(500)
const riskPercent = ref(6)

// ── Simulation Config ─────────────────────────────────────────────────────────
const numSimulations = ref(1000)
const tradesPerSim = ref(0)        // 0 = use historical count
const dateFrom = ref('')
const dateTo = ref('')
const excludeBreakeven = ref(false)

// ── State ─────────────────────────────────────────────────────────────────────
const isRunning = ref(false)
const hasResults = ref(false)
const errorMsg = ref('')
const stats = ref(null)

// ── Charts ────────────────────────────────────────────────────────────────────
const equityCanvas = ref(null)
const histCanvas = ref(null)
let equityChart = null
let histChart = null

onMounted(async () => {
  try {
    const s = await window.api.getAllSettings()
    if (s.initialBalance) initialBalance.value = parseFloat(s.initialBalance)
    if (s.riskPercent) riskPercent.value = parseFloat(s.riskPercent)
  } catch (_) {}
})

onUnmounted(() => {
  if (equityChart) { equityChart.destroy(); equityChart = null }
  if (histChart)   { histChart.destroy();   histChart = null }
})

// ── RR Helpers ────────────────────────────────────────────────────────────────
function parseRRLegacy(str) {
  const m = str?.match(/(?:1:)?(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}
function calcRRR(result, rrTypeRatio, legacyStr, manualRR) {
  const rr = (manualRR != null && manualRR > 0)
    ? parseFloat(manualRR)
    : (rrTypeRatio != null ? parseFloat(rrTypeRatio) : parseRRLegacy(legacyStr))
  if (result === 'Win')  return rr
  if (result === 'Loss') return -1
  return 0  // Breakeven
}

// ── Run Simulation ────────────────────────────────────────────────────────────
async function runSimulation() {
  errorMsg.value = ''
  isRunning.value = true
  hasResults.value = false

  try {
    const filters = {}
    if (dateFrom.value) filters.dateFrom = dateFrom.value
    if (dateTo.value)   filters.dateTo   = dateTo.value + 'T23:59:59'

    const trades = await window.api.queryJournals(filters)

    let pool = trades
      .filter(t => !excludeBreakeven.value || t.result !== 'Breakeven')
      .filter(t => t.result === 'Win' || t.result === 'Loss' || (!excludeBreakeven.value && t.result === 'Breakeven'))
      .map(t => calcRRR(t.result, t.rrTypeRatio, t.rrType, t.manualRR))

    if (pool.length < 2) {
      errorMsg.value = 'ต้องการ trade อย่างน้อย 2 รายการในช่วงที่เลือก'
      isRunning.value = false
      return
    }

    const n     = tradesPerSim.value > 0 ? tradesPerSim.value : pool.length
    const bal0  = initialBalance.value
    const rPct  = riskPercent.value / 100
    const ruinThreshold = bal0 * 0.5
    const NUM_SAMPLE = Math.min(200, numSimulations.value)

    const finalBalances = []
    const maxDrawdowns  = []
    const samplePaths   = []

    for (let sim = 0; sim < numSimulations.value; sim++) {
      let balance = bal0
      let peak    = bal0
      let maxDD   = 0
      let consecLosses = 0
      const savePath = sim < NUM_SAMPLE
      const path = savePath ? [bal0] : null

      for (let t = 0; t < n; t++) {
        const rrr = pool[Math.floor(Math.random() * pool.length)]
        const appliedRisk = consecLosses >= 3 ? 0.005 : rPct
        balance += rrr * (bal0 * appliedRisk)

        if (rrr < 0) consecLosses++
        else if (rrr > 0) consecLosses = 0

        if (balance > peak) peak = balance
        const dd = (balance / peak - 1) * 100
        if (dd < maxDD) maxDD = dd

        if (savePath) path.push(balance)
      }

      finalBalances.push(balance)
      maxDrawdowns.push(maxDD)
      if (savePath) samplePaths.push(path)
    }

    // Median equity path (column-wise median over sample paths)
    const medianPath = [bal0]
    for (let t = 1; t <= n; t++) {
      const col = samplePaths.map(p => p[t]).sort((a, b) => a - b)
      medianPath.push(col[Math.floor(col.length / 2)])
    }

    // Statistics
    const sorted   = [...finalBalances].sort((a, b) => a - b)
    const ddSorted = [...maxDrawdowns].sort((a, b) => a - b)
    const pct = (arr, p) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * p / 100)))]

    const profitable = finalBalances.filter(b => b > bal0).length
    const ruined     = finalBalances.filter(b => b <= ruinThreshold).length

    stats.value = {
      tradeCount:  pool.length,
      tradesPerSim: n,
      simCount:    numSimulations.value,
      median:      pct(sorted, 50),
      p5:          pct(sorted, 5),
      p25:         pct(sorted, 25),
      p75:         pct(sorted, 75),
      p95:         pct(sorted, 95),
      probProfit:  +((profitable / numSimulations.value) * 100).toFixed(1),
      probRuin:    +((ruined    / numSimulations.value) * 100).toFixed(1),
      medianDD:    +Math.abs(pct(ddSorted, 50)).toFixed(2),
      worstDD:     +Math.abs(pct(ddSorted, 95)).toFixed(2),
    }

    hasResults.value = true
    isRunning.value  = false

    await nextTick()
    drawEquityChart(samplePaths, medianPath, n)
    drawHistChart(sorted, bal0)
  } catch (e) {
    errorMsg.value = e.message || 'เกิดข้อผิดพลาด'
    isRunning.value = false
  }
}

// ── Equity Spaghetti Chart ────────────────────────────────────────────────────
function drawEquityChart(paths, medianPath, n) {
  if (equityChart) { equityChart.destroy(); equityChart = null }
  const ctx = equityCanvas.value?.getContext('2d')
  if (!ctx) return

  const labels = Array.from({ length: n + 1 }, (_, i) => i)

  const datasets = paths.map(path => ({
    data: path,
    borderColor: 'rgba(99,179,237,0.10)',
    borderWidth: 1,
    pointRadius: 0,
    tension: 0,
    fill: false,
    parsing: false
  }))

  // P95 + P5 band — not computed per-step here, just overlay median
  datasets.push({
    label: 'Median',
    data: medianPath,
    borderColor: '#f6c90e',
    borderWidth: 2.5,
    pointRadius: 0,
    tension: 0.2,
    fill: false
  })

  equityChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, color: 'var(--text-3)', font: { size: 11 } },
          grid: { color: 'rgba(128,128,128,0.08)' },
          title: { display: true, text: 'Trade #', color: 'var(--text-3)', font: { size: 11 } }
        },
        y: {
          ticks: {
            callback: v => '$' + Number(v).toFixed(0),
            color: 'var(--text-3)',
            font: { size: 11 }
          },
          grid: { color: 'rgba(128,128,128,0.08)' }
        }
      }
    }
  })
}

// ── Final Balance Histogram ───────────────────────────────────────────────────
function drawHistChart(sorted, bal0) {
  if (histChart) { histChart.destroy(); histChart = null }
  const ctx = histCanvas.value?.getContext('2d')
  if (!ctx) return

  const NUM_BINS = 30
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const binSize = (max - min) / NUM_BINS || 1

  const bins = Array(NUM_BINS).fill(0)
  sorted.forEach(v => {
    const i = Math.min(Math.floor((v - min) / binSize), NUM_BINS - 1)
    bins[i]++
  })

  const labels = Array.from({ length: NUM_BINS }, (_, i) =>
    '$' + (min + (i + 0.5) * binSize).toFixed(0)
  )
  const colors = Array.from({ length: NUM_BINS }, (_, i) => {
    const mid = min + (i + 0.5) * binSize
    return mid >= bal0 ? 'rgba(72,199,142,0.75)' : 'rgba(246,114,128,0.75)'
  })

  histChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: bins,
        backgroundColor: colors,
        borderWidth: 0,
        barPercentage: 1.0,
        categoryPercentage: 1.0
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: c => `${c.raw} simulations` }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, color: 'var(--text-3)', font: { size: 11 } },
          grid: { display: false }
        },
        y: {
          ticks: { color: 'var(--text-3)', font: { size: 11 } },
          grid: { color: 'rgba(128,128,128,0.08)' },
          title: { display: true, text: 'Simulations', color: 'var(--text-3)', font: { size: 11 } }
        }
      }
    }
  })
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt  = v => '$' + Number(v).toFixed(2)
const fmtK = v => {
  const n = Number(v)
  return Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + n.toFixed(2)
}
</script>

<template>
  <div class="mc-view">
    <div class="mc-header">
      <h1 class="mc-title">Monte Carlo Simulation</h1>
      <p class="mc-subtitle">จำลองเส้นทาง equity curve จาก trade history เพื่อประเมินความเสี่ยงของพอร์ต</p>
    </div>

    <!-- Config Panel -->
    <div class="config-card">
      <div class="config-grid">
        <!-- Date Range -->
        <div class="config-group">
          <label class="config-label">วันที่เริ่มต้น</label>
          <input type="date" class="config-input" v-model="dateFrom" />
        </div>
        <div class="config-group">
          <label class="config-label">วันที่สิ้นสุด</label>
          <input type="date" class="config-input" v-model="dateTo" />
        </div>

        <!-- Balance & Risk -->
        <div class="config-group">
          <label class="config-label">Initial Balance ($)</label>
          <input type="number" class="config-input" v-model.number="initialBalance" min="1" step="100" />
        </div>
        <div class="config-group">
          <label class="config-label">Risk per Trade (%)</label>
          <input type="number" class="config-input" v-model.number="riskPercent" min="0.1" max="100" step="0.1" />
        </div>

        <!-- Sim Settings -->
        <div class="config-group">
          <label class="config-label">จำนวน Simulations</label>
          <select class="config-input" v-model.number="numSimulations">
            <option :value="500">500</option>
            <option :value="1000">1,000</option>
            <option :value="2000">2,000</option>
            <option :value="5000">5,000</option>
            <option :value="10000">10,000</option>
          </select>
        </div>
        <div class="config-group">
          <label class="config-label">Trades / Simulation</label>
          <input
            type="number" class="config-input"
            v-model.number="tradesPerSim" min="0" step="10"
            placeholder="0 = ใช้จำนวน trade ทั้งหมด"
          />
          <span class="config-hint">0 = ใช้จำนวน trade จริง</span>
        </div>
      </div>

      <div class="config-footer">
        <label class="checkbox-row">
          <input type="checkbox" v-model="excludeBreakeven" />
          <span>ไม่รวม Breakeven</span>
        </label>
        <button class="run-btn" :disabled="isRunning" @click="runSimulation">
          <span v-if="isRunning" class="spinner"></span>
          <span>{{ isRunning ? 'กำลังคำนวณ...' : 'Run Simulation' }}</span>
        </button>
      </div>

      <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
    </div>

    <!-- Results -->
    <template v-if="hasResults && stats">
      <!-- Meta info -->
      <div class="meta-bar">
        <span>ใช้ <strong>{{ stats.tradeCount }}</strong> trades จริง</span>
        <span>·</span>
        <span><strong>{{ stats.tradesPerSim }}</strong> trades/sim</span>
        <span>·</span>
        <span><strong>{{ stats.simCount.toLocaleString() }}</strong> simulations</span>
      </div>

      <!-- Stats Grid -->
      <div class="stats-grid">
        <!-- Final Balance Percentiles -->
        <div class="stat-card accent-blue">
          <div class="stat-label">Final Balance P5</div>
          <div class="stat-value red">{{ fmtK(stats.p5) }}</div>
          <div class="stat-sub">Worst 5%</div>
        </div>
        <div class="stat-card accent-blue">
          <div class="stat-label">Final Balance P25</div>
          <div class="stat-value">{{ fmtK(stats.p25) }}</div>
          <div class="stat-sub">25th Percentile</div>
        </div>
        <div class="stat-card highlight">
          <div class="stat-label">Median Final Balance</div>
          <div class="stat-value gold">{{ fmtK(stats.median) }}</div>
          <div class="stat-sub">50th Percentile</div>
        </div>
        <div class="stat-card accent-blue">
          <div class="stat-label">Final Balance P75</div>
          <div class="stat-value">{{ fmtK(stats.p75) }}</div>
          <div class="stat-sub">75th Percentile</div>
        </div>
        <div class="stat-card accent-blue">
          <div class="stat-label">Final Balance P95</div>
          <div class="stat-value green">{{ fmtK(stats.p95) }}</div>
          <div class="stat-sub">Best 5%</div>
        </div>

        <!-- Probability Stats -->
        <div class="stat-card" :class="stats.probProfit >= 50 ? 'accent-green' : 'accent-red'">
          <div class="stat-label">โอกาสกำไร</div>
          <div class="stat-value" :class="stats.probProfit >= 50 ? 'green' : 'red'">
            {{ stats.probProfit }}%
          </div>
          <div class="stat-sub">Final &gt; Initial</div>
        </div>
        <div class="stat-card" :class="stats.probRuin <= 5 ? 'accent-green' : 'accent-red'">
          <div class="stat-label">โอกาส Ruin (&lt;50%)</div>
          <div class="stat-value" :class="stats.probRuin <= 5 ? 'green' : 'red'">
            {{ stats.probRuin }}%
          </div>
          <div class="stat-sub">Balance ≤ 50% initial</div>
        </div>

        <!-- Drawdown Stats -->
        <div class="stat-card">
          <div class="stat-label">Median Max Drawdown</div>
          <div class="stat-value red">-{{ stats.medianDD }}%</div>
          <div class="stat-sub">Typical scenario</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Worst Drawdown P95</div>
          <div class="stat-value red">-{{ stats.worstDD }}%</div>
          <div class="stat-sub">Worst 5% scenario</div>
        </div>
      </div>

      <!-- Charts -->
      <div class="charts-row">
        <div class="chart-card">
          <div class="chart-title">
            Equity Curves
            <span class="chart-legend">
              <span class="legend-line blue-line"></span> simulations
              <span class="legend-line gold-line"></span> median
            </span>
          </div>
          <div class="chart-wrap">
            <canvas ref="equityCanvas"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-title">
            Final Balance Distribution
            <span class="chart-legend">
              <span class="legend-box green-box"></span> profit
              <span class="legend-box red-box"></span> loss
            </span>
          </div>
          <div class="chart-wrap">
            <canvas ref="histCanvas"></canvas>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mc-view {
  padding: 28px 32px;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Header */
.mc-header { display: flex; flex-direction: column; gap: 4px; }
.mc-title  { font-size: 1.4rem; font-weight: 800; color: var(--text-1); margin: 0; }
.mc-subtitle { font-size: 0.82rem; color: var(--text-3); margin: 0; }

/* Config Card */
.config-card {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.config-group { display: flex; flex-direction: column; gap: 5px; }
.config-label { font-size: 0.75rem; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.config-input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-1);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s;
}
.config-input:focus { border-color: var(--accent); }
.config-hint { font-size: 0.72rem; color: var(--text-3); }

.config-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.83rem;
  color: var(--text-2);
  cursor: pointer;
}
.checkbox-row input { cursor: pointer; }

.run-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.15s;
}
.run-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
.run-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-msg { color: #f67280; font-size: 0.82rem; margin: 0; }

/* Meta bar */
.meta-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.82rem;
  color: var(--text-3);
  padding: 0 4px;
}
.meta-bar strong { color: var(--text-1); }

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.stat-card {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-card.highlight {
  border-color: rgba(246,201,14,0.35);
  background: rgba(246,201,14,0.06);
}
.stat-card.accent-green { border-color: rgba(72,199,142,0.3); }
.stat-card.accent-red   { border-color: rgba(246,114,128,0.3); }
.stat-card.accent-blue  { border-color: rgba(99,179,237,0.2); }

.stat-label { font-size: 0.72rem; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font-size: 1.35rem; font-weight: 800; color: var(--text-1); line-height: 1.2; }
.stat-value.green { color: #48c78e; }
.stat-value.red   { color: #f67280; }
.stat-value.gold  { color: #f6c90e; }
.stat-sub   { font-size: 0.72rem; color: var(--text-3); }

/* Charts */
.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 900px) {
  .charts-row { grid-template-columns: 1fr; }
}
.chart-card {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chart-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 12px;
}
.chart-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-3);
  font-size: 0.75rem;
}
.legend-line {
  display: inline-block;
  width: 20px;
  height: 2px;
  border-radius: 1px;
}
.blue-line { background: rgba(99,179,237,0.5); }
.gold-line { background: #f6c90e; height: 2.5px; }
.legend-box {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.green-box { background: rgba(72,199,142,0.75); }
.red-box   { background: rgba(246,114,128,0.75); }

.chart-wrap {
  position: relative;
  height: 300px;
}
.chart-wrap canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}
</style>
