<script setup>
import { ref, watch, computed, onMounted } from 'vue'

// ── Constants ─────────────────────────────────────────────────────────────────
const POSITIONS = ['Buy', 'Sell']
const RESULTS = ['Win', 'Loss', 'Breakeven']
const DIRECTION_BIAS = ['Bullish', 'Bearish']
const TF_OPTIONS = ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4']
const ALL_SESSIONS = ['New York', 'London', 'London Close', 'Asia', 'Tokyo']

// ── State ─────────────────────────────────────────────────────────────────────
const setups = ref([])
const strategies = ref([])
const symbols = ref([])
const setupSessions = ref([]) // session time ranges for selected setup
const allSetupSessions = ref([]) // all sessions across all setups (for global detection)
const customTags = ref([])
const customColumnName = ref('Custom Tag')
const selectedCustomTagIds = ref([])
const imageUrlInputs = ref([''])
const hasNews = ref(false)
const colorRating = ref('')
const setupRRTypes = ref([]) // RR types linked to the selected setup

const submitMsg = ref('')
const submitError = ref('')
const isSubmitting = ref(false)
const sessionAutoDetected = ref(false)
const nativeEntryDateRef = ref(null)
const nativeExitDateRef = ref(null)

const selectedStrategyIds = ref([])

const form = ref({
  entryDate: '',
  entryTime: '',
  exitDate: '',
  exitTime: '',
  symbol: '',
  session: '',
  position: 'Buy',
  directionBias: 'Bullish',
  setupId: '',
  tf: 'M1',
  rrTypeId: '',
  slPoint: '',
  tpPoint: '',
  result: 'Win',
  notes: ''
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  ;[setups.value, symbols.value] = await Promise.all([
    window.api.getAllSetups(),
    window.api.getAllSymbols()
  ])
  const s = await window.api.getAllSettings()
  customColumnName.value = s.customColumnName || 'Custom Tag'
  // Load all session ranges for global time detection (before setup is selected)
  const allArrays = await Promise.all(setups.value.map((st) => window.api.getSetupSessions(st.id)))
  allSetupSessions.value = allArrays.flat()
})

// ── Dynamic Strategy dropdown ─────────────────────────────────────────────────
watch(
  () => form.value.setupId,
  async (newSetupId) => {
    selectedStrategyIds.value = []
    selectedCustomTagIds.value = []
    strategies.value = []
    customTags.value = []
    setupSessions.value = []
    setupRRTypes.value = []
    form.value.rrTypeId = ''
    if (newSetupId) {
      ;[strategies.value, setupSessions.value, customTags.value, setupRRTypes.value] =
        await Promise.all([
          window.api.getStrategiesForSetup(Number(newSetupId)),
          window.api.getSetupSessions(Number(newSetupId)),
          window.api.getCustomTagsForSetup(Number(newSetupId)),
          window.api.getRRTypesForSetup(Number(newSetupId))
        ])
      if (strategies.value.length === 1) {
        selectedStrategyIds.value = [strategies.value[0].id]
      }
      if (setupRRTypes.value.length === 1) {
        form.value.rrTypeId = setupRRTypes.value[0].id
      }
    }
  }
)

// ── Auto-sync entry to exit date & time ───────────────────────────────────────
watch(
  () => form.value.entryDate,
  (newVal, oldVal) => {
    if (newVal && (!form.value.exitDate || form.value.exitDate === oldVal)) {
      form.value.exitDate = newVal
    }
  }
)
watch(
  () => form.value.entryTime,
  (newVal, oldVal) => {
    if (newVal && (!form.value.exitTime || form.value.exitTime === oldVal)) {
      form.value.exitTime = newVal
    }
  }
)

// ── Auto-detect session whenever entryTime or setupSessions changes ───────────
watch([() => form.value.entryTime, setupSessions], ([time]) => {
  const detected = detectSession(time)
  if (detected) {
    form.value.session = detected
    sessionAutoDetected.value = true
  } else {
    sessionAutoDetected.value = false
  }
})

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
    const end = eh * 60 + em

    if (start <= end) {
      if (mins >= start && mins <= end) return sess.sessionName
    } else {
      // Overnight range (e.g. 22:00 → 02:00)
      if (mins >= start || mins <= end) return sess.sessionName
    }
  }
  return ''
}

// ── Sorted display lists ─────────────────────────────────────────────────────
const sortedStrategies = computed(() =>
  [...strategies.value].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
)

const sortedCustomTags = computed(() =>
  [...customTags.value].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
)

// ── TP Point auto-calc from SL + selected RR type ratio ───────────────────
const selectedRRType = computed(
  () => setupRRTypes.value.find((r) => r.id === form.value.rrTypeId) ?? null
)

