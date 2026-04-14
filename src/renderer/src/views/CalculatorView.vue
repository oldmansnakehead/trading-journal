<script setup>
import { ref, computed, watch } from 'vue'

// ── State (Reactive Inputs) ──
const balance = ref(1000)
const riskPercent = ref(1)
const entryPrice = ref(2000)
const stopLossPrice = ref(1995)
const targetRR = ref(3) // Default target RR
const takeProfitPrice = ref(2015) // Initial based on RR 3
const contractSize = ref(100)

// ── Computed Properties (Core Logic) ──

// Risk amount in USD
const riskAmount = computed(() => {
  const amount = (balance.value * (riskPercent.value / 100))
  return amount > 0 ? amount : 0
})

// Distance between entry and stop loss
const slDistance = computed(() => Math.abs(entryPrice.value - stopLossPrice.value))

// Final Lot Size calculation
const lotSize = computed(() => {
  if (slDistance.value === 0 || contractSize.value === 0) return 0
  const size = riskAmount.value / (slDistance.value * contractSize.value)
  return size > 0 ? Number(size.toFixed(2)) : 0
})

// ── Watch logic for RR sync ──
watch([entryPrice, stopLossPrice, targetRR], ([entry, sl, rr]) => {
  if (entry > 0 && sl > 0 && rr > 0) {
    const diff = Math.abs(entry - sl)
    if (sl < entry) {
      // BUY: TP = Entry + (Distance * RR)
      takeProfitPrice.value = +(entry + (diff * rr)).toFixed(5)
    } else {
      // SELL: TP = Entry - (Distance * RR)
      takeProfitPrice.value = +(entry - (diff * rr)).toFixed(5)
    }
  }
})

// ── Presets ──
function setPreset(type) {
  if (type === 'gold') {
    contractSize.value = 100
    entryPrice.value = 2300.00
    stopLossPrice.value = 2295.00
  } else if (type === 'forex') {
    contractSize.value = 100000
    entryPrice.value = 1.08500
    stopLossPrice.value = 1.08400
  }
}
</script>

