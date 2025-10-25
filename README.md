# Tracker

Simple time tracking extension for Gnome.

![demo](https://raw.githubusercontent.com/aliakseiz/tracker/main/demo-01.gif)

Features:
- Multiple timers
- Start/Stop: easily start or pause individual timers with one click
- Reset: reset individual timers or all of them at once
- Edit name and time
- Selection: choose specific timers or display the total time
- Persistent storage: timers are automatically saved and restored between sessions
- Screen lock integration: automatically pauses all active timers when the screen is locked
- Workspace-based tracking: optionally associate timers with specific workspaces for better organization
- Keyboard navigation: easily edit timers using keyboard shortcuts (e.g., Tab, Enter, and Escape for editing)
- Export current timers to CSV
- Automatic backup: automatically export timers to CSV at configurable intervals 

![demo](https://raw.githubusercontent.com/aliakseiz/tracker/main/demo-02.png)

![demo](https://raw.githubusercontent.com/aliakseiz/tracker/main/demo-03.png)

## Backup Configuration

The extension now supports automatic backup functionality:

![demo](https://raw.githubusercontent.com/aliakseiz/tracker/main/backup-01.png)

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