const tpComputed = computed(() => {
  const sl = parseFloat(form.value.slPoint)
  if (!sl || !selectedRRType.value) return ''
  return +(sl * selectedRRType.value.ratio).toFixed(2)
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

function addImageUrlField() {
  imageUrlInputs.value.push('')
}

function removeImageUrlField(index) {
  if (imageUrlInputs.value.length === 1) {
    imageUrlInputs.value[0] = ''
    return
  }
  imageUrlInputs.value.splice(index, 1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeThaiDateInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function onDateInput(field, e) {
  form.value[field] = normalizeThaiDateInput(e.target.value)
}

function parseThaiDisplayDate(displayDate) {
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

function pickDate(field, refEl) {
  const currentIso = parseThaiDisplayDate(form.value[field])
  if (currentIso) refEl.value = currentIso
  openNativePicker(refEl)
}

function onNativeDateChange(field, isoValue) {
  form.value[field] = isoToThaiDisplayDate(isoValue)
}

function buildIso(date, time) {
  const isoDate = parseThaiDisplayDate(date)
  if (!isoDate) return null
  return time ? `${isoDate}T${time}` : `${isoDate}T00:00`
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
  if (!form.value.rrTypeId) {
    submitError.value = 'กรุณาเลือก RR Type'
    return
  }
  if (!form.value.entryDate || !form.value.entryTime) {
    submitError.value = 'กรุณากรอกวันและเวลา Entry'
    return
  }
  if (!parseThaiDisplayDate(form.value.entryDate)) {
    submitError.value = 'รูปแบบวันที่ Entry ต้องเป็น dd/mm/yyyy (ค.ศ.)'
    return
  }
  if (form.value.exitDate && !parseThaiDisplayDate(form.value.exitDate)) {
    submitError.value = 'รูปแบบวันที่ Exit ต้องเป็น dd/mm/yyyy (ค.ศ.)'
    return
  }
  if (!form.value.symbol) {
    submitError.value = 'กรุณาเลือก Symbol'
    return
  }

  isSubmitting.value = true
  try {
    const imageUrls = imageUrlInputs.value.map((url) => url.trim()).filter(Boolean)

    for (const url of imageUrls) {
      try {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid-protocol')
      } catch {
        submitError.value = `ลิงก์รูปไม่ถูกต้อง: ${url}`
        isSubmitting.value = false
        return
      }
    }

    await window.api.createJournal({
      entryDateTime: buildIso(form.value.entryDate, form.value.entryTime),
      exitDateTime: buildIso(form.value.exitDate, form.value.exitTime),
      symbol: form.value.symbol,
      session: form.value.session || 'New York',
      position: form.value.position,
      directionBias: form.value.directionBias,
      tf: form.value.tf,
      rrType: selectedRRType.value?.name ?? '',
      slPoint: form.value.slPoint !== '' ? parseFloat(form.value.slPoint) : null,
      tpPoint: form.value.tpPoint !== '' ? parseFloat(form.value.tpPoint) : null,
      result: form.value.result,
      imageUrls,
      notes: form.value.notes || null,
      setupId: Number(form.value.setupId),
      hasNews: hasNews.value ? 1 : 0,
      colorRating: colorRating.value || null,
      // Convert Vue reactive arrays into plain arrays for Electron IPC structured clone.
      strategyIds: [...selectedStrategyIds.value],
      customTagIds: [...selectedCustomTagIds.value]
    })

    submitMsg.value = 'บันทึกการเทรดเรียบร้อย! (ฟอร์มคงค่าเดิมไว้)'
  } catch (err) {
    submitError.value = err.message ?? 'บันทึกไม่สำเร็จ'
  } finally {
    isSubmitting.value = false
  }
}

function resetForm() {
  form.value = {
    entryDate: '',
    entryTime: '',
    exitDate: '',
    exitTime: '',
    symbol: '',
    session: '',
    position: 'Buy',
    directionBias: 'Bullish',
    setupId: '',
    tf: 'M1',
    rrTypeId: '',
    slPoint: '',
    tpPoint: '',
    result: 'Win',
    notes: ''
  }
  selectedStrategyIds.value = []
  strategies.value = []
  customTags.value = []
  setupSessions.value = []
  setupRRTypes.value = []
  sessionAutoDetected.value = false
  selectedCustomTagIds.value = []
  imageUrlInputs.value = ['']
  hasNews.value = false
  colorRating.value = ''
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
            <div class="date-input-wrap">
              <input
                :value="form.entryDate"
                type="text"
                placeholder="dd/mm/yyyy"
                maxlength="10"
                required
                @input="onDateInput('entryDate', $event)"
              />
              <button
                type="button"
                class="date-picker-btn"
                @click="pickDate('entryDate', nativeEntryDateRef)"
              >
                📅
              </button>
              <input
                ref="nativeEntryDateRef"
                class="native-date-picker"
                type="date"
                tabindex="-1"
                aria-hidden="true"
                @change="onNativeDateChange('entryDate', $event.target.value)"
              />
            </div>
            <input
              :value="form.entryTime"
              type="text"
              placeholder="HH:MM"
              maxlength="5"
              pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
              class="time-input"
              required
              @input="onTimeInput('entryTime', $event)"
            />
          </div>
        </div>
        <div class="form-group datetime-group">
          <label>Exit Date &amp; Time</label>
          <div class="dt-inputs">
            <div class="date-input-wrap">
              <input
                :value="form.exitDate"
                type="text"
                placeholder="dd/mm/yyyy"
                maxlength="10"
                @input="onDateInput('exitDate', $event)"
              />
              <button
                type="button"
                class="date-picker-btn"
                @click="pickDate('exitDate', nativeExitDateRef)"
              >
                📅
              </button>
              <input
                ref="nativeExitDateRef"
                class="native-date-picker"
                type="date"
                tabindex="-1"
                aria-hidden="true"
                @change="onNativeDateChange('exitDate', $event.target.value)"
              />
            </div>
            <input
              :value="form.exitTime"
              type="text"
              placeholder="HH:MM"
              maxlength="5"
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
          <select
            v-model="form.session"
            class="session-select"
            :class="sessionAutoDetected ? 'session-detected' : ''"
          >
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
            v-for="s in sortedStrategies"
            :key="s.id"
            type="button"
            class="tag-chip tag-chip--blue"
            :class="{ active: selectedStrategyIds.includes(s.id) }"
            @click="toggleStrategy(s.id)"
          >
            {{ s.name }}
          </button>
          <span v-if="!form.setupId" class="tag-empty">Select a setup first</span>
          <span v-else-if="!strategies.length" class="tag-empty"
            >No strategies linked to this setup</span
          >
        </div>
      </div>

      <!-- Row 4: RR Type + SL Point + TP Point (auto) -->
      <div class="form-row">
        <div class="form-group">
          <label>RR Type *</label>
          <select
            v-model="form.rrTypeId"
            :disabled="!form.setupId || !setupRRTypes.length"
            required
          >
            <option value="" disabled>
              {{
                !form.setupId
                  ? 'Select a setup first'
                  : !setupRRTypes.length
                    ? 'No RR types linked'
                    : 'Select RR type…'
              }}
            </option>
            <option v-for="r in setupRRTypes" :key="r.id" :value="r.id">
              {{ r.name }}
            </option>
          </select>
          <span v-if="form.setupId && !setupRRTypes.length" class="rr-hint">
            ⚠ No RR types linked — go to Setup Manager → RR Types
          </span>
        </div>
        <div class="form-group">
          <label>SL Point</label>
          <input v-model="form.slPoint" type="number" step="0.1" min="0" placeholder="e.g. 134" />
        </div>
        <div class="form-group">
          <label>TP Point <span class="auto-tag">(auto)</span></label>
          <input
            :value="form.tpPoint"
            type="text"
            readonly
            class="session-display"
            :class="form.tpPoint ? 'session-detected' : 'session-empty'"
            :placeholder="form.slPoint ? '—' : 'Fill SL first'"
          />
        </div>
      </div>

      <!-- Row 5: Result + News + Color Rating -->
      <div class="form-row">
        <div class="form-group">
          <label>Result *</label>
          <select v-model="form.result" required>
            <option v-for="r in RESULTS" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>News</label>
          <label class="checkbox-field">
            <input v-model="hasNews" type="checkbox" />
            <span>{{ hasNews ? 'มีข่าว' : 'ไม่มีข่าว' }}</span>
          </label>
        </div>
        <div class="form-group">
          <label>ระดับสี (Quality)</label>
          <div class="color-picker">
            <button
              v-for="c in [
                ['red', 'แดง'],
                ['orange', 'ส้ม'],
                ['yellow', 'เหลือง'],
                ['green', 'เขียว']
              ]"
              :key="c[0]"
              type="button"
              class="color-chip"
              :class="[`color-chip--${c[0]}`, { active: colorRating === c[0] }]"
              @click="colorRating = colorRating === c[0] ? '' : c[0]"
            >
              {{ c[1] }}
            </button>
          </div>
        </div>
      </div>

      <!-- Custom Tags (multi-select chip picker — setup-specific) -->
      <div class="form-group full-width">
        <label>{{ customColumnName }} <span class="auto-tag">(multi-select)</span></label>
        <div class="tag-picker">
          <button
            v-for="t in sortedCustomTags"
            :key="t.id"
            type="button"
            class="tag-chip"
            :class="{ active: selectedCustomTagIds.includes(t.id) }"
            @click="toggleCustomTag(t.id)"
          >
            {{ t.name }}
          </button>
          <span v-if="!form.setupId" class="tag-empty">Select a setup first</span>
          <span v-else-if="!customTags.length" class="tag-empty"
            >No tags linked to this setup — add in Setup Manager → Link Setup → Custom Tag</span
          >
        </div>
      </div>

      <!-- Notes -->
      <div class="form-group full-width">
        <label>Image URL(s)</label>
        <div class="image-url-list">
          <div v-for="(_, idx) in imageUrlInputs" :key="idx" class="image-url-row">
            <input
              v-model.trim="imageUrlInputs[idx]"
              type="url"
              placeholder="https://example.com/image.png"
            />
            <button type="button" class="btn-url-remove" @click="removeImageUrlField(idx)">
              Remove
            </button>
          </div>
          <button type="button" class="btn-url-add" @click="addImageUrlField">
            + Add Image URL
          </button>
        </div>
      </div>

      <!-- Notes -->
      <div class="form-group full-width">
        <label>Notes</label>
        <textarea v-model="form.notes" rows="3" placeholder="Optional trade notes…"></textarea>
      </div>

      <!-- Session hint -->
      <div v-if="form.setupId && !setupSessions.length" class="hint-box">
        ⚠ No session time ranges configured for this setup. Go to Setup Manager → Session Time
        Ranges to add them.
      </div>

      <!-- Submit -->
      <div class="form-actions">
        <p v-if="submitMsg" class="msg-success">{{ submitMsg }}</p>
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
.view-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}
.view-title {
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 24px;
}

.entry-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 140px;
}
.form-group.full-width {
  flex: 0 0 100%;
}
.form-group.datetime-group {
  min-width: 260px;
}

label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
}
.auto-tag {
  font-weight: 400;
  text-transform: none;
  color: #4f9cf9;
  margin-left: 4px;
}

.dt-inputs {
  display: flex;
  gap: 8px;
}
.date-input-wrap {
  position: relative;
  flex: 3;
  min-width: 0;
}
.date-input-wrap > input[type='text'] {
  width: 100%;
  padding-right: 38px;
}
.dt-inputs .time-input {
  flex: 0 0 72px;
  text-align: center;
  letter-spacing: 0.05em;
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

.session-select.session-detected {
  color: #4ade80;
  border-color: #166534;
}

input,
select,
textarea {
  padding: 8px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  color: #e0e0e0;
  font-size: 0.9rem;
  transition: border-color 0.2s;
}
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #4f9cf9;
}
input:disabled,
select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
textarea {
  resize: vertical;
}

.hint-box {
  background: #1a1200;
  border: 1px solid #554400;
  border-radius: 6px;
  color: #facc15;
  font-size: 0.84rem;
  padding: 10px 14px;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
button {
  padding: 9px 22px;
  background: #4f9cf9;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  font-weight: 600;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: #333;
}

.msg-success {
  color: #4ade80;
  font-size: 0.88rem;
}
.msg-error {
  color: #f87171;
  font-size: 0.88rem;
}

.tag-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 36px;
  align-items: center;
}
.tag-chip {
  padding: 5px 14px;
  border: 1px solid #444;
  border-radius: 20px;
  background: #1e1e1e;
  color: #aaa;
  cursor: pointer;
  font-size: 0.84rem;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}
.tag-chip.active {
  background: #1a3a1a;
  border-color: #4ade80;
  color: #4ade80;
}
.tag-chip--blue.active {
  background: #0f2a4a;
  border-color: #4f9cf9;
  color: #4f9cf9;
}
.tag-chip:hover:not(.active) {
  border-color: #555;
  color: #ccc;
}
.tag-empty {
  font-size: 0.82rem;
  color: #555;
  font-style: italic;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1e1e1e;
  cursor: pointer;
  font-size: 0.9rem;
  color: #e0e0e0;
  user-select: none;
}
.checkbox-field input[type='checkbox'] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #4f9cf9;
}

.color-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.color-chip {
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid #444;
  background: #1e1e1e;
  color: #aaa;
  cursor: pointer;
  font-size: 0.84rem;
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
.color-chip:hover:not(.active) {
  border-color: #555;
  color: #ccc;
}

.image-url-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.image-url-row {
  display: flex;
  gap: 8px;
}
.image-url-row input {
  flex: 1;
}
.btn-url-add,
.btn-url-remove {
  border: 1px solid #333;
  border-radius: 6px;
  background: #252525;
  color: #ccc;
  cursor: pointer;
  font-size: 0.82rem;
  padding: 6px 12px;
}
.btn-url-add {
  align-self: flex-start;
}

.rr-hint {
  font-size: 0.78rem;
  color: #fb923c;
  margin-top: 3px;
}

.session-display.session-empty {
  color: #555;
}
</style>
