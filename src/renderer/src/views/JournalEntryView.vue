<script setup>
import { ref, watch, computed, onMounted } from 'vue'

// ── Constants ─────────────────────────────────────────────────────────────────
const POSITIONS      = ['Buy', 'Sell']
const RR_TYPES       = ['RR 1:2', 'RR 1:3 Top 50%', 'RR 1:3 Bottom 50%', 'RR 1:4', 'RR 1:5']
const RESULTS        = ['Win', 'Loss', 'Breakeven']
const DIRECTION_BIAS = ['Bullish', 'Bearish']
const TF_OPTIONS     = ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4']
const ALL_SESSIONS   = ['New York', 'London', 'London Close', 'Asia', 'Tokyo']

// ── State ─────────────────────────────────────────────────────────────────────
const setups     = ref([])
const strategies = ref([])
const symbols    = ref([])
const setupSessions    = ref([])   // session time ranges for selected setup
const allSetupSessions = ref([])   // all sessions across all setups (for global detection)
const customTags        = ref([])
const customColumnName  = ref('Custom Tag')
const selectedCustomTagIds = ref([])

const submitMsg          = ref('')
const submitError        = ref('')
const isSubmitting       = ref(false)
const sessionAutoDetected = ref(false)

const selectedStrategyIds = ref([])

const form = ref({
  entryDate:     '',
  entryTime:     '',
  exitDate:      '',
  exitTime:      '',
  symbol:        '',
  session:       '',
  position:      'Buy',
  directionBias: 'Bullish',
  setupId:       '',
  tf:            'M1',
  rrType:        'RR 1:2',
  slPoint:       '',
  tpPoint:       '',
  result:        'Win',
  notes:         ''
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  ;[setups.value, symbols.value, customTags.value] = await Promise.all([
    window.api.getAllSetups(),
    window.api.getAllSymbols(),
    window.api.getAllCustomTags()
  ])
  const s = await window.api.getAllSettings()
  customColumnName.value = s.customColumnName || 'Custom Tag'
  // Load all session ranges for global time detection (before setup is selected)
  const allArrays = await Promise.all(setups.value.map(st => window.api.getSetupSessions(st.id)))
  allSetupSessions.value = allArrays.flat()
})

// ── Dynamic Strategy dropdown ─────────────────────────────────────────────────
watch(
  () => form.value.setupId,
  async (newSetupId) => {
    selectedStrategyIds.value = []
    strategies.value = []
    setupSessions.value = []
    if (newSetupId) {
      ;[strategies.value, setupSessions.value] = await Promise.all([
        window.api.getStrategiesForSetup(Number(newSetupId)),
        window.api.getSetupSessions(Number(newSetupId))
      ])
      if (strategies.value.length === 1) {
        selectedStrategyIds.value = [strategies.value[0].id]
      }
    }
  }
)

// ── Auto-detect session whenever entryTime or setupSessions changes ───────────
watch(
  [() => form.value.entryTime, setupSessions],
  ([time]) => {
    const detected = detectSession(time)
    if (detected) {
      form.value.session = detected
      sessionAutoDetected.value = true
    } else {
      sessionAutoDetected.value = false
    }
  }
)

// ── Auto-detect session from entry time ───────────────────────────────────────
function detectSession(timeStr) {
  const sessions = setupSessions.value.length ? setupSessions.value : allSetupSessions.value
  if (!timeStr || !sessions.length) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const mins = h * 60 + m

  for (const sess of sessions) {
    const [sh, sm] = sess.startTime.split(':').map(Number)
    const [eh, em] = sess.endTime.split(':').map(Number)
    const start = sh * 60 + sm
    const end   = eh * 60 + em

    if (start <= end) {
      if (mins >= start && mins <= end) return sess.sessionName
    } else {
      // Overnight range (e.g. 22:00 → 02:00)
      if (mins >= start || mins <= end) return sess.sessionName
    }
  }
  return ''
}

// ── TP Point auto-calc from SL + RR Type ─────────────────────────────────────
const tpComputed = computed(() => {
  const sl = parseFloat(form.value.slPoint)
  if (!sl || !form.value.rrType) return ''
  const match = form.value.rrType.match(/1:(\d+)/)
  if (!match) return ''
  return +(sl * Number(match[1])).toFixed(2)
})

watch(tpComputed, (val) => {
  form.value.tpPoint = val !== '' ? String(val) : ''
})

// ── Strategy toggle ───────────────────────────────────────────────────────────
function toggleStrategy(id) {
  const idx = selectedStrategyIds.value.indexOf(id)
  if (idx === -1) selectedStrategyIds.value.push(id)
  else selectedStrategyIds.value.splice(idx, 1)
}

