# drip-cloud-sync

A fork of [drip.](https://dripapp.org/) — the open-source menstrual cycle tracking app — with **one-way cloud sync to Supabase**.

Track your cycle on your phone. Consult your data from anywhere via Supabase.

## Why this fork

The original drip. app stores everything locally on-device using Realm. This is great for privacy, but makes it impossible to access your data from a computer, build dashboards, or create backups in the cloud.

This fork adds an optional, one-way sync module that pushes cycle data to a Supabase PostgreSQL backend. The local Realm database remains the source of truth — Supabase is a read-only mirror. If you never configure Supabase credentials, the app behaves exactly like the original.

## Features added

- **Auto sync** — every time a symptom is saved, that cycle day is upserted to Supabase
- **Offline queue** — if the device is offline, changes are queued in AsyncStorage and flushed automatically when connectivity returns (max 3 retries per entry)
- **Incremental sync** — a `modifiedDates` set tracks pending changes; "Sync now" only pushes what changed since the last sync; a full dump only happens on first sync or via "Full resync"
- **Version check** — at launch, the app reads `app_drip.app_version` and shows an update alert if a newer version is available
- **Settings screen** — Settings > Cloud Sync lets you enter credentials, toggle auto-sync, test the connection, trigger manual sync, and monitor sync status

## Supabase setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a new project (or use an existing one).

### 2. Expose the `app_drip` schema

In your Supabase dashboard:

1. Go to **Project Settings > API > Data API Settings**
2. Under **Exposed schemas**, add `app_drip`
3. Click **Save**

### 3. Run the migration SQL

Open the **SQL Editor** in your Supabase dashboard and run this script:

```sql
CREATE SCHEMA IF NOT EXISTS app_drip;

CREATE TABLE app_drip.cycle_days (
  date TEXT PRIMARY KEY,
  is_cycle_start BOOLEAN DEFAULT false,
  temperature JSONB,
  bleeding JSONB,
  mucus JSONB,
  cervix JSONB,
  note JSONB,
  desire JSONB,
  sex JSONB,
  pain JSONB,
  mood JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cycle_days_date ON app_drip.cycle_days (date DESC);
CREATE INDEX idx_cycle_days_is_cycle_start ON app_drip.cycle_days (date) WHERE is_cycle_start = true;
CREATE INDEX idx_cycle_days_synced_at ON app_drip.cycle_days (synced_at DESC);

CREATE OR REPLACE FUNCTION app_drip.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.synced_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_cycle_days_updated_at
  BEFORE UPDATE ON app_drip.cycle_days
  FOR EACH ROW
  EXECUTE FUNCTION app_drip.update_updated_at();

CREATE TABLE app_drip.app_version (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version TEXT NOT NULL,
  download_url TEXT,
  release_notes TEXT,
  released_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO app_drip.app_version (version, release_notes)
VALUES ('1.2207.10', 'Initial drip-cloud-sync release');

CREATE TABLE app_drip.sync_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action TEXT NOT NULL,
  details JSONB,
  cycle_day_date TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sync_log_created_at ON app_drip.sync_log (created_at DESC);

ALTER TABLE app_drip.cycle_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_drip.app_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_drip.sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_full_access_cycle_days" ON app_drip.cycle_days
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_app_version" ON app_drip.app_version
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_sync_log" ON app_drip.sync_log
  FOR ALL USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA app_drip TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA app_drip TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app_drip TO anon;
GRANT USAGE ON SCHEMA app_drip TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA app_drip TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app_drip TO authenticated;
```

### 4. Get your credentials

In your Supabase dashboard, go to **Project Settings > API**. Copy:

- **Project URL** (e.g. `https://xxxxx.supabase.co`)
- **anon public** key (starts with `eyJ...`)

## Building the Android APK

### Prerequisites

| Tool        | Version     | Notes                                                  |
| ----------- | ----------- | ------------------------------------------------------ |
| JDK         | 11          | JDK 17+ is NOT compatible with Gradle 6.3              |
| Android SDK | API 29      | via Android Studio or sdkmanager                       |
| Android NDK | 21.x (r21e) | NDK 22+ removed `platforms/` dir, causes build failure |
| Node.js     | 14.x        | Node 18+ breaks Metro 0.56 (OpenSSL incompatibility)   |
| npm         | 6.x         | ships with Node 14                                     |

### 1. Clone and install

```bash
git clone https://github.com/gryynn/drip-cloud-sync.git
cd drip-cloud-sync
# Use Node 14 for npm install
npm install
```

### 2. Configure `android/local.properties`

This file is gitignored. Create it with paths to your SDK and NDK:

```properties
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
ndk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk\\ndk\\21.4.7075529
```

### 3. Generate a signing keystore

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore android/app/release.keystore \
  -alias drip-cloud-sync -keyalg RSA -keysize 2048 -validity 10000
```

### 4. Configure signing credentials

Edit `android/gradle.properties` and replace the placeholder values:

```properties
RELEASE_STORE_FILE=release.keystore
RELEASE_STORE_PASSWORD=your_password_here
RELEASE_KEY_ALIAS=drip-cloud-sync
RELEASE_KEY_PASSWORD=your_password_here
```

### 5. Build

```bash
# Set environment
export JAVA_HOME="/path/to/jdk-11"
export ANDROID_HOME="/path/to/Android/Sdk"
export PATH="$JAVA_HOME/bin:$PATH"

# Build release APK
cd android && ./gradlew clean assembleRelease
```

The `react.gradle` script automatically uses Node 14 for JS bundling (configured in `android/app/build.gradle`). If your Node 14 is at a different path, set the `NODE14` environment variable:

```bash
export NODE14="/path/to/node14/node"
```

### 6. Install

The signed APK is at:

```
android/app/build/outputs/apk/release/app-release.apk
```

Install via USB:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Configuring sync in the app

1. Open the app and go to **Settings > Cloud Sync**
2. Enter your **Supabase URL** and **Anon Key**
3. Tap **Save credentials** — a toast confirms the save
4. Tap **Test connection** to verify connectivity
5. Toggle **Auto sync** on (enabled by default)
6. Tap **Sync now** — on first use, this performs a full upload of all existing cycle days

## Architecture

### Files added

| File                                         | Purpose                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| `lib/supabase-sync.js`                       | Core sync service — direct REST calls to PostgREST API (no SDK) |
| `lib/sync-queue.js`                          | Offline queue with AsyncStorage persistence and retry logic     |
| `lib/version-check.js`                       | Reads `app_drip.app_version` at launch, shows update alert      |
| `components/settings/supabase-sync/index.js` | Settings screen for credentials, sync controls, and status      |

### Files modified

| File                                   | Change                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `db/index.js`                          | Hooks `syncCycleDay()` after `saveSymptom` and import functions |
| `components/app-wrapper.js`            | Calls `initSync()` + `checkForUpdate()` at launch               |
| `components/settings/index.js`         | Exports the SupabaseSync component                              |
| `components/settings/settings-menu.js` | Adds Cloud Sync menu item                                       |
| `components/pages.js`                  | Adds SupabaseSync page routing                                  |
| `i18n/en/settings.js`                  | Labels for the sync settings screen                             |
| `i18n/en/labels.js`                    | Header title for SupabaseSync page                              |
| `android/app/build.gradle`             | Release signing config + Node 14 for JS bundling                |
| `android/build.gradle`                 | Subprojects buildscript repos fix (JCenter shutdown workaround) |

### How sync works

1. User saves a symptom -> `saveSymptom()` in `db/index.js` writes to Realm, then calls `syncCycleDay(date, data)`
2. `syncCycleDay` serializes the Realm object to JSON and POSTs to `POST /rest/v1/cycle_days` with `Prefer: resolution=merge-duplicates` (upsert)
3. If offline or the request fails, the payload is added to the offline queue
4. When connectivity returns, a NetInfo listener flushes the queue
5. The `modifiedDates` set in AsyncStorage tracks which dates have pending changes
6. "Sync now" reads `modifiedDates` and only syncs those days (incremental)
7. "Full resync" dumps all Realm cycle days regardless of `modifiedDates`

### Why no Supabase SDK?

`@supabase/supabase-js` v2 uses modern web APIs (`URL`, `Headers`, etc.) that are not available in React Native 0.61's JavaScriptCore engine. Instead, the sync module makes direct HTTP calls to the PostgREST API using `fetch`, with `Accept-Profile: app_drip` / `Content-Profile: app_drip` headers for schema selection.

## Known limitations

- **React Native 0.61** — this is a 2019 codebase; upgrading RN would require significant effort due to `nodejs-mobile-react-native` and other native dependencies
- **One-way sync only** — data flows from phone to Supabase, never the other way; Realm remains the source of truth
- **Single user** — no authentication; the anon key grants full access to the `app_drip` schema; suitable for personal/private Supabase projects
- **Node 14 required for building** — Metro 0.56 is incompatible with Node 18+ due to OpenSSL changes
- **NDK 21 required** — NDK 22+ removed the `platforms/` directory which causes a build failure in the native modules

## License

GPL-3.0-or-later — same as the [original drip. project](https://gitlab.com/bloodyhealth/drip).
