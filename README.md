# Punchout

Punchout is a habit tracker that runs entirely in the browser. There is no backend and no login: all data is stored in `localStorage`.

## Features
- Daily habit checklist with streaks
- Gym habits with a per-day exercise picker and up to 2 rest days per week
- Study habits with a per-day topic picker
- End-of-day bill receipt with print animation
- Backup and restore (export/import JSON)

## Why localStorage, no backend
Punchout is a single-file app. Your data stays on your device. Nothing is sent to a server.

## How to use Backup
Open Settings -> Backup. Export downloads a JSON file. Import restores from a file or pasted text. Undo last restore is available.

## Live link
https://marco07-tech.github.io/Punchout/

## Future scope
A Capacitor Android wrapper is scaffolded but not built or tested. No APK is provided.
