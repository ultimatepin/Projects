# Rift Local

A local-first Riftbound companion with an English card browser, deck builder, private two-device tabletop over the same Wi-Fi, and a packaged Windows host.

## Install the Windows app

Run the one-click installer:

[`release/Rift-Local-Setup-1.3.4-x64.exe`](release/Rift-Local-Setup-1.3.4-x64.exe)

Windows may show a SmartScreen warning because this local build is not code-signed. Production releases should be signed; allow the firewall prompt on **Private networks only**.

Only one computer needs to host. Create a room there, copy the **full invite link**, and open that link on device two. Opening separate `localhost` copies creates separate room registries, so a code by itself cannot locate the other host.

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

The terminal prints addresses such as `http://192.168.1.42:3001`. Open that same address on both devices, choose **Play local**, then create and join a room with its full invite link. Keep the host terminal open during the match. If Windows asks about Node.js network access, allow it on **Private networks**.

For development with live reload, use `npm.cmd run dev` and open the printed Vite address (port 5173) on both devices.

## Included

- 950 currently cataloged English printings from Origins, Origins: Proving Grounds, Spiritforged, and Unleashed
- Search and filters for set, type, domain, rarity, and name
- All seven released ready-to-play Champion Decks: Jinx, Viktor, Lee Sin, Fiora, Rumble, Vi, and Vex
- Custom deck validation for one Legend, a 40-card Main Deck (including the Chosen Champion), 12 Runes, three uniquely named Battlefields, name-based copy limits, valid card types, and the current ban list
- Host-local username/password accounts with scrypt-hashed passwords, signed sessions, and per-account deck saves; guest decks remain available after sign-out
- Two-player LAN rooms with reconnect tokens, private hands, server-side shuffle, opening hands and mulligans, official turn phases, Runes, movement, showdowns, combat, Hold/Conquer scoring, burnout, and the 8-point strict-lead victory check
- A space-aware battle table with a large, wrapping hand, compact player rails, collapsed empty lanes, and inline legal actions
- Automatic Rune payment when playing a card, including legal exhaust/recycle sequencing and a before-you-play payment preview
- Effect-bound card decisions, beginning with Zaun Warrens' automatic discard/draw resolution
- Responsive layouts for desktop, tablet, and phone
- One-click Windows NSIS installer and in-app update center

Card metadata is bundled in `public/cards.json`; artwork loads from the image URLs in the catalog and has an in-app fallback if an image is unavailable. Run `npm.cmd run sync:cards` to refresh the catalog from the public [RiftScribe API](https://riftscribe.gg/api-docs).

Version 1.3.4 reallocates the battle screen around the cards in hand, removes redundant Rune-deck and Core-Rules panels, and replaces the large action drawer with contextual inline actions. Playing a card now exhausts and recycles the required Runes atomically on the host. Zaun Warrens' Conquer effect is the first vetted printed-card trigger to use the new private decision flow: it enters a Focus response window, then the app discards automatically when there is no choice or prompts the correct player before drawing. The rules engine implements the universal best-of-one Duel procedure from the [official Riftbound Rules Hub](https://playriftbound.com/en-us/rules-hub/) and Core Rules dated March 30, 2026. Other printed card abilities remain player-resolved through constrained, logged effect controls because the bundled public catalog does not include structured card rules, Champion tags, Signature markers, or complete domain requirements. The app therefore does not claim full automatic card-by-card rules enforcement.

Local accounts are stored only on the host computer and are not cloud accounts. Password and session traffic is accepted on loopback or HTTPS; account actions are intentionally disabled over unencrypted LAN HTTP. Remote devices can still use guest decks and play through the host invite.

## Verification

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
npm.cmd run test:lan
```

## Package and publish updates

Build an unsigned local installer:

```powershell
npm.cmd run icon
npm.cmd run package:win
```

The default update channel uses public GitHub Releases for `ultimatepin/Projects`. To publish a new version, increment `version`, set `GH_TOKEN` in a trusted release environment, and run `npm.cmd run release:win`. Clients can then use **Updates → Check for updates → Download update → Install & restart**. Building locally does not publish a release, so update checks will report that the channel is unavailable until the first release is uploaded. A generic immutable HTTPS feed can be used instead by setting `UPDATE_BASE_URL` at build time; its installer, blockmap, and `latest.yml` must be uploaded together.

Each version also gets a GitHub-ready Markdown draft in `release-notes/`. Copy `release-notes/TEMPLATE.md`, name it for the new version, fill in the user-visible changes and verification results, then paste it into the GitHub Release description. The completed v1.3.4 draft is in `release-notes/v1.3.4.md`.

Rift Local is an independent fan project and is not affiliated with or endorsed by Riot Games. Riftbound and related card artwork are property of their respective owners.
