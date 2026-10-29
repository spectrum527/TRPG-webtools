[简体中文](README.md) · **English**

<p align="center">
  <img src="docs/assets/interlude-banner.png" alt="Interlude banner" width="100%">
</p>

# Interlude · 幕间

Interlude is a web app for running tabletop RPG sessions with friends in the browser. You host it on your own server. It supports **D&D 5e (2014 / SRD 5.1)** and **Call of Cthulhu 7th Edition**.

The host (DM or Keeper) uses it to prepare sessions and review characters. Players use it to build characters, roll dice and post in the shared chat. If you don't finish in one sitting, export an archive and pick up from there next time. Interlude keeps the records and does the arithmetic. Rulings and the direction of the story are still up to the table.

The app interface is in Chinese. This README covers setup and the main workflow in English; the detailed guides under `docs/` are in Chinese only.

[Try it locally](#try-it-locally) · [Features](#features) · [Deployment](#deployment) · [Where data lives](#where-data-lives) · [Documentation](#documentation)

## Features

**Before the session**

- The host can keep a library of CoC NPCs and monsters, a library of D&D stat blocks, and a set of maps and scenes. All of them import and export as JSON or Markdown.
- The project ships with a prompt you can paste into an AI to turn the NPCs and scenes in a published scenario into importable files.
- Players join a room with a six-character code. A room holds up to eight people, one of whom takes the host seat. Room settings can be exported and imported for the next session.

**Characters and review**

- Players generate attributes, allocate skill points or choose proficiencies, then submit the character to the host for review.
- The host can set creation limits first, such as attribute caps. Characters that don't meet the current limits block the session from starting.

**During play**

- The server rolls the dice, so players can't tamper with results. You get custom dice expressions and D&D advantage/disadvantage, plus CoC bonus/penalty dice and sanity checks. The host can roll in secret.
- Post text and images, and the host can publish a scene for everyone to see. There's an immersive view, a dark theme and a mobile layout.
- Combat has a turn order. Several copies of the same NPC can be tracked as separate individuals with their own HP. Resources and inventory are tracked too, and the host can apply permanent adjustments or temporary effects mid-session.
- If your group roleplays elsewhere (another chat app, or in person), you can use Interlude just for dice and bookkeeping.

**Pausing and resuming**

- Room state is saved on the server. Reopen the page after a disconnect and you're back in your seat.
- Export the whole session as a ZIP archive. After it's restored, each player claims their character with a one-time seat code.

### What it doesn't do yet

- D&D covers the 12 SRD 5.1 classes. CoC covers 11 occupations, with occupation and personal-interest skill points.
- Spells, equipment effects and leveling up need to be checked by hand.
- A hit doesn't subtract HP automatically, and temporary effects don't expire on their own; the host turns them off.
- The atlas stores written descriptions of places and scenes. It doesn't draw battle maps.

See [rules and formats](docs/RULES.md) and [combat tools](docs/COMBAT.md) for details.

## Try it locally

You need Node.js 22.12.0 or later. Run these three commands in the project directory.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. This starts the frontend (Vite) and the room server together, and the frontend forwards `/api` and Socket.IO traffic to `127.0.0.1:3001`.

A typical session goes like this.

1. Pick a ruleset and create a room. Everyone else picks the same ruleset and enters the room code.
2. The host sets the character creation rules. Players create or import a character, allocate skills or choose proficiencies according to the room rules, and submit it for review.
3. The host can start once three things are true. There's at least one player; everyone is online and has clicked Ready; every player's character has been approved under the current rules.
4. Use the in-session tools to roll, post scenes and track status. Export an archive before you stop so you can resume next time.

To test with two people on one computer, open the second one in a different browser or a private window. A new tab in the same browser is still the same person. The host seat never loads a player character.

For a production run, build first and then start.

```sh
npm run build
npm start
```

The default address is <http://127.0.0.1:3001>, and the health check is at `/api/health`. Restart the server after editing `.env`. Fonts are bundled, so nothing is fetched from a font CDN.

## Deployment

The repo includes a [Dockerfile](Dockerfile) and [compose.yaml](compose.yaml).

```sh
cp .env.example .env
# Set ALLOWED_ORIGINS in .env to your site's address
docker compose up -d --build
```

Compose only listens on `127.0.0.1:3001` on the host and keeps data in two volumes, `room-data` and `image-data`. For public access, put Nginx or OpenResty in front with HTTPS. The reverse proxy needs three settings.

- WebSocket Upgrade enabled
- `proxy_read_timeout` of at least 75 seconds
- A request body limit of at least 12 MiB, e.g. `client_max_body_size 12m`

### Environment variables

| Variable                          | What it does                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST` / `PORT`                   | Address and port when running directly. Default `127.0.0.1:3001`. Inside the Compose container it's fixed at `0.0.0.0:3001`           |
| `DATA_DIR`                        | Data directory when running directly. Default `./data`. Compose uses `/app/data`                                                      |
| `IMAGE_DIR`                       | Image directory when running directly. Defaults to `DATA_DIR/images`                                                                  |
| `IMAGE_STORAGE_PATH`              | Compose only. A host directory for images; leave empty to use the `image-data` volume. Container UID 1000 must be able to write to it |
| `ALLOWED_ORIGINS`                 | Site addresses allowed to connect, written in full (with `https://`). Separate several with commas                                    |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Optional host inspiration assistant. Off when the key is empty                                                                        |

After deploying, check three things. The health endpoint responds; two browsers in the same room see each other's messages; pages reconnect after you restart the server.

Storage is plain files on disk, which suits a small site running one instance. Running several instances would need shared storage and a Socket.IO adapter.

## Where data lives

**In the browser**

Characters are stored in `localStorage` and prep libraries in IndexedDB. Nothing syncs between devices, so export before you switch computers or clear browser data.

Prep material you bring into a room is copied. Changes made during the session don't touch the original in your browser.

**On the server**

Room state is written to `DATA_DIR/rooms.json`. Closing the page keeps your seat; clicking "Leave room" gives it up. The server keeps up to 200 rooms by default, and a room is deleted after everyone has been offline and inactive for seven days.

**Who sees what**

Everyone in the room can see player character details and notes. Only the current host can see the NPC/monster library, private map notes and AI suggestions.

When the host rolls in secret, the others see that a roll happened and the dice expression or check name. They don't see the number or the outcome. Session credentials are checked by the server and never broadcast to the room.

**Images**

PNG, JPEG, GIF and WebP are accepted, up to 8 MiB each. Images are removed 14 days after the last session ends; playing again resets the clock, and images in an ongoing session are never removed. Image cleanup and room cleanup run on separate schedules.

**Archive ZIPs**

An archive holds the room settings, characters, adjustments, prep material, combat progress and all available chat history. It does not contain the image files. By default it keeps a reference to each image on the server; if you untick images, you write a text description to stand in for each one.

So for a full backup or a server move, copy the entire `DATA_DIR` (including `images.json`) together with the image directory.

The [usage guide](docs/USAGE.md) and [archive guide](docs/SESSION-ARCHIVE.md) have more on identity, moving images and storage locations.

## Optional: Gemini inspiration assistant

If the host gets stuck, Gemini can offer suggestions or draft a bit of narration. To turn it on, set `GEMINI_API_KEY` in `.env`, change `GEMINI_MODEL` to a model ID your account can use, and restart. The model ID in `.env.example` is only an example; the project doesn't check whether your account has access to it.

Gemini is only called when the host clicks Generate. The request contains the current scene, character names and occupations, the last 12 public text messages and the host's question. Images, session credentials, secret rolls and full character notes are never sent.

Results show up only in the host's own window and are never posted to the shared log. The API key stays on the server. Requests are at least 10 seconds apart and time out if Gemini doesn't answer.

The extraction prompt in the prep libraries is separate from this assistant, and you can use it with any AI. Before importing, double-check the numbers and make sure the public descriptions don't give away spoilers.

## Documentation

These guides are in Chinese.

| Guide                                                                               | Covers                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Usage guide](docs/USAGE.md)                                                        | Full walkthrough, limits, image storage and browser test setup |
| [Rules and character formats](docs/RULES.md)                                        | What each ruleset calculates, data formats and attribution     |
| [Character adjustments](docs/CHARACTER-ADJUSTMENTS.md)                              | Permanent values, temporary effects, versions and review       |
| [CoC host library](docs/KEEPER.md) · [Extraction and import](docs/KEEPER-IMPORT.md) | Building NPCs and monsters, pulling material from scenarios    |
| [D&D stat blocks](docs/DND-STATBLOCKS.md) · [Combat tools](docs/COMBAT.md)          | Prep data, combatants and the combat tools for both rulesets   |
| [Atlases and scenes](docs/ATLAS.md)                                                 | The atlas, scene search, and what's public versus private      |
| [Session archives](docs/SESSION-ARCHIVE.md)                                         | Exporting, restoring, claiming seats and image references      |