// ── Custom Tag toggle ─────────────────────────────────────────────────────────
function toggleCustomTag(id) {
  const idx = selectedCustomTagIds.value.indexOf(id)
  if (idx === -1) selectedCustomTagIds.value.push(id)
  else selectedCustomTagIds.value.splice(idx, 1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildIso(date, time) {
  if (!date) return null
  return time ? `${date}T${time}` : `${date}T00:00`
}

function onTimeInput(field, e) {
  let v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
  if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2)
  e.target.value = v
  form.value[field] = v
  // session detection handled by watch([entryTime, setupSessions])
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function handleSubmit() {
  submitMsg.value = ''
  submitError.value = ''

  if (!form.value.setupId || !selectedStrategyIds.value.length) {
    submitError.value = 'กรุณาเลือก Setup และ Strategy'
    return
  }
  if (!form.value.entryDate || !form.value.entryTime) {
    submitError.value = 'กรุณากรอกวันและเวลา Entry'
    return
  }
  if (!form.value.symbol) {
    submitError.value = 'กรุณาเลือก Symbol'
    return
  }

  isSubmitting.value = true
  try {
    await window.api.createJournal({
      entryDateTime: buildIso(form.value.entryDate, form.value.entryTime),
      exitDateTime:  buildIso(form.value.exitDate,  form.value.exitTime),
      symbol:        form.value.symbol,
      session:       form.value.session || 'New York',
      position:      form.value.position,
      directionBias: form.value.directionBias,
      tf:            form.value.tf,
      rrType:        form.value.rrType,
      slPoint:       form.value.slPoint !== '' ? parseFloat(form.value.slPoint) : null,
      tpPoint:       form.value.tpPoint !== '' ? parseFloat(form.value.tpPoint) : null,
      result:        form.value.result,
      imageUrl:      null,
      notes:         form.value.notes || null,
      setupId:       Number(form.value.setupId),
      strategyIds:   selectedStrategyIds.value,
      customTagIds:  selectedCustomTagIds.value
    })

    submitMsg.value = 'บันทึกการเทรดเรียบร้อย!'
    resetForm()
  } catch (err) {
    submitError.value = err.message ?? 'บันทึกไม่สำเร็จ'
  } finally {
    isSubmitting.value = false
  }
}

function resetForm() {
  form.value = {
    entryDate: '', entryTime: '', exitDate: '', exitTime: '',
    symbol: '', session: '', position: 'Buy', directionBias: 'Bullish',
    setupId: '', tf: 'M1', rrType: 'RR 1:2',
    slPoint: '', tpPoint: '', result: 'Win', notes: ''
  }
  selectedStrategyIds.value = []
  strategies.value          = []
  setupSessions.value       = []
  sessionAutoDetected.value = false
  selectedCustomTagIds.value = []
}
</script>

<template>
  <div class="view-container">
    <h2 class="view-title">New Journal Entry</h2>

    <form class="entry-form" @submit.prevent="handleSubmit">

      <!-- Row 1: Entry & Exit datetime -->
      <div class="form-row">
        <div class="form-group datetime-group">
          <label>Entry Date &amp; Time *</label>
          <div class="dt-inputs">
            <input v-model="form.entryDate" type="date" required />
            <input
              :value="form.entryTime"
              type="text" placeholder="HH:MM" maxlength="5"
              pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
              class="time-input" required
              @input="onTimeInput('entryTime', $event)"
            />
          </div>
        </div>
        <div class="form-group datetime-group">
          <label>Exit Date &amp; Time</label>
          <div class="dt-inputs">
            <input v-model="form.exitDate" type="date" />
            <input
              :value="form.exitTime"
              type="text" placeholder="HH:MM" maxlength="5"
              pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
              class="time-input"
              @input="onTimeInput('exitTime', $event)"
            />
          </div>
        </div>
      </div>

      <!-- Row 2: Symbol + Session (auto) + Position + Direction Bias -->
      <div class="form-row">
        <div class="form-group">
          <label>Symbol *</label>
          <select v-model="form.symbol" required>
            <option value="" disabled>Select symbol…</option>
            <option v-for="s in symbols" :key="s.id" :value="s.name">{{ s.name }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>Session <span class="auto-tag">(auto)</span></label>
          <select v-model="form.session" class="session-select" :class="sessionAutoDetected ? 'session-detected' : ''">
            <option value="" disabled>Select session…</option>
            <option v-for="s in ALL_SESSIONS" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>Position *</label>
          <select v-model="form.position" required>
            <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>Direction Bias *</label>
          <select v-model="form.directionBias" required>
            <option v-for="d in DIRECTION_BIAS" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>

      <!-- Row 3: Setup + TF -->
      <div class="form-row">
        <div class="form-group">
          <label>Trade Setup *</label>
          <select v-model="form.setupId" required>
            <option value="" disabled>Select a setup…</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>TF *</label>
          <select v-model="form.tf" required>
            <option v-for="t in TF_OPTIONS" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </div>

      <!-- Strategy (multi-select chip picker) -->
      <div class="form-group full-width">
        <label>Strategy * <span class="auto-tag">(multi-select)</span></label>
        <div class="tag-picker">
          <button
            v-for="s in strategies" :key="s.id"
            type="button"
            class="tag-chip tag-chip--blue"
            :class="{ active: selectedStrategyIds.includes(s.id) }"
            @click="toggleStrategy(s.id)"
          >{{ s.name }}</button>
          <span v-if="!form.setupId" class="tag-empty">Select a setup first</span>
          <span v-else-if="!strategies.length" class="tag-empty">No strategies linked to this setup</span>
        </div>
      </div>

      <!-- Row 4: RR Type + SL Point + TP Point (auto) -->
      <div class="form-row">
        <div class="form-group">
          <label>RR Type *</label>
          <select v-model="form.rrType" required>
            <option v-for="r in RR_TYPES" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>SL Point</label>
          <input v-model="form.slPoint" type="number" step="0.1" min="0" placeholder="e.g. 134" />
        </div>
        <div class="form-group">
          <label>TP Point <span class="auto-tag">(auto)</span></label>
          <input :value="form.tpPoint" type="text" readonly class="session-display"
            :class="form.tpPoint ? 'session-detected' : 'session-empty'"
            :placeholder="form.slPoint ? '—' : 'Fill SL first'" />
        </div>
      </div>

      <!-- Row 5: Result -->
      <div class="form-row">
        <div class="form-group">
          <label>Result *</label>
          <select v-model="form.result" required>
            <option v-for="r in RESULTS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
      </div>

      <!-- Custom Tags (multi-select chip picker) -->
      <div class="form-group full-width">
        <label>{{ customColumnName }} <span class="auto-tag">(multi-select)</span></label>
        <div class="tag-picker">
          <button
            v-for="t in customTags" :key="t.id"
            type="button"
            class="tag-chip"
            :class="{ active: selectedCustomTagIds.includes(t.id) }"
            @click="toggleCustomTag(t.id)"
          >{{ t.name }}</button>
          <span v-if="!customTags.length" class="tag-empty">No tags — add in Setup Manager → Custom Column</span>
        </div>
      </div>

      <!-- Notes -->
      <div class="form-group full-width">
        <label>Notes</label>
        <textarea v-model="form.notes" rows="3" placeholder="Optional trade notes…"></textarea>
      </div>

      <!-- Session hint -->
      <div v-if="form.setupId && !setupSessions.length" class="hint-box">
        ⚠ No session time ranges configured for this setup. Go to Setup Manager → Session Time Ranges to add them.
      </div>

      <!-- Submit -->
      <div class="form-actions">
        <p v-if="submitMsg"   class="msg-success">{{ submitMsg }}</p>
        <p v-if="submitError" class="msg-error">{{ submitError }}</p>
        <button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? 'Saving…' : 'Log Trade' }}
        </button>
        <button type="button" class="btn-secondary" @click="resetForm">Reset</button>
      </div>

    </form>
  </div>
</template>

<style scoped>
.view-container { max-width: 900px; margin: 0 auto; padding: 24px; }
.view-title     { font-size: 1.4rem; font-weight: 600; margin-bottom: 24px; }

.entry-form  { display: flex; flex-direction: column; gap: 16px; }
.form-row    { display: flex; gap: 16px; flex-wrap: wrap; }

.form-group  { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 140px; }
.form-group.full-width  { flex: 0 0 100%; }
.form-group.datetime-group { min-width: 260px; }

label { font-size: 0.78rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.05em; color: #888; }
.auto-tag { font-weight: 400; text-transform: none; color: #4f9cf9; margin-left: 4px; }

.dt-inputs { display: flex; gap: 8px; }
.dt-inputs input[type="date"] { flex: 3; min-width: 0; }
.dt-inputs .time-input        { flex: 0 0 72px; text-align: center; letter-spacing: 0.05em; }

.session-select.session-detected { color: #4ade80; border-color: #166534; }

input, select, textarea {
  padding: 8px 10px; border: 1px solid #333; border-radius: 6px;
  background: #1e1e1e; color: #e0e0e0; font-size: 0.9rem; transition: border-color .2s;
}
input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
input:focus, select:focus, textarea:focus { outline: none; border-color: #4f9cf9; }
input:disabled, select:disabled { opacity: 0.4; cursor: not-allowed; }
textarea { resize: vertical; }

.hint-box {
  background: #1a1200; border: 1px solid #554400; border-radius: 6px;
  color: #facc15; font-size: 0.84rem; padding: 10px 14px;
}

.form-actions  { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
button         { padding: 9px 22px; background: #4f9cf9; color: #fff; border: none;
                 border-radius: 6px; font-size: 0.9rem; cursor: pointer; font-weight: 600; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: #333; }

.msg-success { color: #4ade80; font-size: 0.88rem; }
.msg-error   { color: #f87171; font-size: 0.88rem; }

.tag-picker { display: flex; flex-wrap: wrap; gap: 8px; min-height: 36px; align-items: center; }
.tag-chip {
  padding: 5px 14px; border: 1px solid #444; border-radius: 20px;
  background: #1e1e1e; color: #aaa; cursor: pointer; font-size: 0.84rem;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.tag-chip.active { background: #1a3a1a; border-color: #4ade80; color: #4ade80; }
.tag-chip--blue.active { background: #0f2a4a; border-color: #4f9cf9; color: #4f9cf9; }
.tag-chip:hover:not(.active) { border-color: #555; color: #ccc; }
.tag-empty { font-size: 0.82rem; color: #555; font-style: italic; }
</style>
