# UDP Command Suite

Reusable toolkit extracted from Mnemosyne VR that bundles:

- A Unity package (`com.mnemosyne.udpcommands`) containing `UdpCommandListener`, `UdpClientReporter`, and the supporting singleton base for receiving JSON UDP commands and reporting headset presence.
- An Electron host application (`udp-command-hosttool`) for broadcasting commands, handling acknowledgements, and managing connected client rosters.

## Layout

```
UdpCommandSuite/
  README.md
  unity/                # Unity Package Manager entry
    Runtime/
    Documentation~/
    package.json
  host-tool/            # Electron desktop app
    src/
    package.json
    package-lock.json
    README.md
```

## Using the Unity Package

1. Copy or clone this folder into a sibling directory next to your Unity project.
2. In your Unity project's `Packages/manifest.json`, add:
   ```json
   "com.mnemosyne.udpcommands": "file:../UdpCommandSuite/unity"
   ```
3. Unity will import the runtime assembly `Mnemosyne.UdpCommands`. Attach `UdpCommandListener` to a persistent GameObject and optionally pair it with `UdpClientReporter` for host discovery and heartbeats.
4. See `Documentation~/UDPCommandListener.md` for configuration details and JSON envelope formats.

## Using the Host Tool

```
cd host-tool
npm install
npm start
```

The app exposes a dashboard for sending commands, monitoring registrations, and responding to discovery probes. Build installers via `npm run build` (outputs to `dist/`).

## License

The code inherits the Mnemosyne VR project license (update as needed when publishing the new repository).
