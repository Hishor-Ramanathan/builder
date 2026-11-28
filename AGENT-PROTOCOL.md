# Asking Hishor through Builder

Builder shows Hishor everything agents wait on. Plain questions need nothing special: stop and ask
in your terminal; Builder shows your pane's last lines and types his answer back into your pane.

For **design choices** and **reviews**, write a request file so he gets swipe cards and screenshots.

1. Find your pane: `herdr pane current` (looks like `w3:p1`).
2. Put your files in `~/projects/Builder/requests/<id>/` and write `~/projects/Builder/requests/<id>.json`.
   `<id>`: letters, digits, `-`, `_`, `.` only. File paths in the JSON are relative to `requests/`.
3. End your turn. His decision arrives as your next prompt, starting with `[Builder]`.
   It is also saved in `requests/<id>.answer.json`.
   If he deletes the request instead, you get `[Builder] <kind> <id>: dismissed ...`: drop that task, don't act on it.

## Pick (three options)

```json
{ "kind": "pick", "pane": "w3:p1", "project": "Thamarai", "title": "Event block",
  "created": "2026-11-01T10:00:00Z",
  "options": [
    { "label": "A", "html": "event-block/a.html", "note": "warm list" },
    { "label": "B", "image": "event-block/b.png" },
    { "label": "C", "html": "event-block/c.html" } ] }
```

`html` is shown in a sandboxed frame (no scripts), so make mockups static HTML with inline CSS
in Hishor's theme (`hishor-theme` skill). He can keep several; merge what he kept and follow his notes.

## Review (the real thing)

Build in your own worktree, run it, log in, open the right page, screenshot it.

```json
{ "kind": "review", "pane": "w3:p1", "project": "Thamarai", "title": "Event block",
  "created": "2026-11-01T11:00:00Z",
  "screenshot": "event-block/real.png", "url": "http://one:3004/admin/events",
  "tldr": "Event block: design A with C's big photo.",
  "summary": "Design A with the big photo from C." }
```

- `tldr` (required): one line, under ~80 characters, so Hishor knows what he is looking at. Shown big.
- `summary`: optional detail, folded away behind "Details".
- `approve`: optional, what you do on approve, e.g. `"upload to kDrive"`. It becomes the button text.
  Leave it out for code: approve then means merge into `dev`.

For a video (a render, a reel), put `"video": "<id>/file.mp4"` instead of or next to `"screenshot"`:
it plays in the card, also on iPhone and iPad.

### Time markers (video reviews)

While the video plays, Hishor can drop markers (button or `M` key): one moment or a start–end range,
each with a note. Add `"shots": [{ "at": 0, "dur": 1.3, "label": "Leinwand+Sofa" }, ...]` (seconds, the
current cut) and each marker also shows which shot is on screen. Markers come back in the answer,
sorted by time, on deny and on approve:
`[Builder] review <id>: denied | 3.1–5.3 s Text zu klein | 9.6 s falscher Gewinner | Notiz: ... | Fix this and send a new review request (new id).`
`[Builder] review <id>: APPROVED. Go ahead: upload to kDrive. | 9.6 s Logo größer`
As JSON in `requests/<id>.answer.json`: `markers: [{in, out, note}]` (`out` is `null` for a single moment).

Approve without an `approve` field means: merge into `dev`, never `main`, and clean up the worktree. Hishor releases dev to main himself.
Deny comes with what to change: fix it and send a new review request (new `<id>`).

## Media (shot picker)

Before you cut a video, let Hishor pick the shots. Catalog first, he picks, then you cut.

```json
{ "kind": "media", "pane": "w6:p1", "project": "Videos", "title": "Game Night: Shots wählen",
  "created": "2026-11-27T10:00:00Z",
  "tldr": "Wähle Clips und Fotos für den Reel.",
  "summary": "Gewinnerfoto bitte richtig wählen.",
  "items": [
    { "label": "V12", "video": "game-night/V12.mp4", "poster": "game-night/V12.jpg", "duration": 6.2,
      "note": "Mario Kart Überholmanöver" },
    { "label": "P61", "image": "game-night/P61.jpg", "note": "Gewinner 1 mit Umschlag" } ] }
```

- Put small proxies in `requests/<id>/`: 540p mp4 (`-movflags +faststart`), ~1080px jpg, and a poster jpg
  per clip. Builder only shows them, it never transcodes. Labels must be unique.
- He sees a grid (Alle / Videos / Fotos / Gewählt), takes shots in his order, sets start/end on clips,
  adds notes, reorders, and sends.
- His answer arrives as one line, in his order, times in seconds (no times = whole clip):
  `[Builder] media <id>: 1. V12 1.0–2.6 s | 2. P61 | 3. V16 1.5–3.0 s "nur der Jubel" | Notiz: ...`
  The same as JSON is in `requests/<id>.answer.json` under `picks`: `[{label, in, out, note}]` (`null` = not set).
