# brb

Put a message on your camera from the terminal.

`brb` is a small command-line tool that sits **on top of [OBS Studio](https://obsproject.com)**. It doesn't capture
video or create a camera itself. It remote-controls OBS (over OBS's built-in WebSocket server) to change a text overlay,
and OBS's own **Virtual Camera** carries your picture into Meet, Zoom, Discord, and anything else that uses a camera. So
you need OBS installed and running.

```sh
brb "grabbing coffee" --in 5m   # "grabbing coffee / Back at 2:35 PM" on camera
brb                             # "Be right back"
brb off                         # message gone
```

## Requirements

- **OBS Studio 28 or newer** (the WebSocket server is built in). Install it from official sources only:
  - Download: <https://obsproject.com/download>
  - Source and releases: <https://github.com/obsproject/obs-studio>
  - Linux (Flatpak): <https://flathub.org/apps/com.obsproject.Studio>
  - Windows (winget, published by OBS Project): `winget install OBSProject.OBSStudio`
- [Deno](https://deno.com) to install and run `brb`.

For background on OBS's WebSocket server, see the official
[remote control guide](https://obsproject.com/kb/remote-control-guide).

## One-time setup

1. In OBS: **Tools → WebSocket Server Settings → Enable WebSocket server**. Set a password and copy it.
2. Export it: `OBS_WEBSOCKET_PASSWORD=...` (see [Config](#config)).
3. Clone this repo and run `deno task install`, or run `deno run -A main.ts ...` directly.
4. In OBS, make a scene that contains your camera (a **Video Capture Device** source) and make it the active scene. Then
   run `brb setup`. It adds a hidden text source named `brb-status` (white bold text on a dark box, lower-center).
   Repeat once per scene you want it in, or pass `--scene`.
5. In your call app, choose **OBS Virtual Camera** as the camera (see [the FAQ](#why-doesnt-my-meeting-show-the-text)).
   `brb` starts the virtual camera for you when it shows a message, or click **Start Virtual Camera** in OBS, or run
   `brb cam on`.

## Commands

| Command                          | What it does                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `brb [message...]`               | Show a message (default "Be right back"); starts the virtual camera if off. `\n` = line break |
| `brb ... --in 5m`                | Append "Back at <time>" (`5`, `5m`, `90s`, `1h30m`; bare = min)                               |
| `brb ... --no-cam`               | Show without auto-starting the virtual camera                                                 |
| `brb ... --color red --bg black` | Set text and background colors (see [Colors](#colors))                                        |
| `brb off` (`clear`, `hide`)      | Hide the message                                                                              |
| `brb setup`                      | Add the text source to the current scene                                                      |
| `brb cam on\|off`                | Start/stop the virtual camera                                                                 |
| `brb status`                     | What viewers see right now                                                                    |
| `brb -- off`                     | Show the literal message "off"                                                                |

## Colors

```sh
brb "heads down" --color white --bg "#1e3a8a"   # white text on a blue box
brb "stepping away" --color yellow --bg none      # no box
brb "back soon" --bg black --bg-opacity 100       # solid box
```

- `--color` and `--bg` take a name (`white black red green lime blue yellow orange purple pink cyan magenta gray`) or
  hex (`#ff8800`, `#f80`, or `ff8800`; quote `#` colors, since shells treat a bare `#` as a comment).
- `--bg none` removes the box. `--bg-opacity` is 0-100 and defaults to 70 when you set `--bg`.
- Styles **stick**: they're saved on the OBS source, so later `brb` calls keep them. Restore the defaults with
  `brb --color white --bg black --bg-opacity 70 "..."`. `brb setup` accepts the same flags for the initial look.
- On a FreeType2 text source (macOS/Linux) there is no background box, so only `--color` works.

## Config

Settings resolve in this order, first match wins: **flag → env var → `brb.json` → default**.

| Setting            | Flag           | Env                      | `brb.json` key | Default                |
| ------------------ | -------------- | ------------------------ | -------------- | ---------------------- |
| OBS password       | `--password`   | `OBS_WEBSOCKET_PASSWORD` | not allowed    | none (required by OBS) |
| WebSocket URL      | `--url`        | `OBS_WEBSOCKET_URL`      | `url`          | `ws://127.0.0.1:4455`  |
| Text source name   | `--source`     | `BRB_SOURCE`             | `source`       | `brb-status`           |
| Scene              | `--scene`      |                          | `scene`        | current program scene  |
| Message (no words) |                |                          | `message`      | `Be right back`        |
| Text color         | `--color`      |                          | `color`        | OBS source's own       |
| Background color   | `--bg`         |                          | `bg`           | OBS source's own       |
| Background opacity | `--bg-opacity` |                          | `bgOpacity`    | 70 when `--bg` is set  |
| Start virtual cam  | `--no-cam`     |                          | `cam`          | `true`                 |

Prefer the env var over `--password`, which lands in your shell history.

### `brb.json`: share your setup

Put a `brb.json` in a project folder (or in `~/.config/brb/brb.json` for everywhere) to share flag defaults with
teammates. `brb` uses the first file it finds: `--config <path>`, else `./brb.json`, else `~/.config/brb/brb.json`.

```json
{
  "message": "In a meeting, back soon",
  "color": "white",
  "bg": "#1e3a8a",
  "bgOpacity": 80,
  "cam": true
}
```

- The file is checked on every run: unknown keys, wrong types, and invalid JSON are errors, so typos don't pass quietly.
- **The OBS password can't go in it.** The file is meant to be committed and shared, so `brb` refuses a `password` key.
  Use `OBS_WEBSOCKET_PASSWORD`.
- If it sets `color`/`bg`, that look is re-applied on every message, so everyone using the file gets the same style.
- Skip `scene` in a shared file unless everyone names their scenes the same.

## FAQ

### Why doesn't my meeting show the text?

Because your call app is still using your regular webcam, and `brb` only changes what **OBS** sends. In the call app,
switch the camera to **OBS Virtual Camera**. In Google Meet, that's **⋮ → Settings → Video → Camera** (or the arrow next
to the camera button during a call). Zoom, Teams, and Discord have the same dropdown in their video settings. You may
need to reselect it after OBS restarts.

Still nothing? Check what you see:

- **The OBS logo:** the virtual camera isn't running. `brb` starts it unless you used `--no-cam` or `"cam": false`.
  `brb status` should say "virtual camera on".
- **Your desktop, or the wrong picture:** the active OBS scene decides what's sent. Switch OBS to the scene you ran
  `brb setup` in, and make sure it has your camera in it.
- **A blank white or black frame:** OBS's camera source needs a resolution. Double-click _Video Capture Device_ in OBS,
  set **Resolution/FPS Type** to _Custom_, pick something like 1280x720, and close any other app using the webcam.
- **Your picture but no text:** run `brb status`. "message hidden" means run `brb "..."`; "no brb-status source" means
  run `brb setup` in that scene.

### My message (and I) look mirrored in the call. Is `brb` flipping my camera?

No. `brb` and OBS send the correct, unflipped picture. Meet, Zoom and most other call apps mirror only your own
self-view, like a bathroom mirror, and send everyone else the real stream. Your tile shows reversed text; other people
read it normally. To check, ask someone in the call, or join from your phone and look at your tile.

Don't flip the camera in OBS to "fix" it: that would make your tile look normal but send everyone else a flipped you.

## Development

`deno task check` runs fmt, lint, type-check, and tests. The tests drive the real client and commands against
`fake_obs.ts`, a small in-process obs-websocket v5 server, so they run without OBS.
