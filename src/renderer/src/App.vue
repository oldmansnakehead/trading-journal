<script setup>
import { ref, onMounted } from 'vue'
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
const sidebarCollapsed = ref(false)

const viewMap = {
  journal:   JournalEntryView,
  dashboard: DashboardView,
  manager:   SetupManagerView,
  calculator: CalculatorView,
  import:    ImportView
}

const isDark = ref(true)

onMounted(() => {
  const saved = localStorage.getItem('theme')
  isDark.value = saved !== 'light'
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light'
})

function toggleTheme() {
  isDark.value = !isDark.value
  const theme = isDark.value ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}
</script>

<template>
  <div class="app-shell">
    <!-- Sidebar -->
    <nav class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-logo">
        <span class="logo-icon">📈</span>
        <span class="logo-text">Trading Journal</span>
      </div>

      <ul class="nav-list">
        <li v-for="tab in tabs" :key="tab.id">
          <button
            class="nav-btn"
            :class="{ active: activeTab === tab.id }"
            :title="sidebarCollapsed ? tab.label : ''"
            @click="activeTab = tab.id"
          >
            <span class="nav-icon">{{ tab.icon }}</span>
            <span class="nav-label">{{ tab.label }}</span>
          </button>
        </li>
      </ul>

      <div class="sidebar-footer">
        <button
          class="theme-toggle"
          :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
          @click="toggleTheme"
        >
          <span class="theme-icon">{{ isDark ? '☀️' : '🌙' }}</span>
          <span class="theme-label">{{ isDark ? 'Light Mode' : 'Dark Mode' }}</span>
        </button>
      </div>

    </nav>

    <button
      class="sidebar-toggle-btn"
      :style="{ left: sidebarCollapsed ? '40px' : '188px' }"
      :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      @click="sidebarCollapsed = !sidebarCollapsed"
    >{{ sidebarCollapsed ? '›' : '‹' }}</button>

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
  background: var(--bg);
  position: relative;
}

/* Sidebar (Minimalist) */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  padding: 24px 12px;
  gap: 32px;
  position: relative;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.sidebar.collapsed {
  width: 64px;
  padding: 24px 8px;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  white-space: nowrap;
  min-height: 40px;
}
.logo-icon { font-size: 1.5rem; flex-shrink: 0; }
.logo-text {
  font-size: 0.85rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-1);
  transition: opacity 0.2s;
}
.sidebar.collapsed .logo-text {
  opacity: 0;
  width: 0;
}

.nav-list  { list-style: none; display: flex; flex-direction: column; gap: 6px; flex: 1; }

.nav-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: none;
  border-radius: 10px;
  color: var(--text-2);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}
.nav-btn:hover  { background: var(--bg-hover); color: var(--text-1); }
.nav-btn.active {
  background: var(--nav-active-bg);
  color: var(--nav-active-text);
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
.nav-icon { font-size: 1rem; flex-shrink: 0; filter: grayscale(0.2); transition: transform 0.2s; }
.nav-btn:hover .nav-icon { transform: scale(1.15); filter: grayscale(0); }
.nav-label {
  transition: opacity 0.2s;
  letter-spacing: 0.01em;
}
.sidebar.collapsed .nav-label {
  opacity: 0;
  width: 0;
}

/* Theme toggle (Minimalist) */
.sidebar-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.theme-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text-2);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.theme-toggle:hover {
  background: var(--bg-hover);
  border-color: var(--accent-border);
  color: var(--text-1);
}
.theme-icon { font-size: 0.9rem; flex-shrink: 0; }
.theme-label {
  transition: opacity 0.2s;
}
.sidebar.collapsed .theme-label {
  opacity: 0;
  width: 0;
}

/* Toggle button (Minimalist Floating) */
.sidebar-toggle-btn {
  position: absolute;
  top: 32px;
  left: 188px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 20;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.sidebar-toggle-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  transform: scale(1.1) translateX(2px);
}

/* Main */
.main-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg);
}
</style>
