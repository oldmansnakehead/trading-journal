<script setup>
import { ref, onMounted } from 'vue'

// ── State ─────────────────────────────────────────────────────────────────────
const setups = ref([])
const strategies = ref([])
const symbols = ref([])

const newSetup = ref({ name: '', description: '' })
const newStrategy = ref({ name: '', description: '' })
const newSymbol = ref('')

// For linking strategies to a setup
const linkForm = ref({ setupId: '', strategyId: '' })

// For session time-range config
const sessionForm = ref({ setupId: '', sessionName: 'New York', startTime: '', endTime: '' })
const setupSessions = ref([]) // sessions for the selected setup in sessionForm
const SESSION_NAMES = ['New York', 'London', 'London Close', 'Asia', 'Tokyo']

// Custom Column (tag field)
const customTags = ref([])
const newCustomTag = ref('')
const customColumnName = ref('Custom Tag')

const msg = ref('')
const error = ref('')

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(loadAll)

async function loadAll() {
  ;[setups.value, strategies.value, symbols.value, customTags.value] = await Promise.all([
    window.api.getAllSetups(),
    window.api.getAllStrategies(),
    window.api.getAllSymbols(),
    window.api.getAllCustomTags()
  ])
  const s = await window.api.getAllSettings()
  customColumnName.value = s.customColumnName || 'Custom Tag'
}

// ── Create ────────────────────────────────────────────────────────────────────
async function createSetup() {
  if (!newSetup.value.name.trim()) return
  try {
    await window.api.createSetup({
      name: newSetup.value.name.trim(),
      description: newSetup.value.description || null
    })
    newSetup.value = { name: '', description: '' }
    flashMsg('Setup created.')
    await loadAll()
  } catch (e) {
    flashError(e.message)
  }
}

async function createStrategy() {
  if (!newStrategy.value.name.trim()) return
  try {
    await window.api.createStrategy({
      name: newStrategy.value.name.trim(),
      description: newStrategy.value.description || null
    })
    newStrategy.value = { name: '', description: '' }
    flashMsg('Strategy created.')
    await loadAll()
  } catch (e) {
    flashError(e.message)
  }
}

async function createSymbol() {
  if (!newSymbol.value.trim()) return
  try {
    await window.api.createSymbol(newSymbol.value.trim())
    newSymbol.value = ''
    flashMsg('Symbol added.')
    symbols.value = await window.api.getAllSymbols()
  } catch (e) {
    flashError(e.message)
  }
}

// ── Link ──────────────────────────────────────────────────────────────────────
async function linkStrategy() {
  if (!linkForm.value.setupId || !linkForm.value.strategyId) return
  try {
    await window.api.linkStrategy(Number(linkForm.value.setupId), Number(linkForm.value.strategyId))
    flashMsg('Strategy linked to setup.')
    await loadAll()
  } catch (e) {
    flashError(e.message)
  }
}

async function unlinkStrategy(setupId, strategyName) {
  const strat = strategies.value.find((s) => s.name === strategyName)
  if (!strat) return
  await window.api.unlinkStrategy(setupId, strat.id)
  flashMsg(`Unlinked "${strategyName}" from setup.`)
  await loadAll()
}

// ── Session Config ────────────────────────────────────────────────────────────
async function onSessionSetupChange() {
  setupSessions.value = []
  if (sessionForm.value.setupId) {
    setupSessions.value = await window.api.getSetupSessions(Number(sessionForm.value.setupId))
  }
}

async function addSetupSession() {
  if (!sessionForm.value.setupId || !sessionForm.value.startTime || !sessionForm.value.endTime)
    return
  try {
    setupSessions.value = await window.api.createSetupSession({
      setupId: Number(sessionForm.value.setupId),
      sessionName: sessionForm.value.sessionName,
      startTime: sessionForm.value.startTime,
      endTime: sessionForm.value.endTime
    })
    sessionForm.value.startTime = ''
    sessionForm.value.endTime = ''
    flashMsg('Session time range added.')
  } catch (e) {
    flashError(e.message)
  }
}

