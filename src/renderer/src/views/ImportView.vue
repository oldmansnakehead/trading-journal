<script setup>
import { ref, onMounted, watch } from 'vue'

const setups = ref([])
const symbols = ref([])
const setupRRTypes = ref([])

const selectedSetupId = ref('')
const selectedSymbol = ref('')
const selectedRRType = ref('')
const jsonInput = ref('')
const importResults = ref([])
const isImporting = ref(false)
const message = ref({ text: '', type: '' })

onMounted(async () => {
  setups.value = await window.api.getAllSetups()
  symbols.value = await window.api.getAllSymbols()
})

watch(selectedSetupId, async (newId) => {
  if (newId) {
    setupRRTypes.value = await window.api.getRRTypesForSetup(Number(newId))
    selectedRRType.value = ''
  } else {
    setupRRTypes.value = []
    selectedRRType.value = ''
  }
})

function parseThaiDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  
  // Ensure we are working with strings
  const dStr = String(dateStr)
  const tStr = String(timeStr)

  const parts = dStr.split('/')
  if (parts.length !== 3) return null
  
  const d = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10) - 1
  const y = parseInt(parts[2], 10)
  
  const timeParts = tStr.split(':')
  if (timeParts.length !== 2) return null
  const hh = parseInt(timeParts[0], 10)
  const mm = parseInt(timeParts[1], 10)
  
  const dt = new Date(y, m, d, hh, mm, 0)
  return isNaN(dt.getTime()) ? null : dt
}

async function handleImport() {
  if (!selectedSetupId.value) {
    message.value = { text: 'Please select a Trade Setup first', type: 'error' }
    return
  }

  try {
    const data = JSON.parse(jsonInput.value)
    if (!Array.isArray(data)) throw new Error('JSON must be an array of objects')

    isImporting.value = true
    message.value = { text: 'Processing data...', type: 'info' }

    const mapped = data.map((item) => {
      const entryDt = parseThaiDate(item['Entry Day'], item['Time Entry'])
      const exitDt = parseThaiDate(item['Entry Day'], item['Time Exit'])
      
      // If exit is before entry, it crossed midnight
      if (entryDt && exitDt && exitDt < entryDt) {
        exitDt.setDate(exitDt.getDate() + 1)
      }

      // Robustly find BOS value (case-insensitive)
      const findKey = (obj, target) => {
        const key = Object.keys(obj).find(k => k.toLowerCase().replace(/\s+/g, '') === target.toLowerCase().replace(/\s+/g, ''))
        return key ? obj[key] : null
      }
      
      const bosVal = findKey(item, 'TimeBOS') || item['Time BOS 7-10'] || null

      return {
        entryDateTime: entryDt ? entryDt.toISOString() : null,
        exitDateTime: exitDt ? exitDt.toISOString() : null,
        symbol: (selectedSymbol.value || item['Symbol'] || 'Unknown').replace(/\s+/g, '').toUpperCase(),
        session: item['Session'] || 'N/A',
        position: item['Position'] || 'Buy',
        tf: item['TF'] || 'M1',
        rrTypeId: Number(selectedRRType.value) || (() => {
          const n = item['RRR'] ? `Fixed ${item['RRR']}R` : 'Fixed 2R'
          const matched = setupRRTypes.value.find(x => x.name === n)
          return matched ? matched.id : null
        })(),
        rrType: item['RRR'] ? `Fixed ${item['RRR']}R` : 'Fixed 2R',

        result: item['Result'] || 'Loss',
        slPoint: parseFloat(item['SL.Point']) || 0,
        tpPoint: parseFloat(item['TP.Point']) || 0,
        directionBias: item['Direction H4,M5'] || 'Neutral',
        notes: `Imported Job NO.${item['NO.']} | Strategy: ${item['Strategy']}`,
        setupId: Number(selectedSetupId.value),
        timeBos: bosVal ? String(bosVal) : null,
        hasNews: 0,
        colorRating: item['Result'] === 'Win' ? 'green' : 'red',
        imageUrls: item['Image'] ? [item['Image']] : []
      }
    }).filter(row => row.entryDateTime) // Remove invalid rows

    const response = await window.api.bulkCreateJournals(mapped)
    message.value = { text: `Successfully imported ${response.count} trades!`, type: 'success' }
    jsonInput.value = ''
  } catch (err) {
    message.value = { text: `Import failed: ${err.message}`, type: 'error' }
  } finally {
    isImporting.value = false
  }
}

function handleFileUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    jsonInput.value = ev.target.result
  }
  reader.readAsText(file)
}
</script>

