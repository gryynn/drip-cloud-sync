import { Alert, Linking } from 'react-native'
import { isConfigured, getClient } from './supabase-sync'

const LOCAL_VERSION = require('../package.json').version
const SCHEMA = 'app_drip'

export async function checkForUpdate() {
  if (!isConfigured()) return

  try {
    const cfg = getClient()
    const params = new URLSearchParams({
      select: 'version,release_notes,download_url',
      limit: 1,
    })
    const res = await fetch(
      cfg.url + '/rest/v1/app_version?' + params.toString(),
      {
        method: 'GET',
        headers: {
          apikey: cfg.key,
          Authorization: 'Bearer ' + cfg.key,
          'Accept-Profile': SCHEMA,
        },
      }
    )

    if (!res.ok) return

    const rows = await res.json()
    const data = rows && rows[0]
    if (!data) return

    if (data.version && data.version !== LOCAL_VERSION) {
      const notes = data.release_notes || ''
      const message = `${notes}\n\nCurrent: ${LOCAL_VERSION}\nNew: ${data.version}`

      Alert.alert('Update available', message, [
        { text: 'Later', style: 'cancel' },
        ...(data.download_url
          ? [
              {
                text: 'Download',
                onPress: () => Linking.openURL(data.download_url),
              },
            ]
          : []),
      ])
    }
  } catch (e) {
    console.warn('Version check failed:', e)
  }
}