async function deleteSetupSession(id) {
  await window.api.deleteSetupSession(id)
  setupSessions.value = setupSessions.value.filter((s) => s.id !== id)
  flashMsg('Session removed.')
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteSetup(id) {
  if (!confirm('Delete this setup? All linked journal entries will be affected.')) return
  await window.api.deleteSetup(id)
  flashMsg('Setup deleted.')
  await loadAll()
}

async function deleteStrategy(id) {
  if (!confirm('Delete this strategy?')) return
  await window.api.deleteStrategy(id)
  flashMsg('Strategy deleted.')
  await loadAll()
}

async function deleteSymbol(id) {
  if (!confirm('Delete this symbol?')) return
  await window.api.deleteSymbol(id)
  flashMsg('Symbol deleted.')
  symbols.value = await window.api.getAllSymbols()
}

// ── Custom Tags ───────────────────────────────────────────────────────────────
async function saveCustomColumnName() {
  const name = customColumnName.value.trim()
  if (!name) return
  await window.api.setSetting('customColumnName', name)
  flashMsg('Column name saved.')
}

async function createCustomTag() {
  if (!newCustomTag.value.trim()) return
  try {
    await window.api.createCustomTag({ name: newCustomTag.value.trim() })
    newCustomTag.value = ''
    flashMsg('Tag added.')
    customTags.value = await window.api.getAllCustomTags()
  } catch (e) {
    flashError(e.message)
  }
}

async function deleteCustomTag(id) {
  if (!confirm('Delete this tag?')) return
  await window.api.deleteCustomTag(id)
  flashMsg('Tag deleted.')
  customTags.value = await window.api.getAllCustomTags()
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function flashMsg(m) {
  msg.value = m
  error.value = ''
  setTimeout(() => (msg.value = ''), 3000)
}
function flashError(e) {
  error.value = e
  msg.value = ''
  setTimeout(() => (error.value = ''), 4000)
}
</script>

<template>
  <div class="view-container">
    <h2 class="view-title">Setup &amp; Strategy Manager</h2>

    <transition name="toast">
      <div v-if="msg || error" class="toast" :class="error ? 'toast-error' : 'toast-success'">
        {{ msg || error }}
      </div>
    </transition>

    <div class="columns">
      <!-- ── Trade Setups ──────────────────────────────────────────────── -->
      <section class="card">
        <h3>Trade Setups</h3>
        <form class="mini-form" @submit.prevent="createSetup">
          <input v-model="newSetup.name" placeholder="Setup name (e.g. FVG)" required />
          <input v-model="newSetup.description" placeholder="Description (optional)" />
          <button type="submit">Add Setup</button>
        </form>
        <ul class="item-list">
          <li v-for="s in setups" :key="s.id">
            <div>
              <strong>{{ s.name }}</strong>
              <span v-if="s.linkedStrategies" class="sub">{{ s.linkedStrategies }}</span>
            </div>
            <button class="btn-del" @click="deleteSetup(s.id)">✕</button>
          </li>
          <li v-if="!setups.length" class="empty">No setups yet.</li>
        </ul>
      </section>

      <!-- ── Strategies ────────────────────────────────────────────────── -->
      <section class="card">
        <h3>Strategies</h3>
        <form class="mini-form" @submit.prevent="createStrategy">
          <input v-model="newStrategy.name" placeholder="Strategy name" required />
          <input v-model="newStrategy.description" placeholder="Description (optional)" />
          <button type="submit">Add Strategy</button>
        </form>
        <ul class="item-list">
          <li v-for="s in strategies" :key="s.id">
            <strong>{{ s.name }}</strong>
            <button class="btn-del" @click="deleteStrategy(s.id)">✕</button>
          </li>
          <li v-if="!strategies.length" class="empty">No strategies yet.</li>
        </ul>
      </section>

      <!-- ── Symbols ───────────────────────────────────────────────────── -->
      <section class="card">
        <h3>Symbols</h3>
        <p class="hint">Symbols appear as a dropdown in the Journal Entry form.</p>
        <form class="mini-form" @submit.prevent="createSymbol">
          <input v-model="newSymbol" placeholder="e.g. XAUUSD" required />
          <button type="submit">Add Symbol</button>
        </form>
        <ul class="item-list">
          <li v-for="s in symbols" :key="s.id">
            <strong>{{ s.name }}</strong>
            <button class="btn-del" @click="deleteSymbol(s.id)">✕</button>
          </li>
          <li v-if="!symbols.length" class="empty">No symbols yet.</li>
        </ul>
      </section>

      <!-- ── Link Setup ↔ Strategy ─────────────────────────────────────── -->
      <section class="card">
        <h3>Link Setup → Strategy</h3>
        <p class="hint">Controls which strategies appear in the Journal Entry dropdown.</p>
        <form class="mini-form" @submit.prevent="linkStrategy">
          <select v-model="linkForm.setupId" required>
            <option value="" disabled>Select Setup…</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <select v-model="linkForm.strategyId" required>
            <option value="" disabled>Select Strategy…</option>
            <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <button type="submit">Link</button>
        </form>
        <div v-for="setup in setups" :key="setup.id" class="link-group">
          <div class="link-title">{{ setup.name }}</div>
          <div v-if="setup.linkedStrategies" class="link-chips">
            <span
              v-for="stratName in setup.linkedStrategies.split(', ')"
              :key="stratName"
              class="link-chip"
            >
              {{ stratName }}
              <button @click="unlinkStrategy(setup.id, stratName)">×</button>
            </span>
          </div>
          <span v-else class="sub">No strategies linked</span>
        </div>
      </section>

      <!-- ── Custom Column (Tag Field) ─────────────────────────────────── -->
      <section class="card">
        <h3>Custom Column</h3>
        <p class="hint">
          Multi-select tag field in Journal Entry. Set the column name and manage available tags.
        </p>
        <div class="mini-form">
          <input
            v-model="customColumnName"
            placeholder="Column name (e.g. Confluence)"
            @blur="saveCustomColumnName"
            @keyup.enter="saveCustomColumnName"
          />
        </div>
        <form class="mini-form" @submit.prevent="createCustomTag">
          <input v-model="newCustomTag" placeholder="Tag name (e.g. BOS, FVG, OB)" required />
          <button type="submit">Add Tag</button>
        </form>
        <ul class="item-list">
          <li v-for="t in customTags" :key="t.id">
            <strong>{{ t.name }}</strong>
            <button class="btn-del" @click="deleteCustomTag(t.id)">✕</button>
          </li>
          <li v-if="!customTags.length" class="empty">No tags yet.</li>
        </ul>
      </section>

      <!-- ── Session Time Ranges ────────────────────────────────────────── -->
      <section class="card wide">
        <h3>Session Time Ranges</h3>
        <p class="hint">
          Configure the time range for each session per setup. The Journal Entry form will
          auto-detect the session based on the entry time you type.
        </p>

        <div class="sess-form-row">
          <select v-model="sessionForm.setupId" @change="onSessionSetupChange">
            <option value="" disabled>Select Setup…</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <select v-model="sessionForm.sessionName">
            <option v-for="n in SESSION_NAMES" :key="n" :value="n">{{ n }}</option>
          </select>
          <input
            v-model="sessionForm.startTime"
            type="text"
            placeholder="Start HH:MM"
            maxlength="5"
            class="time-in"
          />
          <span class="dash">–</span>
          <input
            v-model="sessionForm.endTime"
            type="text"
            placeholder="End HH:MM"
            maxlength="5"
            class="time-in"
          />
          <button :disabled="!sessionForm.setupId" @click="addSetupSession">Add</button>
        </div>

        <div v-if="setupSessions.length" class="sess-list">
          <div v-for="ss in setupSessions" :key="ss.id" class="sess-item">
            <span class="sess-name">{{ ss.sessionName }}</span>
            <span class="sess-time">{{ ss.startTime }} – {{ ss.endTime }}</span>
            <button class="btn-del" @click="deleteSetupSession(ss.id)">✕</button>
          </div>
        </div>
        <p v-else-if="sessionForm.setupId" class="empty">
          No session ranges configured for this setup.
        </p>
        <p v-else class="empty">Select a setup to view / add session time ranges.</p>
      </section>
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

.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
  z-index: 999;
  pointer-events: none;
}
.toast-success {
  background: #166534;
  color: #4ade80;
  border: 1px solid #166534;
}
.toast-error {
  background: #7f1d1d;
  color: #f87171;
  border: 1px solid #7f1d1d;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}
.card {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 20px;
}
.card.wide {
  grid-column: 1 / -1;
}
.card h3 {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 14px;
}

.mini-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.mini-form input,
.mini-form select {
  padding: 7px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #252525;
  color: #e0e0e0;
  font-size: 0.88rem;
}
.mini-form button {
  padding: 8px;
  background: #4f9cf9;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}

.item-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-list li {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: #252525;
  border-radius: 6px;
  padding: 8px 12px;
}
.item-list .sub {
  display: block;
  font-size: 0.78rem;
  color: #777;
  margin-top: 2px;
}
.item-list .empty {
  color: #555;
  font-size: 0.88rem;
}
.btn-del {
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0 4px;
}
.btn-del:hover {
  color: #f87171;
}

.hint {
  font-size: 0.82rem;
  color: #666;
  margin-bottom: 14px;
  line-height: 1.5;
}

.link-group {
  margin-top: 12px;
}
.link-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: #888;
  margin-bottom: 6px;
}
.link-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.link-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #1e3a5f;
  color: #7fb3f5;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 0.82rem;
}
.link-chip button {
  background: none;
  border: none;
  color: #7fb3f5;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
}

/* Session time range section */
.sess-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.sess-form-row select,
.sess-form-row input {
  padding: 7px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #252525;
  color: #e0e0e0;
  font-size: 0.88rem;
}
.sess-form-row .time-in {
  width: 80px;
  text-align: center;
}
.sess-form-row .dash {
  color: #666;
}
.sess-form-row button {
  padding: 8px 14px;
  background: #4f9cf9;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}
.sess-form-row button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sess-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sess-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #252525;
  border-radius: 6px;
  padding: 8px 12px;
}
.sess-name {
  font-weight: 600;
  color: #7fb3f5;
  min-width: 90px;
}
.sess-time {
  font-size: 0.88rem;
  color: #ccc;
  flex: 1;
}
.empty {
  color: #555;
  font-size: 0.88rem;
}
</style>
