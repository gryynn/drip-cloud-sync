import { AsyncStorage } from 'react-native'
import { createClient } from '@supabase/supabase-js'
import NetInfo from '@react-native-community/netinfo'

import { mapRealmObjToJsObj, getCycleDaysSortedByDate, getCycleDay } from '../db'
import { addToQueue, flushQueue } from './sync-queue'

const APP_VERSION = require('../package.json').version

const MODIFIED_DATES_KEY = 'syncModifiedDates'
const LAST_FULL_SYNC_KEY = 'lastFullSyncDate'
const LAST_SYNC_KEY = 'lastSyncDate'

let supabase = null
let autoSyncEnabled = true
let netInfoUnsubscribe = null

// ---------------------------------------------------------------------------
// Modified dates tracking
// ---------------------------------------------------------------------------

async function getModifiedDates() {
  try {
    const raw = await AsyncStorage.getItem(MODIFIED_DATES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

async function addModifiedDate(date) {
  const dates = await getModifiedDates()
  if (!dates.includes(date)) {
    dates.push(date)
    await AsyncStorage.setItem(MODIFIED_DATES_KEY, JSON.stringify(dates))
  }
}

async function removeModifiedDate(date) {
  const dates = await getModifiedDates()
  const filtered = dates.filter((d) => d !== date)
  await AsyncStorage.setItem(MODIFIED_DATES_KEY, JSON.stringify(filtered))
}

async function clearModifiedDates() {
  await AsyncStorage.setItem(MODIFIED_DATES_KEY, JSON.stringify([]))
}

export { getModifiedDates }

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initSync() {
  try {
    const url = await AsyncStorage.getItem('supabaseUrl')
    const key = await AsyncStorage.getItem('supabaseAnonKey')
    const autoSync = await AsyncStorage.getItem('supabaseAutoSync')

    autoSyncEnabled = autoSync !== 'false'

    if (url && key) {
      supabase = createClient(url, key)
      setupNetworkListener()
    }
  } catch (e) {
    console.warn('Supabase sync init failed:', e)
  }
}

export function isConfigured() {
  return supabase !== null
}

export function getClient() {
  return supabase
}

export async function reconfigure(url, key) {
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe()
    netInfoUnsubscribe = null
  }

  if (url && key) {
    supabase = createClient(url, key)
    await AsyncStorage.setItem('supabaseUrl', url)
    await AsyncStorage.setItem('supabaseAnonKey', key)
    setupNetworkListener()
  } else {
    supabase = null
  }
}

export async function setAutoSync(enabled) {
  autoSyncEnabled = enabled
  await AsyncStorage.setItem('supabaseAutoSync', JSON.stringify(enabled))
}

export function isAutoSyncEnabled() {
  return autoSyncEnabled
}

// ---------------------------------------------------------------------------
// Sync log (debug helper → app_drip.sync_log)
// ---------------------------------------------------------------------------

async function logSync(action, cycleDate, details) {
  try {
    await supabase
      .schema('app_drip')
      .from('sync_log')
      .insert({ action, cycle_day_date: cycleDate, details: details || null })
  } catch (e) {
    // silent fail, just debug logging
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeCycleDay(cycleDayData) {
  const jsObj = mapRealmObjToJsObj(cycleDayData)

  return {
    date: jsObj.date,
    is_cycle_start: jsObj.isCycleStart || false,
    temperature: jsObj.temperature || null,
    bleeding: jsObj.bleeding || null,
    mucus: jsObj.mucus || null,
    cervix: jsObj.cervix || null,
    note: jsObj.note || null,
    desire: jsObj.desire || null,
    sex: jsObj.sex || null,
    pain: jsObj.pain || null,
    mood: jsObj.mood || null,
    synced_at: new Date().toISOString(),
    app_version: APP_VERSION,
  }
}

// ---------------------------------------------------------------------------
// Single day sync (called after each saveSymptom)
// ---------------------------------------------------------------------------

export async function syncCycleDay(date, cycleDayData) {
  if (!supabase || !autoSyncEnabled) {
    // Still track the modification even if sync is off
    if (supabase) await addModifiedDate(date)
    return
  }

  await addModifiedDate(date)

  const payload = serializeCycleDay(cycleDayData)

  try {
    const netState = await NetInfo.fetch()

    if (!netState.isConnected) {
      await addToQueue(date, payload)
      return
    }

    const { error } = await supabase
      .schema('app_drip')
      .from('cycle_days')
      .upsert(payload, { onConflict: 'date' })

    if (error) {
      console.warn('Supabase sync error, queuing:', error.message)
      await addToQueue(date, payload)
    } else {
      await removeModifiedDate(date)
      await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
      logSync('upsert', date)
    }
  } catch (e) {
    console.warn('Supabase sync exception, queuing:', e)
    await addToQueue(date, payload)
  }
}

// ---------------------------------------------------------------------------
// Incremental sync: flush only modified dates ("Sync maintenant")
// ---------------------------------------------------------------------------

export async function syncModifiedDays(onProgress) {
  if (!supabase) throw new Error('Supabase not configured')

  // Check if we need an initial full sync first
  const lastFull = await AsyncStorage.getItem(LAST_FULL_SYNC_KEY)
  if (!lastFull) {
    return syncAllCycleDays(onProgress)
  }

  const modifiedDates = await getModifiedDates()
  const total = modifiedDates.length
  if (total === 0) return 0

  const batchSize = 50
  let synced = 0

  for (let i = 0; i < total; i += batchSize) {
    const batch = []
    const dateBatch = modifiedDates.slice(i, i + batchSize)

    for (const date of dateBatch) {
      const cycleDay = getCycleDay(date)
      if (cycleDay) {
        batch.push(serializeCycleDay(cycleDay))
      }
    }

    if (batch.length > 0) {
      const { error } = await supabase
        .schema('app_drip')
        .from('cycle_days')
        .upsert(batch, { onConflict: 'date' })

      if (error) throw error
    }

    synced += dateBatch.length
    if (onProgress) onProgress(synced, total)
  }

  await clearModifiedDates()
  await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
  return synced
}

// ---------------------------------------------------------------------------
// Full sync: dump all CycleDays (initial sync or forced "Full resync")
// ---------------------------------------------------------------------------

export async function syncAllCycleDays(onProgress) {
  if (!supabase) throw new Error('Supabase not configured')

  const cycleDays = getCycleDaysSortedByDate()
  const total = cycleDays.length
  const batchSize = 50
  let synced = 0

  for (let i = 0; i < total; i += batchSize) {
    const batch = []
    const end = Math.min(i + batchSize, total)

    for (let j = i; j < end; j++) {
      batch.push(serializeCycleDay(cycleDays[j]))
    }

    const { error } = await supabase
      .schema('app_drip')
      .from('cycle_days')
      .upsert(batch, { onConflict: 'date' })

    if (error) throw error

    synced += batch.length
    if (onProgress) onProgress(synced, total)
  }

  const now = new Date().toISOString()
  await clearModifiedDates()
  await AsyncStorage.setItem(LAST_FULL_SYNC_KEY, now)
  await AsyncStorage.setItem(LAST_SYNC_KEY, now)
  logSync('full_sync', null, { count: synced })
  return synced
}

// ---------------------------------------------------------------------------
// Network listener – flushes queue when connectivity returns
// ---------------------------------------------------------------------------

function setupNetworkListener() {
  if (netInfoUnsubscribe) netInfoUnsubscribe()

  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && supabase) {
      flushQueue(async (payload) => {
        const { error } = await supabase
          .schema('app_drip')
          .from('cycle_days')
          .upsert(payload, { onConflict: 'date' })
        if (error) throw error
        await removeModifiedDate(payload.date)
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Connection test (settings button "Tester la connexion")
// ---------------------------------------------------------------------------

export async function testConnection() {
  if (!supabase) throw new Error('Supabase not configured')

  const { error } = await supabase
    .schema('app_drip')
    .from('cycle_days')
    .select('date')
    .limit(1)

  if (error) throw error
  return true
}
