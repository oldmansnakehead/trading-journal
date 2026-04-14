<script setup>
import { ref } from 'vue'
import JournalEntryView  from './views/JournalEntryView.vue'
import DashboardView     from './views/DashboardView.vue'
import SetupManagerView  from './views/SetupManagerView.vue'
import CalculatorView    from './views/CalculatorView.vue'
import ImportView        from './views/ImportView.vue'

const tabs = [
  { id: 'journal',  label: '+ Log Trade',  icon: '📝' },
  { id: 'dashboard', label: 'Dashboard',   icon: '📊' },
  { id: 'manager',  label: 'Setup Manager', icon: '⚙️' },
  { id: 'calculator', label: 'Calculator',   icon: '🧮' },
  { id: 'import',    label: 'Import JSON',   icon: '📥' }
]

const activeTab = ref('journal')

const viewMap = {
  journal:   JournalEntryView,
  dashboard: DashboardView,
  manager:   SetupManagerView,
  calculator: CalculatorView,
  import:    ImportView
}
</script>

<template>
  <div class="app-shell">
    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-icon">📈</span>
        <span class="logo-text">Trading Journal</span>
      </div>

      <ul class="nav-list">
        <li v-for="tab in tabs" :key="tab.id">
          <button
            class="nav-btn"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            <span class="nav-icon">{{ tab.icon }}</span>
            <span class="nav-label">{{ tab.label }}</span>
          </button>
        </li>
      </ul>
    </nav>

    <!-- Main content: keep-alive เก็บ state ไว้ / onActivated จะ refresh data เมื่อ switch tab -->
    <main class="main-content">
      <keep-alive>
        <component :is="viewMap[activeTab]" />
      </keep-alive>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100%;
  height: 100%;
  background: #111;
}

/* Sidebar */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: #161616;
  border-right: 1px solid #222;
  display: flex;
  flex-direction: column;
  padding: 20px 12px;
  gap: 24px;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
}
.logo-icon { font-size: 1.4rem; }
.logo-text { font-size: 0.9rem; font-weight: 700; color: #e0e0e0; }

.nav-list  { list-style: none; display: flex; flex-direction: column; gap: 4px; }

.nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  background: none;
  border: none;
  border-radius: 8px;
  color: #777;
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
  transition: background .15s, color .15s;
}
.nav-btn:hover  { background: #1e1e1e; color: #ccc; }
.nav-btn.active { background: #1e3a5f; color: #7fb3f5; font-weight: 600; }
.nav-icon { font-size: 1rem; }

/* Main */
.main-content {
  flex: 1;
  overflow-y: auto;
  background: #111;
}
</style>
