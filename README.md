# brb

Put a message on your camera from the terminal.

`brb` is a small command-line tool that sits **on top of [OBS Studio](https://obsproject.com)**. It doesn't capture
video or create a camera itself. It remote-controls OBS (over OBS's built-in WebSocket server) to change a text overlay,
and OBS's own **Virtual Camera** carries your picture into Meet, Zoom, Discord, and anything else that uses a camera. So
you need OBS installed and running.

```sh
brb "grabbing coffee" --in 5m   # "grabbing coffee / Back at 2:35 PM" on camera, cleared at 2:35
brb                             # "Be right back"
brb off                         # message gone
```

## Requirements

- **OBS Studio 28 or newer** (the WebSocket server is built in). Install it from official sources only:
  - Download: <https://obsproject.com/download>
  - Source and releases: <https://github.com/obsproject/obs-studio>
  - Linux (Flatpak): <https://flathub.org/apps/com.obsproject.Studio>
  - Windows (winget, published by OBS Project): `winget install OBSProject.OBSStudio`
- [Node.js](https://nodejs.org) 22 or newer, which provides `npx` (nothing else to install; no Deno or npm account
  needed).

For background on OBS's WebSocket server, see the official
[remote control guide](https://obsproject.com/kb/remote-control-guide).

## One-time setup

1. In OBS: **Tools → WebSocket Server Settings → Enable WebSocket server**. Set a password and copy it.
2. Export it: `OBS_WEBSOCKET_PASSWORD=...` (see [Config](#config)).
3. Run it straight from GitHub, with no install:

   ```sh
   npx github:EthanThatOneKid/brb "grabbing coffee"
   ```

   or install the short `brb` command once: `npm install -g github:EthanThatOneKid/brb`. The examples below assume that.

   Both follow the latest `main`. To pin a release, add its tag, for example `npx github:EthanThatOneKid/brb#v0.1.0`
   (see the [releases](https://github.com/EthanThatOneKid/brb/releases)). `brb --version` prints the installed version.
4. In OBS, make a scene that contains your camera (a **Video Capture Device** source) and make it the active scene. Then
   run `brb setup`. It adds a hidden text source named `brb-status` (white bold text on a dark box, lower-center).
   Repeat once per scene you want it in, or pass `--scene`.
5. In your call app, choose **OBS Virtual Camera** as the camera (see [the FAQ](#why-doesnt-my-meeting-show-the-text)).
   `brb` starts the virtual camera for you when it shows a message, or click **Start Virtual Camera** in OBS, or run
   `brb cam on`.

## Commands

| Command                          | What it does                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `brb [message...]`               | Show a message (default "Be right back"); starts the virtual camera if off. `\n` = line break      |
| `brb ... --in 5m`                | Append "Back at <time>", then clear it when the time is up (`5`, `5m`, `90s`, `1h30m`; bare = min) |
| `brb ... --no-cam`               | Show without auto-starting the virtual camera                                                      |
| `brb ... --color red --bg black` | Set text and background colors (see [Colors](#colors))                                             |
| `brb off` (`clear`, `hide`)      | Hide the message                                                                                   |
| `brb setup`                      | Add the text source to the current scene                                                           |
| `brb cam on\|off`                | Start/stop the virtual camera (on also wakes a webcam that has no video)                           |
| `brb ... --no-launch`            | Don't start OBS when it isn't running (messages, `setup`, and `cam on` start it by default)        |
| `brb stop`                       | Hide the message, stop the virtual camera, and release the webcam (light off)                      |
| `brb stop --quit-obs`            | Also close OBS (local only; refuses while recording or streaming)                                  |
| `brb status`                     | What viewers see right now                                                                         |
| `brb --version` (`-v`)           | Print the installed version                                                                        |
| `brb -- off`                     | Show the literal message "off"                                                                     |

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

| Setting            | Flag                  | Env                      | `brb.json` key    | Default                |
| ------------------ | --------------------- | ------------------------ | ----------------- | ---------------------- |
| OBS password       | `--password`          | `OBS_WEBSOCKET_PASSWORD` | not allowed       | none (required by OBS) |
| WebSocket URL      | `--url`               | `OBS_WEBSOCKET_URL`      | `url`             | `ws://127.0.0.1:4455`  |
| Text source name   | `--source`            | `BRB_SOURCE`             | `source`          | `brb-status`           |
| Scene              | `--scene`             |                          | `scene`           | current program scene  |
| Message (no words) |                       |                          | `message`         | `Be right back`        |
| Text color         | `--color`             |                          | `color`           | OBS source's own       |
| Background color   | `--bg`                |                          | `bg`              | OBS source's own       |
| Background opacity | `--bg-opacity`        |                          | `bgOpacity`       | 70 when `--bg` is set  |
| Start virtual cam  | `--no-cam`            |                          | `cam`             | `true`                 |
| Start OBS if off   | `--no-launch`         |                          | `launch`          | `true` (local URLs)    |
| OBS program path   |                       | `BRB_OBS_PATH`           | `obsPath`         | the usual install path |
| Read OBS password  | `--read-obs-password` |                          | `readObsPassword` | `false`                |

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

## Starting OBS and waking the webcam

- **OBS isn't running?** Showing a message, `brb setup`, and `brb cam on` start it (local URLs only), wait for its
  WebSocket server, and carry on. `off`, `status`, `stop`, and `cam off` never start it. Opt out with `--no-launch` or
  `"launch": false`. The default path is `%ProgramFiles%\obs-studio\bin\64bit\obs64.exe` on Windows, `OBS` on macOS, and
  `obs` on Linux; set `obsPath` or `BRB_OBS_PATH` for anywhere else.
- **Password prompt:** OBS keeps its WebSocket password in its own settings. `--read-obs-password` (or
  `"readObsPassword": true`, which is not a secret) lets `brb` read it from there when you haven't given one.
- **Black camera after OBS starts:** a webcam OBS hasn't really started can say it's active while sending no video. When
  turning the camera on, `brb` presses the source's Activate button on any webcam in the scene that has no video (a
  healthy camera is never touched), waits a few seconds for frames, and prints a warning if none arrive, which usually
  means another app is using the webcam.

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
- **A blank white or black frame:** first run `brb cam on`, which wakes a webcam that OBS thinks is running but isn't
  sending video (see [Why is my camera black?](#why-is-my-camera-black)). If it prints a warning, close any other app
  using the webcam. Otherwise OBS's camera source may need a resolution: double-click _Video Capture Device_ in OBS, set
  **Resolution/FPS Type** to _Custom_, and pick something like 1280x720.
- **Your picture but no text:** run `brb status`. "message hidden" means run `brb "..."`; "no brb-status source" means
  run `brb setup` in that scene.

### Why is my camera black?

The virtual camera is on, but OBS's webcam source isn't sending frames. This happens after `brb stop` followed by an OBS
restart, and it can also happen when another app has the webcam. OBS can mark the source "active" while the device never
started, so `brb status` still says "virtual camera on".

`brb cam on` and `brb "..."` fix it: they check the webcam sources in the current scene and, for any with no video,
press the source's own **Activate** button and wait a few seconds for frames. A camera that is already sending video is
never touched. If `brb` prints `warning: "Video Capture Device" still has no video`, something else has the webcam:
close the other app (a browser tab, Teams, Discord) and run `brb cam on` again.

Doing it by hand: in OBS, open the camera source's properties (double-click _Video Capture Device_) and click
**Activate**.

This needs a `brb` from after the fix. If you installed it earlier, update (`git pull` in a checkout, or reinstall).

### What if OBS isn't running?

`brb "..."`, `brb setup`, and `brb cam on` start it for you (local OBS only), wait until it has finished loading, and
carry on. `brb off`, `brb status`, `brb stop`, and `brb cam off` never start it. If OBS doesn't come up, `brb` says why:
an unreadable path means setting `obsPath` in `brb.json` (or `BRB_OBS_PATH`); a WebSocket that never opens means
enabling it under **Tools > WebSocket Server Settings**. Turn the behavior off with `--no-launch` or `"launch": false`.

If OBS asks for a password, `brb` needs `OBS_WEBSOCKET_PASSWORD`, or `--read-obs-password` to read it from OBS's own
settings. See [Starting OBS and waking the webcam](#starting-obs-and-waking-the-webcam).

### My message (and I) look mirrored in the call. Is `brb` flipping my camera?

No. `brb` and OBS send the correct, unflipped picture. Meet, Zoom and most other call apps mirror only your own
self-view, like a bathroom mirror, and send everyone else the real stream. Your tile shows reversed text; other people
read it normally. To check, ask someone in the call, or join from your phone and look at your tile.

Don't flip the camera in OBS to "fix" it: that would make your tile look normal but send everyone else a flipped you.

### Why is my camera light still on?

Because OBS still has your webcam open, and `brb off` only hides the text. OBS keeps the camera running for as long as
an active scene contains it, and stopping the virtual camera alone doesn't release it.

Run **`brb stop`**. It hides the message, stops the virtual camera, and releases the webcam in one go. The next
`brb "..."` turns everything back on (use `--no-cam` to show a message without waking the camera).

`brb stop` releases webcams that OBS exposes an on/off switch for, which today means DirectShow cameras on Windows. If
the light is still on, or you're on macOS/Linux, do it by hand:

1. Switch OBS to a scene that doesn't include your webcam. To make OBS release the webcam automatically whenever it
   isn't on screen, open the camera source's properties (double-click _Video Capture Device_) and tick **Deactivate when
   not showing**.
2. Quit OBS, which is the sure way to free the camera from OBS: run `brb stop --quit-obs`, or close it yourself.

If the light is still on after quitting OBS, another app (a browser tab, a call app) has the camera open.

## Known limits

What `brb` does not do, or has not been verified to do:

- **Tested by hand on Windows only.** CI runs the CLI against a fake OBS on Linux and Windows, but nothing has been run
  against a real OBS on macOS or Linux. The FreeType2 text source (no background box) and the non-DirectShow camera
  kinds are untested.
- **`brb stop` can't always turn the camera light off.** It releases DirectShow webcams (Windows) by switching the OBS
  source off. It doesn't release other camera kinds, and it can't free a camera that another app (a browser tab, a call
  app) is holding. The light going off is not something `brb` can confirm.
- **`brb stop` leaves OBS running unless you add `--quit-obs`.** OBS's WebSocket API has no quit request, so
  `--quit-obs` closes the process through the OS: it only works on the machine running OBS, and it asks OBS to close
  like clicking the X (never a force-kill). It refuses, before changing anything, if OBS is recording, streaming, or
  running the replay buffer, or if the process listening on the WebSocket port isn't OBS. If OBS shows a dialog (for
  example, unsaved settings) it may stay open, and `brb` says so. Verified on Windows only; macOS and Linux use `lsof`
  and `SIGTERM` and are untested.
- **Menu paths are from memory** and may differ by app version: Google Meet's camera picker, and the _Deactivate when
  not showing_ checkbox in OBS's camera properties.
- **Windows Hello's IR camera** (the separate "IR camera" on many laptops) has its own light, which OBS can't control.
- **Only the text overlay is managed.** `brb` doesn't create your camera scene or choose your resolution; set those up
  in OBS (see [the FAQ](#why-doesnt-my-meeting-show-the-text)).

## Development

You only need [Deno](https://deno.com) (for its fmt/lint/test tooling) and Node to work on `brb`. Users need only Node.

- `dist/brb.js` is the single file `npx` runs. It's built from the TypeScript source with `deno task build` and
  committed, so remember to rebuild (`deno task check` does it for you) before pushing.
- `deno task check` builds, then runs fmt, lint, type-check, and tests. The tests drive the CLI against `fake_obs.ts`, a
  small in-process obs-websocket v5 server, so they run without OBS. Each CLI test runs twice: the source on Deno and
  the shipped bundle on Node.
- `deno task brb ...` runs the source directly.
- CI (`.github/workflows/ci.yml`) runs the same tasks on every push and PR: format, lint, typecheck, a check that the
  committed `dist/brb.js` matches a fresh build, and the tests on Linux and Windows with Node 22 and 24. `main` is
  protected: changes land through a pull request once all five jobs are green.

## License

[MIT](LICENSE)