Import templates and the full extraction prompts are in [`docs/templates/`](docs/templates/).

## Development

Built with React 19, TypeScript, Vite 7, Express 5 and Socket.IO 4.

```sh
npm test          # Rule unit tests and integration tests against a real Socket.IO server
npm run typecheck # TypeScript type check
npm run build     # Type check, then production build
```

[GitHub CI](.github/workflows/ci.yml) runs tests and builds on Node.js 22 and 24 and audits production and development dependencies. It also walks through the app in Chromium (including native IndexedDB) and checks that the Docker image starts.

Setup for the browser test scripts is in the [usage guide](docs/USAGE.md#浏览器验收), and results go to `test-results/`. The Gemini tests use a mock server; to test against the real API you need to configure a key yourself.

```text
src/       Pages, character editor, room tools, browser storage
shared/    Types, rule calculations, point allocation, import validation
server/    Room server, permissions, file storage, Gemini proxy
tests/     Rule tests, multiplayer tests, browser tests
docs/      Guides, rules, templates, README images
```

## License

Code is under the [MIT License](LICENSE), © 2026 Alex Xiao.

The project doesn't include full rulebooks or an official monster database. Attribution for the referenced rules material is in the [rules guide](docs/RULES.md). The interface uses Lucide icons and the DM Sans and Libre Caslon Display fonts.
