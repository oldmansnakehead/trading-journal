<script setup>
import { ref, computed, onMounted, onActivated, watch } from 'vue'

// ── Constants ─────────────────────────────────────────────────────────────────
const ALL_SESSIONS = ['New York', 'London', 'London Close', 'Asia', 'Tokyo']
const ALL_RR_TYPES = ['RR 1:2', 'RR 1:3 Top 50%', 'RR 1:3 Bottom 50%', 'RR 1:4', 'RR 1:5']

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
  dateFrom: '',
  dateTo: ''
})

const symbolInput = ref('')
const results = ref([])
const summary = ref(null)
const isLoading = ref(false)
const loadError = ref('')

// ── Account Settings ──────────────────────────────────────────────────────────
const initialBalance = ref(500)
const riskPercent = ref(6) // percent, e.g. 6 means 6%
const settingsLoaded = ref(false)
const customColumnName = ref('Custom Tag')
const dbPath = ref('')

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
  const m = rrType?.match(/1:(\d+)/)
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
  const riskAmt = bal0 * riskPct // fixed $ risk per trade

  let runningBalance = bal0
  let peakBalance = bal0

  return results.value.map((row, i) => {
    const { risk, reward, rrr } = calcRRR(row.result, row.rrType)
    const dollarPnl = +(rrr * riskAmt).toFixed(2)
    const pctPnl = +((dollarPnl / bal0) * 100).toFixed(2)

    runningBalance = +(runningBalance + dollarPnl).toFixed(2)
    if (runningBalance > peakBalance) peakBalance = runningBalance
    const drawdown = +((runningBalance / peakBalance - 1) * 100).toFixed(2)

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
  const [s, sym] = await Promise.all([window.api.getAllSetups(), window.api.getDistinctSymbols()])
  setups.value = s
  symbolOptions.value = sym
})
onActivated(runQuery)

// ── Strategy dropdown filtered by setup ──────────────────────────────────────
async function onSetupChange() {
  filters.value.strategyId = ''
  strategies.value = []
  if (filters.value.setupId) {
    strategies.value = await window.api.getStrategiesForSetup(Number(filters.value.setupId))
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

// ── Query ─────────────────────────────────────────────────────────────────────
async function runQuery() {
  isLoading.value = true
  loadError.value = ''
  try {
    const f = {
      sessions: [...filters.value.sessions],
      rrTypes: [...filters.value.rrTypes],
      symbols: [...filters.value.symbols],
      setupId: filters.value.setupId ? Number(filters.value.setupId) : null,
      strategyId: filters.value.strategyId ? Number(filters.value.strategyId) : null,
      dateFrom: filters.value.dateFrom || null,
      dateTo: filters.value.dateTo || null
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

function clearFilters() {
  filters.value = {
    sessions: [],
    rrTypes: [],
    symbols: [],
    setupId: '',
    strategyId: '',
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
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
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
          <label v-for="r in ALL_RR_TYPES" :key="r" class="check-label">
            <input v-model="filters.rrTypes" type="checkbox" :value="r" />{{ r }}
          </label>
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
          <div class="filter-label">Date From</div>
          <input v-model="filters.dateFrom" type="datetime-local" />
        </div>
        <div class="filter-group sm">
          <div class="filter-label">Date To</div>
          <input v-model="filters.dateTo" type="datetime-local" />
        </div>
      </div>

      <div class="filter-actions">
        <button class="btn-primary" :disabled="isLoading" @click="runQuery">
          {{ isLoading ? 'Loading…' : 'Apply Filters' }}
        </button>
        <button class="btn-secondary" @click="clearFilters">Clear</button>
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
            <td>{{ row.customTagNames || '—' }}</td>
            <td><button class="btn-delete" @click="deleteRow(row.id)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!isLoading" class="empty-msg">No records match the current filters.</p>
    </div>
  </div>
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
input[type='datetime-local'] {
  padding: 7px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  color: #e0e0e0;
  font-size: 0.88rem;
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
</style>
