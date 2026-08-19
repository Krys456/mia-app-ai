/**
 * #304A1 — Calendar Settings toggle model contracts.
 * Run: node --experimental-strip-types --test src/lib/calendarToggleModel.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('#304A1 calendar toggle model', () => {
  it('maps server statuses to ON/OFF correctly', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'src/lib/calendarToggleModel.ts')).href
    )

    const disconnected = mod.resolveCalendarToggleModel({
      connectionStatus: 'disconnected',
      service: 'available',
      phase: 'idle',
    })
    assert.equal(disconnected.visual, 'off')
    assert.equal(disconnected.statusLabel, 'Non connesso')
    assert.equal(disconnected.canEnable, true)
    assert.equal(disconnected.canDisable, false)

    const connected = mod.resolveCalendarToggleModel({
      connectionStatus: 'connected',
      accountEmail: 'a@b.c',
      service: 'available',
      phase: 'idle',
    })
    assert.equal(connected.visual, 'on')
    assert.equal(connected.statusLabel, 'Connesso')
    assert.equal(connected.showReadOnlyBadge, true)
    assert.equal(connected.accountEmail, 'a@b.c')
    assert.equal(connected.canDisable, true)
    assert.equal(connected.canEnable, false)

    const reconnect = mod.resolveCalendarToggleModel({
      connectionStatus: 'reconnect_required',
      service: 'available',
      phase: 'idle',
    })
    assert.equal(reconnect.visual, 'off')
    assert.equal(reconnect.statusCode, 'reconnect_required')
    assert.equal(reconnect.statusLabel, 'Riconnessione richiesta')
    assert.equal(reconnect.canEnable, true)

    const connecting = mod.resolveCalendarToggleModel({
      connectionStatus: 'disconnected',
      service: 'available',
      phase: 'connecting',
    })
    assert.equal(connecting.visual, 'off')
    assert.equal(connecting.statusCode, 'connecting')
    assert.equal(connecting.statusLabel, 'Connessione in corso…')
    assert.equal(connecting.toggleDisabled, true)

    const unavailable = mod.resolveCalendarToggleModel({
      connectionStatus: null,
      service: 'disabled',
      phase: 'idle',
    })
    assert.equal(unavailable.visual, 'off')
    assert.equal(unavailable.statusLabel, 'Non disponibile')
    assert.equal(unavailable.toggleDisabled, true)
    assert.equal(unavailable.canEnable, false)

    const revoked = mod.resolveCalendarToggleModel({
      connectionStatus: 'revoked',
      service: 'available',
      phase: 'idle',
    })
    assert.equal(revoked.visual, 'off')

    const err = mod.resolveCalendarToggleModel({
      connectionStatus: 'error',
      service: 'available',
      phase: 'idle',
    })
    assert.equal(err.visual, 'off')
  })

  it('wires Settings toggle to OAuth start / disconnect (not local preference)', () => {
    const ui = read('src/components/CalendarIntegrationsSettings.tsx')
    assert.match(ui, /resolveCalendarToggleModel/)
    assert.match(ui, /memory-toggle/)
    assert.match(ui, />\s*ON\s*</)
    assert.match(ui, />\s*OFF\s*</)
    assert.match(ui, /startGoogleCalendarOAuth/)
    assert.match(ui, /disconnectGoogleCalendar/)
    assert.match(ui, /fetchCalendarConnectionStatus/)
    assert.match(ui, /Sola lettura/)
    assert.match(ui, /Non disponibile/)
    // No localStorage preference for calendar on/off
    assert.doesNotMatch(ui, /localStorage/)
    assert.doesNotMatch(ui, /access_token|refresh_token/)
  })
})
