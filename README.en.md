[简体中文](README.md) · **English**

<p align="center">
  <img src="docs/assets/interlude-banner.png" alt="Interlude banner" width="100%">
</p>

# Interlude

Interlude is a self-hosted web app for running tabletop RPG sessions in the browser. It supports D&D 5e (2014 and 2024 editions, 12 base classes each) and Call of Cthulhu 7th Edition (11 occupations). The web interface and the guides in `docs/` are in Chinese.

The host (DM or Keeper) manages libraries of CoC NPCs and monsters, D&D stat blocks, encounter plans, edition-specific spell and feat catalogs, and text-based scene atlases. Prep libraries import and export as JSON or Markdown, and [`docs/templates/`](docs/templates/) includes prompts for extracting NPCs and scenes from scenario text with an AI. Players generate attributes, allocate skill points or proficiencies, and submit characters for host review. D&D characters can prepare spells, track spell slots and class resources, and equip items with automatic AC, weapon attack, and encumbrance calculations.

Up to eight people join a room with a six-character code, including one host seat. The server rolls all dice and supports custom expressions, D&D advantage and disadvantage, CoC bonus and penalty dice, sanity checks, and secret host rolls. Rooms include text and image chat, scene publishing, a dark theme, an immersive view, and a mobile layout. Combat tools track per-participant initiative (with 2014 and 2024 surprise rules), split identical NPCs into separate HP pools, and optionally deduct HP automatically on targeted attacks and damage (accounting for temporary HP, selected resistances and vulnerabilities, and CoC armor). During play, the group can spend spell slots, take individual or batch rests, assign familiars or summons, and apply permanent stat adjustments or manual temporary effects. Unfinished sessions export as a ZIP archive, and players reclaim their seats with one-time codes when the archive is restored.

