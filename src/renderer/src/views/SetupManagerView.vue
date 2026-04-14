<script setup>
import { ref, computed, onMounted } from 'vue'

// ── State ─────────────────────────────────────────────────────────────────────
const setups = ref([])
const strategies = ref([])
const symbols = ref([])

const newSetup = ref({ name: '', description: '' })
const newStrategy = ref({ name: '', description: '' })
const newSymbol = ref('')

// Bulk link: strategies ↔ setup
const stratLink = ref({ setupId: '', checkedIds: [], linkedIds: [] })
const stratAllChecked = computed(
  () =>
    strategies.value.length > 0 &&
    strategies.value.every((s) => stratLink.value.checkedIds.includes(s.id))
)
const stratSomeChecked = computed(() =>
  strategies.value.some((s) => stratLink.value.checkedIds.includes(s.id))
)

// Bulk link: custom tags ↔ setup
const tagLink = ref({ setupId: '', checkedIds: [], linkedIds: [] })
const tagAllChecked = computed(
  () =>
    customTags.value.length > 0 &&
    customTags.value.every((t) => tagLink.value.checkedIds.includes(t.id))
)
const tagSomeChecked = computed(() =>
  customTags.value.some((t) => tagLink.value.checkedIds.includes(t.id))
)

// Bulk link: RR Types ↔ setup
const rrTypes = ref([])
const newRRType = ref({ name: '', ratio: '' })
const rrLink = ref({ setupId: '', checkedIds: [], linkedIds: [] })
const rrAllChecked = computed(
  () =>
    rrTypes.value.length > 0 &&
    rrTypes.value.every((r) => rrLink.value.checkedIds.includes(r.id))
)
const rrSomeChecked = computed(() =>
  rrTypes.value.some((r) => rrLink.value.checkedIds.includes(r.id))
)

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

// ── In-app confirm modal (replaces native confirm() which breaks focus) ──────
const confirmModal = ref({ visible: false, message: '', resolve: null })

function useConfirm(message) {
  return new Promise((resolve) => {
    confirmModal.value = { visible: true, message, resolve }
  })
}

function onConfirmYes() {
  const resolve = confirmModal.value.resolve
  confirmModal.value = { visible: false, message: '', resolve: null }
  resolve(true)
}