<template>
  <div class="calculator-container">
    <div class="content-wrapper">
      <header class="page-header">
        <h1 class="title">Forex & Gold Lot Size Calculator</h1>
        <p class="subtitle">Precision risk management for every trade.</p>
      </header>

      <div class="main-layout">
        <!-- Input Panel -->
        <div class="input-panel">
          <!-- Account Section -->
          <div class="glass-card section-card">
            <h2 class="card-label">Account Settings</h2>
            <div class="input-grid">
              <div class="input-field">
                <label>Balance (USD)</label>
                <input v-model.number="balance" type="number" min="0" placeholder="1000" />
              </div>
              <div class="input-field">
                <label>Risk (%)</label>
                <div class="input-with-suffix">
                  <input v-model.number="riskPercent" type="number" min="0" step="0.1" />
                  <span class="suffix">%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Trade Parameters Section -->
          <div class="glass-card section-card">
            <div class="card-header">
              <h2 class="card-label">Trade Parameters</h2>
              <div class="preset-buttons">
                <button @click="setPreset('gold')" class="preset-btn">Gold</button>
                <button @click="setPreset('forex')" class="preset-btn">Forex</button>
              </div>
            </div>

            <div class="input-grid">
              <div class="input-field">
                <label>Entry Price</label>
                <input v-model.number="entryPrice" type="number" step="0.00001" />
              </div>
              <div class="input-field">
                <label>Stop Loss Price</label>
                <input v-model.number="stopLossPrice" type="number" step="0.00001" />
              </div>
              <div class="input-field full-width">
                <label>Contract Size (Units per Lot)</label>
                <input v-model.number="contractSize" type="number" min="0" />
                <p class="field-hint">Gold = 100, Forex = 100,000</p>
              </div>
              <div class="input-field">
                <label>Target RR</label>
                <input v-model.number="targetRR" type="number" step="0.1" />
              </div>
              <div class="input-field">
                <label>TP Price (Auto)</label>
                <input v-model.number="takeProfitPrice" type="number" step="0.00001" readonly />
              </div>
            </div>
          </div>
        </div>

        <!-- Result Panel -->
        <div class="result-panel">
          <div class="primary-result-card">
            <div class="glow-effect"></div>
            <div class="result-content">
              <span class="result-title">Recommended Lot Size</span>
              <div class="lot-display">{{ lotSize }}</div>
              
              <div class="stats-mini-grid">
                <div class="stat-item">
                  <span class="stat-label">Risk Amount</span>
                  <span class="stat-value profit">${{ riskAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">SL Distance</span>
                  <span class="stat-value loss">{{ slDistance.toFixed(5) }}</span>
                </div>
              </div>

              <!-- Math Breakdown -->
              <div class="breakdown-section">
                <span class="breakdown-label">Calculation Breakdown</span>
                <div class="math-box">
                  <span class="math-val">${{ riskAmount.toFixed(2) }}</span>
                  <span class="math-op">/</span>
                  <div class="math-group">
                    <span class="math-bracket">(</span>
                    <span>{{ slDistance.toFixed(5) }}</span>
                    <span class="math-op">×</span>
                    <span>{{ contractSize.toLocaleString() }}</span>
                    <span class="math-bracket">)</span>
                  </div>
                  <span class="math-equals">= {{ lotSize }} Lots</span>
                </div>
              </div>
            </div>
          </div>

          <div class="info-note">
            <span class="info-icon">💡</span>
            <p>Risk management is the difference between gamblers and professional traders. Stick to your risk parameters strictly.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calculator-container {
  min-height: 100%;
  background-color: #0c0c0e;
  padding: 40px 20px;
  color: #e2e4e9;
  font-family: 'Inter', -apple-system, sans-serif;
}

.content-wrapper {
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 40px;
}
.title {
  font-size: 2rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.5px;
  margin-bottom: 8px;
}
.subtitle {
  color: #8a8d98;
  font-size: 1rem;
}

.main-layout {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 30px;
}

@media (max-width: 900px) {
  .main-layout { grid-template-columns: 1fr; }
}

.glass-card {
  background: rgba(22, 22, 26, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  padding: 24px;
  backdrop-filter: blur(10px);
}

.section-card {
  margin-bottom: 24px;
}

.card-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #636681;
  letter-spacing: 1.5px;
  margin-bottom: 24px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.card-header .card-label { margin-bottom: 0; }

.preset-buttons { display: flex; gap: 8px; }
.preset-btn {
  background: #1e1e24;
  border: 1px solid #2d2d35;
  color: #8a8d98;
  padding: 4px 12px;
  border-radius: 100px;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.preset-btn:hover {
  background: #2d2d35;
  color: #fff;
  border-color: #3b82f6;
}

.input-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.input-field { display: flex; flex-direction: column; gap: 8px; }
.input-field.full-width { grid-column: span 2; }

.input-field label {
  font-size: 0.85rem;
  font-weight: 500;
  color: #a1a3b5;
}

.input-field input {
  background: #09090b;
  border: 1px solid #1e1e24;
  border-radius: 12px;
  padding: 14px 16px;
  color: #fff;
  font-size: 1.05rem;
  outline: none;
  transition: all 0.2s;
}
.input-field input:focus {
  border-color: #3b82f6;
  background: #000;
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
}

.input-with-suffix {
  position: relative;
  display: flex;
  align-items: center;
}
.input-with-suffix input {
  width: 100%;
}
.suffix {
  position: absolute;
  right: 16px;
  color: #525464;
  font-weight: 600;
}

.field-hint {
  font-size: 0.7rem;
  color: #525464;
  margin-top: 4px;
}

.result-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.primary-result-card {
  position: relative;
  background: #111116;
  border: 1px solid #22222a;
  border-radius: 24px;
  padding: 40px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}

.glow-effect {
  position: absolute;
  top: -100px;
  right: -100px;
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0) 70%);
  z-index: 1;
}

.result-content {
  position: relative;
  z-index: 2;
}

.result-title {
  display: block;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #636681;
  letter-spacing: 2px;
  margin-bottom: 12px;
}

.lot-display {
  font-size: 5rem;
  font-weight: 900;
  color: #fff;
  line-height: 1;
  margin-bottom: 30px;
  text-shadow: 0 10px 30px rgba(0,0,0,0.5);
}

.stats-mini-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  padding-bottom: 30px;
  border-bottom: 1px solid #1e1e24;
}

.stat-item { display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 0.7rem; font-weight: 600; color: #525464; text-transform: uppercase; }
.stat-value { font-size: 1.4rem; font-weight: 700; }
.stat-value.profit { color: #10b981; }
.stat-value.loss { color: #ef4444; }

.breakdown-section {
  margin-top: 30px;
}
.breakdown-label {
  display: block;
  font-size: 0.65rem;
  font-weight: 700;
  color: #3f3f4e;
  text-transform: uppercase;
  margin-bottom: 12px;
}

.math-box {
  background: #09090b;
  border: 1px solid #1a1a20;
  padding: 16px;
  border-radius: 12px;
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
  font-size: 0.75rem;
  color: #a1a3b5;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.math-val { color: #e2e4e9; font-weight: 600; }
.math-op { color: #4b4d63; }
.math-group { color: #a1a3b5; display: flex; align-items: center; gap: 4px; }
.math-bracket { color: #4b4d63; font-weight: bold; }
.math-equals { color: #3b82f6; font-weight: 700; margin-left: auto; }

.info-note {
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.1);
  border-radius: 16px;
  padding: 16px 20px;
  display: flex;
  gap: 16px;
  align-items: start;
}
.info-icon { font-size: 1.2rem; }
.info-note p {
  font-size: 0.75rem;
  line-height: 1.5;
  color: #717384;
  margin: 0;
}
</style>
