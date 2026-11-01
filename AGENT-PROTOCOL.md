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
  "summary": "Design A with the big photo from C." }
```

Approve means: merge into `dev`, never `main`, and clean up the worktree. Hishor releases dev to main himself.
Deny comes with what to change: fix it and send a new review request (new `<id>`).
