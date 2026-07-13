# Rift Local

A local-first Riftbound companion with a complete English card browser, deck builder, and private two-device tabletop over the same Wi-Fi.

## Run it on your Wi-Fi

Install and build once:

```powershell
npm.cmd install
npm.cmd run build
```

Start the local host:

```powershell
npm.cmd start
```

The terminal prints addresses such as `http://192.168.1.42:3001`. Open that same address on both devices, choose **Play local**, then create and join a room with the six-character code. Keep the host terminal open during the match. If Windows asks about Node.js network access, allow it on **Private networks**.

For development with live reload, use `npm.cmd run dev` and open the printed Vite address (port 5173) on both devices.

## Included

- 950 currently cataloged English printings from Origins, Origins: Proving Grounds, Spiritforged, and Unleashed
- Search and filters for set, type, domain, rarity, and name
- Device-local deck storage with Legend, Chosen Champion, 40-card main deck, 12-rune, and 3-unique-battlefield validation
- Two-player LAN rooms with reconnect tokens, private hands, server-side shuffle, draw, play, discard, exhaust, battlefield placement, score, energy, and turn controls
- Responsive layouts for desktop, tablet, and phone

Card metadata is bundled in `public/cards.json`; artwork loads from the image URLs in the catalog and has an in-app fallback if an image is unavailable. Run `npm.cmd run sync:cards` to refresh the catalog from the public [RiftScribe API](https://riftscribe.gg/api-docs).

The live table is intentionally a shared tabletop rather than an automated rules engine: players resolve card text and legal targets just as they would with physical cards, while the server protects hidden zones and synchronizes public state.

## Verification

```powershell
npm.cmd run build
npm.cmd run test:lan
```

Rift Local is an independent fan project and is not affiliated with or endorsed by Riot Games. Riftbound and related card artwork are property of their respective owners.