<template>
  <div class="view-container">
    <div class="header-row">
      <h2 class="view-title">Import JSON Data</h2>
      <p class="subtitle">Convert your JSON trade logs into journal entries instantly.</p>
    </div>

    <div class="import-card">
      <div class="config-grid">
        <div class="input-group">
          <label>Target Trade Setup *</label>
          <select v-model="selectedSetupId" class="custom-select">
            <option value="" disabled>Select a setup...</option>
            <option v-for="s in setups" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>

        <div class="input-group">
          <label>Overwrite Symbol (Optional)</label>
          <select v-model="selectedSymbol" class="custom-select">
            <option value="">Use Symbol from JSON</option>
            <option v-for="s in symbols" :key="s.id" :value="s.name">{{ s.name }}</option>
          </select>
        </div>

        <div class="input-group">
          <label>Overwrite RR Type (Optional)</label>
          <select v-model="selectedRRType" class="custom-select" :disabled="!selectedSetupId || !setupRRTypes.length">
            <option value="">{{ !selectedSetupId ? 'Select Setup first' : 'Use JSON or Default 2R' }}</option>
            <option v-for="r in setupRRTypes" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>
      </div>

      <div class="json-area">
        <div class="flex-between">
          <label>Paste JSON or Upload File</label>
          <input type="file" @change="handleFileUpload" accept=".json" class="file-input" />
        </div>
        <textarea 
          v-model="jsonInput" 
          placeholder='[{"NO.": 1, "Entry Day": "2/1/2024", ...}]'
          rows="12"
          class="custom-textarea"
        ></textarea>
      </div>

      <div v-if="message.text" :class="['alert', message.type]">
        {{ message.text }}
      </div>

      <div class="action-row">
        <button 
          @click="handleImport" 
          :disabled="isImporting || !jsonInput || !selectedSetupId"
          class="btn-primary"
        >
          <span v-if="isImporting">Importing...</span>
          <span v-else>Confirm Import Data</span>
        </button>
      </div>
    </div>

    <div class="help-section">
      <h4>Field Mapping Table:</h4>
      <div class="mapping-table-wrapper">
        <table class="mapping-table">
          <thead>
            <tr>
              <th>JSON Field</th>
              <th>DB Target</th>
              <th>Example / Note</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Entry Day</td><td>entryDateTime</td><td>"2/1/2024" -> 2024-01-02</td></tr>
            <tr><td>Time Entry</td><td>entryDateTime (Time)</td><td>"15:13"</td></tr>
            <tr><td>SL.Point</td><td>slPoint</td><td>93</td></tr>
            <tr><td>Result</td><td>result</td><td>"Win", "Loss"</td></tr>
            <tr><td>Image</td><td>imageUrls</td><td>TradingView URL</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-container {
  padding: 30px;
  max-width: 900px;
  margin: 0 auto;
}
.header-row { margin-bottom: 24px; }
.view-title { font-size: 1.6rem; color: var(--text-1); margin-bottom: 4px; }
.subtitle { color: var(--text-3); font-size: 0.9rem; }

.import-card {
  background: var(--bg-mute);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.2);
}

.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.input-group { display: flex; flex-direction: column; gap: 8px; }
.input-group label { font-size: 0.85rem; color: var(--text-2); font-weight: 500; }

.custom-select, .custom-textarea {
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  color: var(--text-1);
  border-radius: 8px;
  padding: 10px 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}
.custom-select:focus, .custom-textarea:focus { border-color: var(--accent); }

.json-area { display: flex; flex-direction: column; gap: 10px; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.flex-between label { font-size: 0.85rem; color: var(--text-2); }
.file-input { font-size: 0.75rem; color: var(--text-3); }

.custom-textarea { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; line-height: 1.5; }

.action-row { display: flex; justify-content: center; margin-top: 10px; }
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 12px 32px;
  border-radius: 100px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.btn-primary:disabled { background: var(--bg-hover); color: var(--text-3); cursor: not-allowed; }

.alert { padding: 12px 16px; border-radius: 8px; font-size: 0.9rem; }
.alert.success { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); }
.alert.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
.alert.info { background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent-border); }

.help-section { margin-top: 40px; }
.help-section h4 { color: var(--text-3); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1px; margin-bottom: 12px; }

.mapping-table-wrapper { background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; }
.mapping-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.8rem; }
.mapping-table th { background: var(--bg-mute); padding: 12px; color: var(--text-3); font-weight: 600; }
.mapping-table td { padding: 12px; border-top: 1px solid var(--border); color: var(--text-2); }
</style>
