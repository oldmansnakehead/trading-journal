import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // ── Trade Setups ──────────────────────────────────────────────────────────
  getAllSetups: () => ipcRenderer.invoke('setups:getAll'),
  createSetup: (data) => ipcRenderer.invoke('setups:create', data),
  deleteSetup: (id) => ipcRenderer.invoke('setups:delete', id),
  linkStrategy: (setupId, strategyId) =>
    ipcRenderer.invoke('setups:linkStrategy', { setupId, strategyId }),
  unlinkStrategy: (setupId, strategyId) =>
    ipcRenderer.invoke('setups:unlinkStrategy', { setupId, strategyId }),
  getStrategiesForSetup: (setupId) => ipcRenderer.invoke('setups:getStrategies', setupId),
  linkCustomTag: (setupId, customTagId) =>
    ipcRenderer.invoke('setups:linkCustomTag', { setupId, customTagId }),
  unlinkCustomTag: (setupId, customTagId) =>
    ipcRenderer.invoke('setups:unlinkCustomTag', { setupId, customTagId }),
  getCustomTagsForSetup: (setupId) => ipcRenderer.invoke('setups:getCustomTags', setupId),

  // ── Strategies ────────────────────────────────────────────────────────────
  getAllStrategies: () => ipcRenderer.invoke('strategies:getAll'),
  createStrategy: (data) => ipcRenderer.invoke('strategies:create', data),
  deleteStrategy: (id) => ipcRenderer.invoke('strategies:delete', id),

  // ── Symbols ───────────────────────────────────────────────────────────────
  getAllSymbols: () => ipcRenderer.invoke('symbols:getAll'),
  createSymbol: (name) => ipcRenderer.invoke('symbols:create', name),
  deleteSymbol: (id) => ipcRenderer.invoke('symbols:delete', id),

  // ── Setup Sessions ────────────────────────────────────────────────────────
  getSetupSessions: (setupId) => ipcRenderer.invoke('setupSessions:getForSetup', setupId),
  createSetupSession: (data) => ipcRenderer.invoke('setupSessions:create', data),
  deleteSetupSession: (id) => ipcRenderer.invoke('setupSessions:delete', id),

  // ── Settings ──────────────────────────────────────────────────────────────
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),

  // ── App / DB Management ───────────────────────────────────────────────────
  getDbPath: () => ipcRenderer.invoke('app:getDbPath'),
  chooseDbFolder: () => ipcRenderer.invoke('app:chooseDbFolder'),
  exportDb: () => ipcRenderer.invoke('app:exportDb'),
  importDb: () => ipcRenderer.invoke('app:importDb'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  fetchImageUrl: (url) => ipcRenderer.invoke('app:fetchImageUrl', url),
  fetchImageAsBase64: (url) => ipcRenderer.invoke('app:fetchImageAsBase64', url),

  // ── Custom Tags ───────────────────────────────────────────────────────────
  getAllCustomTags: () => ipcRenderer.invoke('customTags:getAll'),
  createCustomTag: (data) => ipcRenderer.invoke('customTags:create', data),
  deleteCustomTag: (id) => ipcRenderer.invoke('customTags:delete', id),

  // ── RR Types ──────────────────────────────────────────────────────────────
  getAllRRTypes: () => ipcRenderer.invoke('rrTypes:getAll'),
  createRRType: (data) => ipcRenderer.invoke('rrTypes:create', data),
  deleteRRType: (id) => ipcRenderer.invoke('rrTypes:delete', id),
  getRRTypesForSetup: (setupId) => ipcRenderer.invoke('setups:getRRTypes', setupId),
  linkRRType: (setupId, rrTypeId) =>
    ipcRenderer.invoke('setups:linkRRType', { setupId, rrTypeId }),
  unlinkRRType: (setupId, rrTypeId) =>
    ipcRenderer.invoke('setups:unlinkRRType', { setupId, rrTypeId }),

  // ── Journal Entries ───────────────────────────────────────────────────────
  createJournal: (data) => ipcRenderer.invoke('journals:create', data),
  updateJournal: (data) => ipcRenderer.invoke('journals:update', data),
  deleteJournal: (id) => ipcRenderer.invoke('journals:delete', id),
  queryJournals: (filters) => ipcRenderer.invoke('journals:query', filters),
  getJournalSummary: (filters) => ipcRenderer.invoke('journals:getSummary', filters),
  getDistinctSymbols: () => ipcRenderer.invoke('journals:getDistinctSymbols'),
  bulkCreateJournals: (dataArray) => ipcRenderer.invoke('journals:bulkCreate', dataArray)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