function onConfirmNo() {
  const resolve = confirmModal.value.resolve
  confirmModal.value = { visible: false, message: '', resolve: null }
  resolve(false)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(loadAll)

async function loadAll() {
  ;[setups.value, strategies.value, symbols.value, customTags.value, rrTypes.value] = await Promise.all([
    window.api.getAllSetups(),
    window.api.getAllStrategies(),
    window.api.getAllSymbols(),
    window.api.getAllCustomTags(),
    window.api.getAllRRTypes()
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
async function onStratLinkSetupChange() {
  stratLink.value.checkedIds = []
  stratLink.value.linkedIds = []
  if (!stratLink.value.setupId) return
  const rows = await window.api.getStrategiesForSetup(Number(stratLink.value.setupId))
  stratLink.value.checkedIds = rows.map((s) => s.id)
  stratLink.value.linkedIds = rows.map((s) => s.id)
}

function toggleAllStrats(on) {
  stratLink.value.checkedIds = on ? strategies.value.map((s) => s.id) : []
}

async function saveStrategyLinks() {
  if (!stratLink.value.setupId) return
  try {
    const setupId = Number(stratLink.value.setupId)
    const checked = [...stratLink.value.checkedIds]
    const linked = [...stratLink.value.linkedIds]
    const toLink = checked.filter((id) => !linked.includes(id))
    const toUnlink = linked.filter((id) => !checked.includes(id))
    for (const id of toLink) await window.api.linkStrategy(setupId, id)
    for (const id of toUnlink) await window.api.unlinkStrategy(setupId, id)
    stratLink.value.linkedIds = checked
    flashMsg('Strategies saved.')
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
  const confirmed = await useConfirm('Delete this setup? All linked journal entries will be affected.')
  if (!confirmed) return
  await window.api.deleteSetup(id)
  flashMsg('Setup deleted.')
  await loadAll()
}

async function deleteStrategy(id) {
  const confirmed = await useConfirm('Delete this strategy?')
  if (!confirmed) return
  await window.api.deleteStrategy(id)
  flashMsg('Strategy deleted.')
  await loadAll()
}

async function deleteSymbol(id) {
  const confirmed = await useConfirm('Delete this symbol?')
  if (!confirmed) return
  await window.api.deleteSymbol(id)
  flashMsg('Symbol deleted.')
  symbols.value = await window.api.getAllSymbols()
}

// ── Link Setup ↔ Custom Tag ───────────────────────────────────────────────────
async function onTagLinkSetupChange() {
  tagLink.value.checkedIds = []
  tagLink.value.linkedIds = []
  if (!tagLink.value.setupId) return
  const rows = await window.api.getCustomTagsForSetup(Number(tagLink.value.setupId))
  tagLink.value.checkedIds = rows.map((t) => t.id)
  tagLink.value.linkedIds = rows.map((t) => t.id)
}

function toggleAllTags(on) {
  tagLink.value.checkedIds = on ? customTags.value.map((t) => t.id) : []
}

async function saveCustomTagLinks() {
  if (!tagLink.value.setupId) return
  try {
    const setupId = Number(tagLink.value.setupId)
    const checked = [...tagLink.value.checkedIds]
    const linked = [...tagLink.value.linkedIds]
    const toLink = checked.filter((id) => !linked.includes(id))
    const toUnlink = linked.filter((id) => !checked.includes(id))
    for (const id of toLink) await window.api.linkCustomTag(setupId, id)
    for (const id of toUnlink) await window.api.unlinkCustomTag(setupId, id)
    tagLink.value.linkedIds = checked
    flashMsg('Custom tags saved.')
    await loadAll()
  } catch (e) {
    flashError(e.message)
  }
}

async function unlinkCustomTag(setupId, tagName) {
  const tag = customTags.value.find((t) => t.name === tagName)
  if (!tag) return
  await window.api.unlinkCustomTag(setupId, tag.id)
  flashMsg(`Unlinked "${tagName}" from setup.`)
  await loadAll()
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
  const confirmed = await useConfirm('Delete this tag?')
  if (!confirmed) return
  await window.api.deleteCustomTag(id)
  flashMsg('Tag deleted.')
  customTags.value = await window.api.getAllCustomTags()
}

// ── RR Types (global CRUD) ─────────────────────────────────────────────────────
async function createRRType() {
  const name = newRRType.value.name.trim()
  const ratio = parseFloat(newRRType.value.ratio)
  if (!name || isNaN(ratio) || ratio <= 0) return
  try {
    await window.api.createRRType({ name, ratio })
    newRRType.value = { name: '', ratio: '' }
    flashMsg('RR Type added.')
    rrTypes.value = await window.api.getAllRRTypes()
  } catch (e) {
    flashError(e.message)
  }
}

async function deleteRRType(id) {
  const confirmed = await useConfirm('Delete this RR Type?')
  if (!confirmed) return
  await window.api.deleteRRType(id)
  flashMsg('RR Type deleted.')
  rrTypes.value = await window.api.getAllRRTypes()
}

// ── RR Types (link / unlink per setup) ─────────────────────────────────────
async function onRRLinkSetupChange() {
  rrLink.value.checkedIds = []
  rrLink.value.linkedIds = []
  if (!rrLink.value.setupId) return
  const rows = await window.api.getRRTypesForSetup(Number(rrLink.value.setupId))
  rrLink.value.checkedIds = rows.map((r) => r.id)
  rrLink.value.linkedIds = rows.map((r) => r.id)
}

function toggleAllRR(on) {
  rrLink.value.checkedIds = on ? rrTypes.value.map((r) => r.id) : []
}

async function saveRRTypeLinks() {
  if (!rrLink.value.setupId) return
  try {
    const setupId = Number(rrLink.value.setupId)
    const checked = [...rrLink.value.checkedIds]
    const linked = [...rrLink.value.linkedIds]
    const toLink = checked.filter((id) => !linked.includes(id))
    const toUnlink = linked.filter((id) => !checked.includes(id))
    for (const id of toLink) await window.api.linkRRType(setupId, id)
    for (const id of toUnlink) await window.api.unlinkRRType(setupId, id)
    rrLink.value.linkedIds = checked
    flashMsg('RR Types saved.')
    await loadAll()
  } catch (e) {
    flashError(e.message)
  }
}

async function unlinkRRType(setupId, rrName) {
  const rr = rrTypes.value.find((r) => r.name === rrName)
  if (!rr) return
  await window.api.unlinkRRType(setupId, rr.id)
  flashMsg(`Unlinked "${rrName}" from setup.`)
  await loadAll()
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

    <!-- ── Confirm Modal ── -->
    <transition name="modal-fade">
      <div v-if="confirmModal.visible" class="modal-overlay" @click.self="onConfirmNo">
        <div class="modal-box">
          <p class="modal-msg">{{ confirmModal.message }}</p>
          <div class="modal-actions">
            <button class="modal-btn modal-btn--cancel" @click="onConfirmNo">Cancel</button>
            <button class="modal-btn modal-btn--confirm" @click="onConfirmYes">Delete</button>
          </div>
        </div>
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
        <div class="mini-form">
          <select v-model="stratLink.setupId" @change="onStratLinkSetupChange">
            <option value="" disabled>Select Setup…</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div v-if="stratLink.setupId && strategies.length" class="check-list">
          <label class="check-item check-all">
            <input
              type="checkbox"
              :checked="stratAllChecked"
              :indeterminate="stratSomeChecked && !stratAllChecked"
              @change="toggleAllStrats($event.target.checked)"
            />
            <span>All</span>
          </label>
          <label v-for="s in strategies" :key="s.id" class="check-item">
            <input type="checkbox" v-model="stratLink.checkedIds" :value="s.id" />
            <span>{{ s.name }}</span>
          </label>
          <button class="btn-save" @click="saveStrategyLinks">Save</button>
        </div>
        <p v-else-if="stratLink.setupId" class="empty">No strategies available.</p>
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

      <!-- ── Link Setup ↔ Custom Tag ──────────────────────────────────── -->
      <section class="card">
        <h3>Link Setup → Custom Tag</h3>
        <p class="hint">Controls which custom tags appear per setup in the Journal Entry form.</p>
        <div class="mini-form">
          <select v-model="tagLink.setupId" @change="onTagLinkSetupChange">
            <option value="" disabled>Select Setup…</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div v-if="tagLink.setupId && customTags.length" class="check-list">
          <label class="check-item check-all">
            <input
              type="checkbox"
              :checked="tagAllChecked"
              :indeterminate="tagSomeChecked && !tagAllChecked"
              @change="toggleAllTags($event.target.checked)"
            />
            <span>All</span>
          </label>
          <label v-for="t in customTags" :key="t.id" class="check-item">
            <input type="checkbox" v-model="tagLink.checkedIds" :value="t.id" />
            <span>{{ t.name }}</span>
          </label>
          <button class="btn-save btn-save--green" @click="saveCustomTagLinks">Save</button>
        </div>
        <p v-else-if="tagLink.setupId" class="empty">No custom tags available.</p>
        <div v-for="setup in setups" :key="setup.id" class="link-group">
          <div class="link-title">{{ setup.name }}</div>
          <div v-if="setup.linkedCustomTags" class="link-chips">
            <span
              v-for="tagName in setup.linkedCustomTags.split(',')"
              :key="tagName"
              class="link-chip link-chip--green"
            >
              {{ tagName.trim() }}
              <button @click="unlinkCustomTag(setup.id, tagName.trim())">×</button>
            </span>
          </div>
          <span v-else class="sub">No custom tags linked</span>
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

      <!-- ── RR Types ────────────────────────────────────────────────── -->
      <section class="card">
        <h3>RR Types</h3>
        <p class="hint">
          Add named RR targets with a multiplier ratio. They will appear as a dropdown per setup in
          the Journal Entry form.
        </p>
        <form class="mini-form" @submit.prevent="createRRType">
          <input v-model="newRRType.name" placeholder="Display name (e.g. RR 1:2)" required />
          <input
            v-model="newRRType.ratio"
            type="number"
            step="0.1"
            min="0.1"
            placeholder="Ratio (e.g. 2)"
            required
          />
          <button type="submit">Add RR Type</button>
        </form>
        <ul class="item-list">
          <li v-for="r in rrTypes" :key="r.id">
            <div>
              <strong>{{ r.name }}</strong>
              <span class="sub">ratio 1:{{ r.ratio }}</span>
            </div>
            <button class="btn-del" @click="deleteRRType(r.id)">✕</button>
          </li>
          <li v-if="!rrTypes.length" class="empty">No RR types yet.</li>
        </ul>
      </section>

      <!-- ── Link Setup ↔ RR Type ────────────────────────────────────────── -->
      <section class="card">
        <h3>Link Setup → RR Type</h3>
        <p class="hint">Controls which RR types appear in the Journal Entry dropdown per setup.</p>
        <div class="mini-form">
          <select v-model="rrLink.setupId" @change="onRRLinkSetupChange">
            <option value="" disabled>Select Setup…</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div v-if="rrLink.setupId && rrTypes.length" class="check-list">
          <label class="check-item check-all">
            <input
              type="checkbox"
              :checked="rrAllChecked"
              :indeterminate="rrSomeChecked && !rrAllChecked"
              @change="toggleAllRR($event.target.checked)"
            />
            <span>All</span>
          </label>
          <label v-for="r in rrTypes" :key="r.id" class="check-item">
            <input type="checkbox" v-model="rrLink.checkedIds" :value="r.id" />
            <span>{{ r.name }} <span class="rr-ratio">(1:{{ r.ratio }})</span></span>
          </label>
          <button class="btn-save btn-save--orange" @click="saveRRTypeLinks">Save</button>
        </div>
        <p v-else-if="rrLink.setupId" class="empty">No RR types available. Add some above first.</p>
        <div v-for="setup in setups" :key="setup.id" class="link-group">
          <div class="link-title">{{ setup.name }}</div>
          <div v-if="setup.linkedRRTypes" class="link-chips">
            <span
              v-for="rrName in setup.linkedRRTypes.split(',')"
              :key="rrName"
              class="link-chip link-chip--orange"
            >
              {{ rrName.trim() }}
              <button @click="unlinkRRType(setup.id, rrName.trim())">×</button>
            </span>
          </div>
          <span v-else class="sub">No RR types linked</span>
        </div>
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
  background: var(--bg-mute);
  border: 1px solid var(--border);
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
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-1);
  font-size: 0.88rem;
}
.mini-form button {
  padding: 8px;
  background: var(--accent);
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
  background: var(--bg-input);
  border-radius: 6px;
  padding: 8px 12px;
}
.item-list .sub {
  display: block;
  font-size: 0.78rem;
  color: var(--text-3);
  margin-top: 2px;
}
.item-list .empty {
  color: var(--text-3);
  font-size: 0.88rem;
}
.btn-del {
  background: none;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0 4px;
}
.btn-del:hover {
  color: #f87171;
}

.hint {
  font-size: 0.82rem;
  color: var(--text-3);
  margin-bottom: 14px;
  line-height: 1.5;
}

.link-group {
  margin-top: 12px;
}
.link-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-2);
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
  background: var(--accent-bg);
  color: var(--text-active);
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 0.82rem;
}
.link-chip button {
  background: none;
  border: none;
  color: var(--text-active);
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
}
.link-chip--green {
  background: var(--win-bg);
  color: var(--win-text);
}
.link-chip--green button {
  color: var(--win-text);
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
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-1);
  font-size: 0.88rem;
}
.sess-form-row .time-in {
  width: 80px;
  text-align: center;
}
.sess-form-row .dash {
  color: var(--text-3);
}
.sess-form-row button {
  padding: 8px 14px;
  background: var(--accent);
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
  background: var(--bg-input);
  border-radius: 6px;
  padding: 8px 12px;
}
.sess-name {
  font-weight: 600;
  color: var(--text-active);
  min-width: 90px;
}
.sess-time {
  font-size: 0.88rem;
  color: var(--text-2);
  flex: 1;
}
.empty {
  color: var(--text-3);
  font-size: 0.88rem;
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-input);
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--text-1);
  user-select: none;
}
.check-item:hover {
  background: var(--bg-hover);
}
.check-item input[type='checkbox'] {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
  cursor: pointer;
  flex-shrink: 0;
}
.check-all {
  border-bottom: 1px solid var(--border-soft);
  border-radius: 6px 6px 0 0;
  font-weight: 600;
  color: var(--text-2);
}
.btn-save {
  margin-top: 6px;
  padding: 8px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}
.btn-save--green {
  background: #166534;
  color: #4ade80;
}
.btn-save--orange {
  background: #7c2d12;
  color: #fb923c;
}
.link-chip--orange {
  background: #431407;
  color: #fb923c;
}
.link-chip--orange button {
  color: #fb923c;
}
.rr-ratio {
  font-size: 0.78rem;
  color: #fb923c;
  margin-left: 2px;
}

/* ── Confirm Modal ──────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.modal-box {
  background: var(--bg-modal);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 28px 32px;
  min-width: 320px;
  max-width: 440px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
}
.modal-msg {
  margin: 0 0 22px;
  font-size: 0.95rem;
  color: var(--text-1);
  line-height: 1.6;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.modal-btn {
  padding: 8px 20px;
  border-radius: 7px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s;
}
.modal-btn:hover { opacity: 0.85; }
.modal-btn--cancel {
  background: var(--bg-hover);
  color: var(--text-2);
  border: 1px solid var(--border-soft);
}
.modal-btn--confirm {
  background: #7f1d1d;
  color: #fca5a5;
}
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
