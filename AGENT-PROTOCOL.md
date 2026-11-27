# Asking Hishor through Builder

Builder shows Hishor everything agents wait on. Plain questions need nothing special: stop and ask
in your terminal; Builder shows your pane's last lines and types his answer back into your pane.

For **design choices** and **reviews**, write a request file so he gets swipe cards and screenshots.

1. Find your pane: `herdr pane current` (looks like `w3:p1`).
2. Put your files in `~/projects/Builder/requests/<id>/` and write `~/projects/Builder/requests/<id>.json`.
   `<id>`: letters, digits, `-`, `_`, `.` only. File paths in the JSON are relative to `requests/`.
3. End your turn. His decision arrives as your next prompt, starting with `[Builder]`.
   It is also saved in `requests/<id>.answer.json`.

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

Approve without an `approve` field means: merge into `dev`, never `main`, and clean up the worktree. Hishor releases dev to main himself.
Deny comes with what to change: fix it and send a new review request (new `<id>`).
