# Whisker App for Homey

This is the official Homey integration for Whisker devices, supporting the **Litter-Robot 3**, **Litter-Robot 4**, and **Pets**. It brings your Whisker devices into your Homey based smart home with automations, insights, and monitoring.

### 🙏 Special Thanks

This app builds on the work of [pylitterbot](https://github.com/natekspencer/pylitterbot) — huge thanks to [natekspencer](https://github.com/natekspencer) for figuring out the Whisker API and maintaining the Python integration!

## 🧠 Features

Bring automation and insights to your Whisker devices with Homey Flows and device capabilities:

### 📊 Litter-Robot 3 Capabilities

**Status & Monitoring:**
- `litter_robot_status` – Device status (ready, cycling, etc.)
- `clean_cycle_status` – Status of the cleaning cycle
- `alarm_connectivity` – Device connectivity status
- `last_seen` – When device was last online
- `alarm_problem` – Hardware fault detection

**Cat Detection & Presence:**
- `alarm_cat_detected` – Cat presence alarm

**Waste Management:**
- `alarm_waste_drawer_full` – Waste drawer full indicator
- `measure_waste_drawer_level_percentage` – Waste drawer fill level (%)
- `measure_clean_cycles_since_empty` – Cycles since last empty
- `measure_scoops_saved_count` – Estimated scoops saved
- `reset_waste_drawer` – Reset waste drawer counter

**Litter Management:**
- `measure_odometer_clean_cycles` – Total clean cycles

**Sleep Mode:**
- `alarm_sleep_mode_active` – Sleep mode is currently active
- `alarm_sleep_mode_scheduled` – Sleep mode is scheduled
- `sleep_mode_start_time` – When Sleep Mode activates
- `sleep_mode_end_time` – When Sleep Mode ends
- `sleep_mode_enabled` – Enable/disable sleep mode

**Controls & Settings:**
- `cycle_delay` – Set delay before cycle starts (3/7/15 minutes)
- `key_pad_lock_out` – Lock/unlock the keypad
- `night_light_enabled` – Enable/disable globe light
- `start_clean_cycle` – Start cleaning
- `onoff` – Power on/off

### 📊 Litter-Robot 4 Capabilities

**Status & Monitoring:**
- `litter_robot_status` – Device status (ready, cycling, etc.)
- `clean_cycle_status` – Status of the cleaning cycle
- `alarm_connectivity` – Device connectivity status
- `last_seen` – When device was last online

**Cat Detection & Presence:**
- `alarm_cat_detected` – Cat presence alarm
- `measure_weight` – Cat weight measurement (for pet tracking)

**Waste Management:**
- `alarm_waste_drawer_full` – Waste drawer full indicator
- `measure_waste_drawer_level_percentage` – Waste drawer fill level (%)
- `measure_scoops_saved_count` – Estimated scoops saved

**Litter Management:**
- `measure_litter_level_percentage` – Litter level (%)
- `measure_odometer_clean_cycles` – Total clean cycles

**LitterHopper:**
- `alarm_litter_hopper_empty` – LitterHopper empty alarm
- `litter_hopper_enabled` – Enable/disable LitterHopper control
- `litter_hopper_status` – LitterHopper status monitoring

**Sleep Mode:**
- `alarm_sleep_mode_active` – Sleep mode is currently active
- `alarm_sleep_mode_scheduled` – Sleep mode is scheduled
- `sleep_mode_start_time` – When Sleep Mode activates
- `sleep_mode_end_time` – When Sleep Mode ends

**Controls & Settings:**
- `clean_cycle_wait_time` – Set delay before cycle starts
- `key_pad_lock_out` – Lock/unlock the keypad
- `night_light_mode` – Off / On / Auto
- `panel_brightness` – Panel LED brightness
- `start_clean_cycle` – Start cleaning
- `start_empty_cycle` – Start emptying
- `short_reset_press` – Trigger soft reset

### Litter-Robot 5 / 5 Pro

A separate driver uses the LR5 REST API. Robot state refreshes every 30 seconds;
visit history has its own one-minute polling group so a history request cannot
block live state updates. Existing LR3/LR4/pet drivers and pairing/repair remain.

**Status and controls**

- Status, connectivity, cat detection, litter/drawer levels, weight and cycle/scoop counters.
- Power, cleaning, remote reset, waste-level reset, keypad lock, cycle delay
  (3/7/15/25/30 minutes), night-light settings and panel brightness.
- An exact 0–100% night-light slider. The existing preset Flow maps low/medium/high
  to 25/50/100%. Early LR5 test devices migrate without removal or re-pairing.
- Problem details for bonnet/drawer removal, dirty laser, motor/retract-motor,
  pinch/cat/USB/gas sensor and LitterHopper faults. Unknown non-clear motor values
  still raise a problem instead of silently appearing healthy.
- Read-only LitterHopper status, enabled/low/empty indicators and matching Flows.
  These capabilities appear when a hopper is attached and remain after removal
  so existing Flows are not deleted. No unverified dispense/enable command is exposed.

**Visits and pet information**

New Flow cards report any visit, a selected pet's visit, urine visits and feces
visits. Tokens include the explicit pet ID/name, weight in grams, duration in
seconds, waste type, validated waste weight, ISO timestamp and a delayed flag.
Each optional measurement has an availability flag: a numeric 0 with a false
flag is missing data, not a measured zero. Waste types are `Urine`, `Feces` or
`Unknown`. No health diagnosis is inferred from this data.

The driver filters mixed activities locally: the API can ignore a type filter.
It paginates at most ten 100-event pages per refresh, retains at most 1000 visits
in a rolling 48-hour window and exposes `up_to_date`, `partial`, `unavailable` or
`disabled` history status. Incomplete history is visible; it must not be treated
as proof that no visit occurred. Brief live presence states can still be missed
by status polling, but activity-based visits are recovered within the available
history window and pagination limit.

The first history synchronization populates statistics without replaying old
visits. Event IDs persist across app restarts to suppress duplicates. Later
arrivals are caught up once, and reassignment of the same event updates pet
statistics without creating another visit. Without an ID, a timestamp fallback
is used; events with identical timestamps cannot be distinguished in that case.
Only a single explicit Whisker pet ID counts toward that pet: ambiguous or
unidentified visits are never assigned by guessing from weight.

Robot and existing **Pet Information** devices show daily total/urine/feces
counts and the latest retained visit. Pet devices combine visits from multiple
LR5 robots and expose a separate last-visit weight without overwriting profile
weight. Robot counts use the robot timezone; pet counts use the Homey timezone.
Pet Information devices can be added through the existing pairing flow.

History can be disabled in the robot's device settings, which stops retrieval
and clears that device's stored history. Expired records are pruned on startup
and refresh; no cleanup can run while Homey is off. Pet names are cached in memory
for five minutes. Credentials and real account payloads are not included in tests.

**Maintenance and sleep schedules**

The device reports the filter replacement date, calendar days remaining and a
due alarm, with Flow trigger/condition cards. The confirmation action/button
sends `CHANGE_FILTER` only when explicitly invoked after a physical replacement;
installing or refreshing the app never resets maintenance counters.

Flow actions configure or disable the sleep schedule for one weekday or every
day, using strict `HH:mm` times in the robot timezone. Other days and API metadata
are preserved. As in pylitterbot's schedule parser, indices use Sunday=0; for an
overnight interval the selected API day is the wake-up day. The sleep switch
resumes configured days and does not enable empty schedules. Edits are serialized
and read the current schedule before writing to avoid losing another day's edit.

**Reliability and validation**

Polling awaits Homey writes and updates are serialized across reconnects.
Deleted/replaced connections and disabled history discard late responses. Cycle
counters establish a baseline without reporting historical cycles as new events.
Mutation requests are not replayed after transport failures, since the robot may
already have received the command.

The build is installed on Homey Pro with an LR5: availability, migration, history
retrieval, daily counts, filter countdown, healthy diagnostics and Flow-card
registration have been observed. Original pairing/status behavior was also
reported working by the user. Sleep/filter-reset controls are covered by mocked
API tests, not live setting changes; no such commands were executed for validation.
LR5 Pro parsing is covered by reference fixtures, not an LR5 Pro hardware test.
An attached LitterHopper, every individual control and prolonged operation still
need hardware validation. New feature text is in English and Dutch; existing
translations remain. Driver images reuse Whisker brand artwork.

Camera/video and firmware updates are outside this change. Protocol mappings and
sanitized reference fixtures derive from MIT-licensed
[pylitterbot](https://github.com/natekspencer/pylitterbot).
See `tests/fixtures/PYLITTERBOT-LICENSE` and `tests/fixtures/README.txt`.

### 🐱 Pet Information Capabilities

- `measure_weight` – Pet's current weight
- `label_gender` – Pet's gender
- `label_food` – Pet's diet information
- `label_environment` – Pet's environment type
- `label_birthday` – Pet's birthday
- `label_breed` – Pet's breed information
- `label_age` – Pet's age
- `alarm_health_concern` – Health concerns detected

### 🔁 Flow Triggers (When...)

**Litter-Robot 3:**
- Waste drawer becomes full
- Waste drawer is no longer full
- Cat detected
- Cat not detected
- Sleep mode activated
- Sleep mode deactivated
- Sleep mode becomes scheduled
- Sleep mode becomes unscheduled
- Multiple clean cycles completed
- Problem details provided
- A cleaning cycle is finished
- The cleaning status changes
- The Litter-Robot status changes
- Device goes offline
- Device comes back online

**Litter-Robot 4:**
- Waste drawer becomes full
- Waste drawer is no longer full
- Cat detected
- Cat not detected
- Sleep mode activated
- Sleep mode deactivated
- Multiple clean cycles completed
- Problem details provided
- LitterHopper becomes empty
- LitterHopper is no longer empty
- LitterHopper is enabled
- LitterHopper is disabled
- A cleaning cycle is finished
- The cleaning status changes
- The Litter-Robot status changes

**Pet Information:**
- Health concern detected
- Age changed
- Environment changed
- Diet changed

### 📥 Flow Conditions (And...)

**Litter-Robot 3:**
- Is a cat detected?
- Is sleep mode active?
- Is sleep mode scheduled?
- Is the waste drawer full?
- What is the current cleaning status?
- What is the current Litter-Robot status?

**Litter-Robot 4:**
- Is a cat detected?
- Is sleep mode active?
- Is sleep mode scheduled?
- Is the waste drawer full?
- Is the robot currently cleaning?
- Is the LitterHopper empty?
- Is the LitterHopper enabled?
- What is the current cleaning status?
- What is the current Litter-Robot status?

**Pet Information:**
- Is it the pet's birthday today?
- Is it X days until the pet's birthday?

### 🛠 Flow Actions (Then...)

**Litter-Robot 3:**
- Start a clean cycle
- Lock or unlock the keypad
- Turn on/off/toggle globe light
- Set cycle delay (3/7/15 minutes)
- Reset waste drawer

**Litter-Robot 4:**
- Start a clean cycle
- Start an empty cycle
- Lock or unlock the keypad
- Set night light mode (off/on/auto)
- Set panel brightness
- Set clean cycle wait time
- Press reset (short press)
- **Enable/disable LitterHopper**

## 📦 Supported Devices

- ✅ **Litter-Robot 3** - Full support with all capabilities
- ✅ **Litter-Robot 4** - Full support with all capabilities including LitterHopper
- 🟡 **Litter-Robot 5 / 5 Pro** - REST status, visit history, pet statistics, diagnostics, maintenance and sleep schedules; validation above
- ✅ **Pet Information** - Complete pet monitoring and health tracking
- 🟡 Feeder-Robot (integration planned — hardware sample needed)

> Support for additional Whisker devices would be great — but we'll need sample hardware to build and test those integrations.

## 🚀 Installation

You can try the app in two ways:

### ✅ Option 1: Install the test build via Homey App Store

👉 [Install the latest test version via Homey](https://homey.app/a/com.whisker/test/)

> Note: Can be used on both Homey Cloud as well as Homey Pro.

---

### 🛠️ Option 2: Manual installation via Homey CLI

```bash
git clone https://github.com/Doekse/whisker-homey.git
cd whisker-homey
npm install
homey app install
```


## Development checks

Use Node.js 24 or later for the current Homey CLI and the built-in Node test runner.
From the app directory, install dependencies and run:

```bash
npm ci
npm test
npm run lint
homey app validate --level publish
```

The tests use local fixtures and mocked transports/SDK methods; they do not need
Whisker credentials, a Homey or a connected robot. They cover both LR5 models, units, auth, transport, brightness migration,
startup/reconnect/delete races, paginated mixed activities, duplicates and
reassignments, partial history, per-pet aggregation, DST/calendar boundaries,
diagnostics, maintenance and serialized schedule edits.

To test on Homey Pro, sign in/select your Homey with the Homey CLI, then run
`homey app install` from this directory. The app ID remains `com.whisker`, so a
manual installation replaces the installed Whisker app on the selected Homey.
Existing LR3/LR4/pet drivers are retained. A later App Store update can replace
the manually installed version. Add the robot through
**Whisker → Litter-Robot 5 / 5 Pro** and sign in to Whisker when prompted.

Before reporting full hardware validation, compare readings with the Whisker
app, test supported controls and Flow transitions, and verify recovery after an
app restart and a network interruption. Do not publish passwords or tokens.
