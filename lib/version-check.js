import { Alert, Linking } from 'react-native'
import { isConfigured, getClient } from './supabase-sync'

const LOCAL_VERSION = require('../package.json').version

export async function checkForUpdate() {
  if (!isConfigured()) return

  try {
    const { data, error } = await getClient()
      .schema('app_drip')
      .from('app_version')
      .select('version, release_notes, download_url')
      .limit(1)
      .single()

    if (error || !data) return

    if (data.version && data.version !== LOCAL_VERSION) {
      const notes = data.release_notes || ''
      const message = `${notes}\n\nCurrent: ${LOCAL_VERSION}\nNew: ${data.version}`

      Alert.alert(
        'Update available',
        message,
        [
          { text: 'Later', style: 'cancel' },
          ...(data.download_url
            ? [{
              text: 'Download',
              onPress: () => Linking.openURL(data.download_url),
            }]
            : []),
        ]
      )
    }
  } catch (e) {
    console.warn('Version check failed:', e)
  }
}
