import React, { Component } from 'react'
import { Alert, AsyncStorage, StyleSheet, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'

import AppPage from '../../common/app-page'
import AppText from '../../common/app-text'
import AppTextInput from '../../common/app-text-input'
import AppSwitch from '../../common/app-switch'
import Button from '../../common/button'
import Segment from '../../common/segment'

import {
  isConfigured,
  reconfigure,
  testConnection,
  syncModifiedDays,
  syncAllCycleDays,
  setAutoSync,
  isAutoSyncEnabled,
  getModifiedDates,
} from '../../../lib/supabase-sync'
import { getQueueLength } from '../../../lib/sync-queue'

import labels from '../../../i18n/en/settings'
import { Colors, Spacing } from '../../../styles'

const syncLabels = labels.supabaseSync

export default class SupabaseSync extends Component {
  constructor(props) {
    super(props)
    this.state = {
      url: '',
      anonKey: '',
      autoSync: true,
      lastSync: null,
      queueCount: 0,
      isOnline: true,
      isTesting: false,
      isSyncing: false,
      syncProgress: null,
    }
  }

  async componentDidMount() {
    const url = (await AsyncStorage.getItem('supabaseUrl')) || ''
    const anonKey = (await AsyncStorage.getItem('supabaseAnonKey')) || ''
    const lastSync = await AsyncStorage.getItem('lastSyncDate')
    const queueCount = await getQueueLength()
    const netState = await NetInfo.fetch()

    this.setState({
      url,
      anonKey,
      autoSync: isAutoSyncEnabled(),
      lastSync,
      queueCount,
      isOnline: netState.isConnected,
    })

    this.netInfoUnsub = NetInfo.addEventListener((state) => {
      this.setState({ isOnline: state.isConnected })
    })
  }

  componentWillUnmount() {
    if (this.netInfoUnsub) this.netInfoUnsub()
  }

  saveCredentials = async () => {
    const { url, anonKey } = this.state
    const trimmedUrl = url.trim()
    const trimmedKey = anonKey.trim()

    await reconfigure(
      trimmedUrl.length > 0 ? trimmedUrl : null,
      trimmedKey.length > 0 ? trimmedKey : null
    )

    Alert.alert(syncLabels.credentialsSaved)
  }

  handleTestConnection = async () => {
    this.setState({ isTesting: true })
    try {
      await testConnection()
      Alert.alert(syncLabels.testSuccess)
    } catch (e) {
      Alert.alert(syncLabels.testError, e.message)
    } finally {
      this.setState({ isTesting: false })
    }
  }

  handleSyncNow = async () => {
    this.setState({ isSyncing: true, syncProgress: null })
    try {
      const count = await syncModifiedDays((synced, total) => {
        this.setState({ syncProgress: `${synced} / ${total}` })
      })
      const now = new Date().toISOString()
      this.setState({
        lastSync: now,
        queueCount: await getQueueLength(),
        syncProgress: null,
      })
      Alert.alert(syncLabels.syncSuccess, `${count || 0} ${syncLabels.daysSynced}`)
    } catch (e) {
      Alert.alert(syncLabels.syncError, e.message)
    } finally {
      this.setState({ isSyncing: false })
    }
  }

  handleFullResync = async () => {
    Alert.alert(
      syncLabels.fullResyncTitle,
      syncLabels.fullResyncMessage,
      [
        { text: labels.menuItems.settings, style: 'cancel' },
        {
          text: syncLabels.fullResyncConfirm,
          onPress: async () => {
            this.setState({ isSyncing: true, syncProgress: null })
            try {
              const count = await syncAllCycleDays((synced, total) => {
                this.setState({ syncProgress: `${synced} / ${total}` })
              })
              const now = new Date().toISOString()
              this.setState({
                lastSync: now,
                queueCount: await getQueueLength(),
                syncProgress: null,
              })
              Alert.alert(syncLabels.syncSuccess, `${count} ${syncLabels.daysSynced}`)
            } catch (e) {
              Alert.alert(syncLabels.syncError, e.message)
            } finally {
              this.setState({ isSyncing: false })
            }
          },
        },
      ]
    )
  }

  handleToggleAutoSync = async (val) => {
    this.setState({ autoSync: val })
    await setAutoSync(val)
  }

  render() {
    const {
      url,
      anonKey,
      autoSync,
      lastSync,
      queueCount,
      isOnline,
      isTesting,
      isSyncing,
      syncProgress,
    } = this.state

    const configured = isConfigured()

    return (
      <AppPage>
        <Segment title={syncLabels.configTitle}>
          <AppText>{syncLabels.urlLabel}</AppText>
          <AppTextInput
            value={url}
            onChangeText={(val) => this.setState({ url: val })}
            placeholder="https://xxxxx.supabase.co"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppText style={styles.fieldLabel}>{syncLabels.keyLabel}</AppText>
          <AppTextInput
            value={anonKey}
            onChangeText={(val) => this.setState({ anonKey: val })}
            placeholder="eyJhbGciOi..."
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button isCTA onPress={this.saveCredentials}>
            {syncLabels.saveCredentials}
          </Button>
        </Segment>

        <Segment title={syncLabels.syncTitle}>
          <AppSwitch
            onToggle={this.handleToggleAutoSync}
            text={syncLabels.autoSyncLabel}
            value={autoSync}
          />

          {configured && (
            <View>
              <Button
                isCTA
                onPress={this.handleTestConnection}
                disabled={isTesting}
              >
                {isTesting ? syncLabels.testing : syncLabels.testButton}
              </Button>
              <Button
                isCTA
                onPress={this.handleSyncNow}
                disabled={isSyncing}
              >
                {isSyncing
                  ? syncProgress || syncLabels.syncing
                  : syncLabels.syncNowButton}
              </Button>
              <Button onPress={this.handleFullResync} disabled={isSyncing}>
                {syncLabels.fullResyncButton}
              </Button>
            </View>
          )}
        </Segment>

        <Segment title={syncLabels.statusTitle} last>
          <View style={styles.statusRow}>
            <AppText style={styles.statusLabel}>{syncLabels.networkStatus}</AppText>
            <AppText style={isOnline ? styles.online : styles.offline}>
              {isOnline ? syncLabels.online : syncLabels.offline}
            </AppText>
          </View>
          <View style={styles.statusRow}>
            <AppText style={styles.statusLabel}>{syncLabels.lastSyncLabel}</AppText>
            <AppText>
              {lastSync
                ? new Date(lastSync).toLocaleString()
                : syncLabels.never}
            </AppText>
          </View>
          <View style={styles.statusRow}>
            <AppText style={styles.statusLabel}>{syncLabels.queueLabel}</AppText>
            <AppText>{queueCount}</AppText>
          </View>
          <View style={styles.statusRow}>
            <AppText style={styles.statusLabel}>{syncLabels.configuredLabel}</AppText>
            <AppText>{configured ? syncLabels.yes : syncLabels.no}</AppText>
          </View>
        </Segment>
      </AppPage>
    )
  }
}

const styles = StyleSheet.create({
  fieldLabel: {
    marginTop: Spacing.base,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.tiny,
  },
  statusLabel: {
    color: Colors.grey,
  },
  online: {
    color: '#2e7d32',
  },
  offline: {
    color: Colors.orange,
  },
})
