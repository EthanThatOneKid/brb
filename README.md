# brb

Put a message on your camera from the terminal. Talks to [OBS](https://obsproject.com) over its built-in WebSocket
server, so anything that uses the **OBS Virtual Camera** (Meet, Zoom, Discord, ...) shows it.

```sh
brb "grabbing coffee" --in 5m   # "grabbing coffee / Back at 2:35 PM" on camera
brb                             # "Be right back"
brb off                         # message gone
```

## One-time setup

1. In OBS: **Tools → WebSocket Server Settings → Enable WebSocket server**. Set a password and copy it.
2. Export it: `OBS_WEBSOCKET_PASSWORD=...` (see [Config](#config)).
3. Install: `deno task install` (needs [Deno](https://deno.com)), or run `deno run -A main.ts ...` directly.
4. With your scene active in OBS, run `brb setup`. It adds a hidden text source named `brb-status` (white bold text on a
   dark box, lower-center). Repeat once per scene you want it in, or pass `--scene`.
5. Pick "OBS Virtual Camera" in your call app. `brb` starts the virtual camera for you when it shows a message (or click
   **Start Virtual Camera** in OBS, or `brb cam on`). Without it running, apps show the OBS logo.

## Commands

| Command                     | What it does                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `brb [message...]`          | Show a message (default "Be right back"); starts the virtual camera if off. `\n` = line break |
| `brb ... --in 5m`           | Append "Back at <time>" (`5`, `5m`, `90s`, `1h30m`; bare = min)                               |
| `brb ... --no-cam`          | Show without auto-starting the virtual camera                                                 |
| `brb off` (`clear`, `hide`) | Hide the message                                                                              |
| `brb setup`                 | Add the text source to the current scene                                                      |
| `brb cam on\|off`           | Start/stop the virtual camera                                                                 |
| `brb status`                | What viewers see right now                                                                    |
| `brb -- off`                | Show the literal message "off"                                                                |

## Config

| Env                      | Flag         | Default                |
| ------------------------ | ------------ | ---------------------- |
| `OBS_WEBSOCKET_PASSWORD` | `--password` | none (required by OBS) |
| `OBS_WEBSOCKET_URL`      | `--url`      | `ws://127.0.0.1:4455`  |
| `BRB_SOURCE`             | `--source`   | `brb-status`           |
|                          | `--scene`    | current program scene  |

Prefer the env var over `--password`, which lands in your shell history.

## FAQ

### My message (and I) look mirrored in the call. Is `brb` flipping my camera?

No. `brb` and OBS send the correct, unflipped picture. Meet, Zoom and most other call apps mirror only your own
self-view, like a bathroom mirror, and send everyone else the real stream. Your tile shows reversed text; other people
read it normally. To check, ask someone in the call, or join from your phone and look at your tile.

Don't flip the camera in OBS to "fix" it: that would make your tile look normal but send everyone else a flipped you.

## Development

`deno task check` runs fmt, lint, type-check, and tests. The tests drive the real client and commands against
`fake_obs.ts`, a small in-process obs-websocket v5 server, so they run without OBS.
