import { AsyncStorage } from 'react-native'

const QUEUE_KEY = 'syncQueue'
const MAX_RETRIES = 3

let flushing = false

export async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    console.warn('Failed to read sync queue:', e)
    return []
  }
}

async function saveQueue(queue) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function addToQueue(date, data) {
  const queue = await getQueue()
  const filtered = queue.filter((item) => item.date !== date)
  filtered.push({ date, data, timestamp: Date.now(), retries: 0 })
  await saveQueue(filtered)
}

export async function getQueueLength() {
  const queue = await getQueue()
  return queue.length
}

export async function flushQueue(syncFn) {
  if (flushing) return
  flushing = true

  try {
    const queue = await getQueue()
    if (queue.length === 0) return

    queue.sort((a, b) => a.timestamp - b.timestamp)

    const remaining = []

    for (const item of queue) {
      try {
        await syncFn(item.data)
      } catch (e) {
        const retries = (item.retries || 0) + 1
        if (retries < MAX_RETRIES) {
          remaining.push({ ...item, retries })
        } else {
          console.warn(
            `Sync queue: dropped ${item.date} after ${MAX_RETRIES} retries`
          )
        }
      }
    }

    await saveQueue(remaining)
  } finally {
    flushing = false
  }
}
