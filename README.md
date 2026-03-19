# Tracker

Simple time tracking extension for Gnome 45-50.

![demo](https://raw.githubusercontent.com/aliakseiz/tracker/main/demo-01.png)

Features:

- Start/Pause with a single click
- Workspace-based tracking: optionally associate timers with specific workspaces to automatically start/pause them upon switching
- Window-based tracking: optionally associate timers with specific windows titles to automatically start/pause on focus change
- Screen locking and sessions: automatically pauses all active timers on screen locking and resumes them on unlocking
- Persistent storage: timers are automatically saved and restored between sessions
- Automatic backup: automatically export timers to CSV at configurable intervals
- Export current timers to CSV manually
- Reset individual timers or all of them at once
- Selection: choose specific timers or display the total time
- Edit name and time

![demo](https://raw.githubusercontent.com/aliakseiz/tracker/main/demo-02.png)

1 - timer selector (to count the time instead of the total)
2 - timer name (editable)
3 - workspace indicator (optional, shows the associated workspace number)
4 - window title regex indicator (optional, indicates that the timer has a regex pattern)
5 - timer time (editable)
6 - expand button to access timer actions
7 - pause timer
8 - reset timer time
9 - edit timer name and time
10 - delete timer
11 - select "total time"
12 - total time label
13 - export
14 - pause all
15 - reset all
16 - add new timer
17 - open extension settings

## Automatic Timer Control

The extension supports automatic timer control based on workspace and window titles:

![auto](https://raw.githubusercontent.com/aliakseiz/tracker/main/auto-01.png)

Select a workspace to automatically resume/pause the timer when switching to/from that workspace.

Specify a regex pattern to match window titles (falls back to window WM_CLASS) to automatically resume/pause the timer when switching to/from a window
with a matching title.

To initiate the automatic control, start the timer first.

If the timer is paused manually, the extension will not automatically resume it when the workspace or window title changes.

## Backup Configuration

The extension now supports automatic backup functionality:

![backup](https://raw.githubusercontent.com/aliakseiz/tracker/main/backup-01.png)

1. **Enable automatic backup**: Toggle the "Enable automatic backup" setting
2. **Configure export path**: Set the directory where backup files will be saved (e.g., `~/timers` or `/home/user/backups`)
3. **Set export frequency**: Define how often backups should occur using format like:
    - `1h` for every hour
    - `30m` for every 30 minutes
    - `24h` for every day
4. **Customize filename format**: Use timestamp placeholders in filenames:
    - `%Y` - Year (e.g., 2025)
    - `%m` - Month (e.g., 09)
    - `%d` - Day (e.g., 24)
    - `%H` - Hour (e.g., 14)
    - `%M` - Minute (e.g., 30)
    - `%S` - Second (e.g., 45)

Backup files are saved in CSV format with headers "Name" and "Time".

# Install

[Gnome shell extensions](https://extensions.gnome.org/extension/7447/tracker/)

---

# License

[MIT](LICENSE)

[License-Url]: http://opensource.org/licenses/MIT

[License-Image]: https://img.shields.io/npm/l/express.svg
