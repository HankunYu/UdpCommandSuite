# UDP Command Host Tool

Electron-based desktop utility for broadcasting UDP command envelopes to Unity listeners (for example the `UdpCommandListener` component shipped alongside this toolkit) and for monitoring headset registrations emitted by `UdpClientReporter`.

## Prerequisites

- Node.js 18+ (enables Electron and native `dgram` UDP support)
- npm

## Getting Started

```bash
npm install
npm start
```

`npm start` launches the Electron shell with the command broadcaster UI.

## Features

- Broadcast or unicast UDP JSON envelopes to devices listening with `UdpCommandListener`
- Optional `cmdId` generation for de-duplication and acknowledgement workflows
- Automatic HMAC-SHA256 signature generation when a shared secret is provided
- Inline JSON validation and payload preview prior to dispatch
- Configurable host listener (default port `4949`) that captures reporter registration & heartbeat packets
- Responds to `DiscoverHost` probes with `HostAnnouncement` payloads so headsets can auto-populate the correct host IP/port
- Live log stream plus a real-time roster of registered clients (device name, IP, scene, platform, build)
- Card-based device grid with single-select / select-all controls to multicast commands and mark clients offline after 10 seconds with no heartbeat

## Packaging

```bash
npm run build
```

`npm run build` uses `electron-builder` to create distributables in `dist/`. On macOS run `npm run build -- --mac` for `.dmg/.zip`; add `--win` / `--linux` for other platforms.

## Notes

- Ensure your firewall allows inbound/outbound UDP traffic on the chosen listener port in addition to the gameplay port (default `3939`).
- Payload text must be valid JSON. The tool serialises the object prior to dispatch so `UdpCommandListener` receives the stringified payload expected by Unity.
- Registrations and heartbeats appear automatically; reapply the listen port if the socket closes or the port is already in use.
- Selecting multiple device cards broadcasts the same payload to every selected client; when no card is selected the manual target host/port fields are used instead.
- Host announcements update the manual target host/port fields so ad-hoc commands target the discovered device fleet.