[Local setup](#local-setup) · [Basic workflow](#basic-workflow) · [Docker deployment](#docker-deployment) · [Data and storage](#data-and-storage) · [Documentation](#documentation)

## Local setup

Requires Node.js 22.12.0 or later.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. This starts the Vite frontend and the room server together. Vite forwards `/api` and Socket.IO traffic to `127.0.0.1:3001`.

For production, build the app before starting the server.

```sh
npm run build
npm start
```

The server listens on <http://127.0.0.1:3001> by default, with a health check at `/api/health`. Restart the process after editing `.env`. Fonts are bundled locally.

## Basic workflow

1. Select a ruleset and create a room. On the D&D home banner, switch between 2014 and 2024; the room, character sheets, and imported files must use the same edition. Other players select the same ruleset and edition and enter the six-character room code. Tabs in the same browser share one identity, so use a second browser or a private window to test multiple seats on one machine.
2. The host sets character creation rules such as attribute caps. Players create or import a character, configure skills, spells, and equipment, and submit the sheet for approval. The host seat does not load a player character.
3. Once at least one player is in the room, everyone is online and marked Ready, and all player characters are approved under the active room rules, the host starts the session.
4. Use the in-room panels to roll dice, publish scenes, run combat turns, and take rests. Export the room configuration to reuse its settings in a new room; to resume the current session, export a full session ZIP archive before stopping.

## Docker deployment

The repository includes a [Dockerfile](Dockerfile) and [compose.yaml](compose.yaml).

```sh
cp .env.example .env
# Set ALLOWED_ORIGINS in .env to your full site origin (including https://)
docker compose up -d --build
```

Compose binds to `127.0.0.1:3001` on the host and stores data in the `room-data` and `image-data` volumes. For public access, place Nginx or OpenResty in front with HTTPS. Enable WebSocket Upgrade on the reverse proxy, set `proxy_read_timeout` to at least 75 seconds, and set the request body limit to at least 12 MiB (`client_max_body_size 12m`).

### Environment variables

| Variable                          | Purpose                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST` / `PORT`                   | Bind address and port when running directly. Default `127.0.0.1:3001`. Fixed at `0.0.0.0:3001` inside the Compose container           |
| `DATA_DIR`                        | Data directory when running directly. Default `./data`. Fixed at `/app/data` in Compose                                               |
| `IMAGE_DIR`                       | Image directory when running directly. Defaults to `DATA_DIR/images`                                                                  |
| `IMAGE_STORAGE_PATH`              | Compose only. Host directory mounted for images; leave blank to use the `image-data` volume. Must be writable by container UID 1000   |
| `ALLOWED_ORIGINS`                 | Allowed site origins in full (including `https://`), separated by commas                                                              |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Optional. Enables the host inspiration window when configured. Set `GEMINI_MODEL` to a model ID available to your account             |

## Data and storage

The browser stores character sheets in `localStorage` and host prep libraries in IndexedDB. Data does not sync across devices, so export your files before switching computers or clearing browser storage. Bringing prep material into a room creates a session copy and leaves the browser original untouched.

The server writes room state to `DATA_DIR/rooms.json`. Closing the tab keeps your seat; clicking "Leave room" releases it. The server retains up to 200 rooms by default and deletes rooms where everyone has been offline and inactive for seven days.

Chat accepts PNG, JPEG, GIF, and WebP images up to 8 MiB per file. The server deletes images 14 days after the last session ends. Starting a new session resets that timer, and active sessions keep their images.

A session ZIP archive stores room settings, characters, stat adjustments, prep material, combat progress, and chat history. By default it saves server references for images, not the image files themselves; if you uncheck images during export, you enter a replacement text description for each image. For a full server backup or migration, copy the entire `DATA_DIR` (including `images.json`) together with the image directory.

## Documentation

The guides in `docs/` are in Chinese. Import templates and AI extraction prompts are in [`docs/templates/`](docs/templates/).

| Guide                                                                                                                 | Contents                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Usage guide](docs/USAGE.md)                                                                                          | Full workflow, room limits, and browser test setup                            |
| [Rules and character formats](docs/RULES.md)                                                                          | Calculated rules scope, file schemas, and attribution                         |
| [D&D editions](docs/DND-EDITIONS.md) · [Spells and feats](docs/DND-REFERENCES.md)                                     | 2014 vs. 2024 differences, spell and feat catalogs, and personal collections  |
| [Character and host prep](docs/CHARACTER-PREPARATION.md) · [Magic](docs/DND-MAGIC.md) · [Equipment](docs/DND-EQUIPMENT.md) | Spell preparation, slot tracking, equipment calculations, and party rests     |
| [D&D stat blocks](docs/DND-STATBLOCKS.md) · [Combat tools](docs/COMBAT.md)                                            | Monster stat blocks, encounter waves, initiative order, and automated damage  |
| [Character adjustments](docs/CHARACTER-ADJUSTMENTS.md)                                                                | In-session permanent stat changes and temporary effects                       |
| [CoC host library](docs/KEEPER.md) · [Scenario extraction](docs/KEEPER-IMPORT.md)                                     | Building NPCs and monsters, extracting material from scenarios                |
| [Atlases and scenes](docs/ATLAS.md)                                                                                   | Written location notes, scene search, and public visibility controls          |
| [Session archives](docs/SESSION-ARCHIVE.md)                                                                           | Exporting ZIPs, restoring sessions, seat claim codes, and image migration     |

## Development

The frontend uses React 19, TypeScript, and Vite 7. The server uses Express 5 and Socket.IO 4.

```sh
npm test          # Rule unit tests and Socket.IO integration tests
npm run typecheck # TypeScript type check
npm run build     # Type check and production build
```

Setup instructions for the Chromium end-to-end tests are in the [usage guide](docs/USAGE.md#浏览器验收), with results saved to `test-results/`.

```text
src/       Frontend pages, character editor, room panels, browser storage
shared/    Shared types, rule calculations, point allocation, import validation
server/    Room server, permissions, file storage, Gemini proxy
tests/     Rule unit tests, multiplayer session tests, browser E2E tests
docs/      Guides, rules notes, import templates, README assets
```

## Contributors

- Alex Xiao
- [Codex](https://github.com/codex) (OpenAI, AI contributor)

## Vibe coding disclosure

Vibe Coding was used during development, and ChatGPT contributed to the implementation.

## License

Code is released under the [MIT License](LICENSE), © 2026 Alex Xiao.

The repository does not bundle complete rulebooks or an official monster database. Attribution for referenced rules material is in [docs/RULES.md](docs/RULES.md). The interface uses Lucide icons and the DM Sans and Libre Caslon Display fonts.
