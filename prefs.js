import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0;
const isWorkspaceId = v => Number.isInteger(v) && v >= 0;

export default class TrackerExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create and add the Backup page
        const backupPage = this._createBackupPage(settings);
        window.add(backupPage);

        // Create and add the Timers page
        const timersPage = this._createTimersPage(settings);
        window.add(timersPage);

        // Store settings reference for timer updates
        this._settings = settings;
        this._timersPage = timersPage;
        this._timerGroup = this._getTimerGroupFromPage(timersPage);

        // Listen for timer changes to update the UI
        this._timerChangedHandler = settings.connect('changed::timers', () => {
            this._updateTimersPage();
        });
    }

    _getTimerGroupFromPage(page) {
        // Get the first PreferencesGroup from the page
        let child = page.get_first_child();
        while (child) {
            if (child instanceof Adw.PreferencesGroup) {
                return child;
            }
            child = child.get_next_sibling();
        }
        return null;
    }

    _createBackupPage(settings) {
        // Create a new preferences page
        const page = new Adw.PreferencesPage({
            title: 'Backup', icon_name: 'document-save-symbolic',
        });

        // Create a preferences group for backup settings
        const group = new Adw.PreferencesGroup({
            title: 'Automatic Backup Settings', description: 'Configure automatic timer backups'
        });
        page.add(group);

        // Enable backup switch
        const enableRow = new Adw.ActionRow({
            title: 'Enable Automatic Backup',
        });
        enableRow.subtitle = 'Automatically save timers at configured intervals';
        const enableSwitch = new Gtk.Switch({
            active: settings.get_boolean('backup-enabled'), valign: Gtk.Align.CENTER,
        });
        enableSwitch.connect('notify::active', (switch_) => {
            settings.set_boolean('backup-enabled', switch_.active);
        });
        enableRow.add_suffix(enableSwitch);
        group.add(enableRow);

        // Backup path entry
        const pathRow = new Adw.EntryRow({
            title: 'Backup Path', text: settings.get_string('backup-path'),
        });
        pathRow.connect('changed', (entry) => {
            settings.set_string('backup-path', entry.text);
        });
        group.add(pathRow);

        // Add helper text for backup path
        const pathHelperRow = new Adw.ActionRow({
            title: 'Directory where backup files will be saved (e.g., ~/timers)',
        });
        pathHelperRow.add_css_class('caption');
        pathHelperRow.add_css_class('dim-label');
        group.add(pathHelperRow);

        // Backup frequency entry
        const frequencyRow = new Adw.EntryRow({
            title: 'Backup Frequency', text: settings.get_string('backup-frequency'),
        });
        frequencyRow.connect('changed', (entry) => {
            settings.set_string('backup-frequency', entry.text);
        });
        group.add(frequencyRow);

        // Helper for backup frequency
        const frequencyHelperRow = new Adw.ActionRow({
            title: 'How often to perform backups (e.g., 1h, 30m, 24h)',
        });
        frequencyHelperRow.add_css_class('caption');
        frequencyHelperRow.add_css_class('dim-label');
        group.add(frequencyHelperRow);

        // Filename format entry
        const filenameRow = new Adw.EntryRow({
            title: 'Filename Format', text: settings.get_string('backup-filename-format'),
        });
        filenameRow.connect('changed', (entry) => {
            settings.set_string('backup-filename-format', entry.text);
        });
        group.add(filenameRow);

        // Helper for filename format
        const filenameHelperRow = new Adw.ActionRow({
            title: 'Timestamp placeholders: %Y, %m, %d, %H, %M, %S',
        });
        filenameHelperRow.add_css_class('caption');
        filenameHelperRow.add_css_class('dim-label');
        group.add(filenameHelperRow);

        return page;
    }

    _createTimersPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Timers', icon_name: 'appointment-soon-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Automatic Timer Control',
            description: 'Optionally link timers to a workspace and/or a window title regex. Linked timers start when matched and pause when you switch away or focus a different window.',
        });
        page.add(group);

        this._timerGroup = group;

        // Load and display timers
        this._populateTimersGroup(group, settings);

        return page;
    }

    _populateTimersGroup(group, settings) {
        // Clear existing rows
        let child = group.get_first_child();
        while (child) {
            let next = child.get_next_sibling();
            group.remove(child);
            child = next;
        }

        // Get timers from settings
        const timersData = settings.get_strv('timers');
        const timers = [];

        timersData.forEach(data => {
            try {
                const item = JSON.parse(data);
                if (item.id !== 'settings') {
                    timers.push(item);
                }
            } catch (e) {
                console.log(`Error parsing timer: ${e.message}`);
            }
        });

        // Determine total workspace count by finding the max workspaceId in use
        // and providing a reasonable range (0-9 workspaces are common)
        let maxWorkspaceId = -1;
        timers.forEach(timer => {
            if (isWorkspaceId(timer.workspaceId) && timer.workspaceId > maxWorkspaceId) {
                maxWorkspaceId = timer.workspaceId;
            }
        });

        // Provide at least 4 workspaces, or use the max found + 1
        const totalWorkspaces = Math.max(4, maxWorkspaceId + 1);

        if (timers.length === 0) {
            // Show placeholder if no timers exist
            const placeholder = new Adw.ActionRow({
                title: 'No timers yet',
            });
            placeholder.add_css_class('dim-label');
            group.add(placeholder);
            return;
        }

        // Create expandable rows for each timer
        timers.forEach((timer, index) => {
            // Create expander row
            const expanderRow = new Adw.ExpanderRow({
                title: timer.name || '<empty>', subtitle: this._createTimerSubtitle(timer),
            });

            // Dropdown for workspace selection
            const model = new Gtk.StringList();
            model.append('No workspace');

            for (let i = 0; i < totalWorkspaces; i++) {
                model.append(`Workspace ${i}`);
            }

            const comboBox = new Adw.ComboRow({
                title: 'Workspace', model: model,
            });

            // Set active
            if (timer.workspaceId !== null && timer.workspaceId !== undefined) {
                comboBox.set_selected(timer.workspaceId + 1); // +1 because "No workspace" is at index 0
            } else {
                comboBox.set_selected(0); // "No workspace"
            }

            // Connect selection change
            comboBox.connect('notify::selected', (combo) => {
                const selected = combo.get_selected();
                const newWorkspaceId = selected === 0 ? null : selected - 1;

                // Update timer in settings
                const timersData = settings.get_strv('timers');
                const newTimersData = timersData.map(data => {
                    try {
                        const item = JSON.parse(data);
                        if (item.id === timer.id) {
                            item.workspaceId = newWorkspaceId;
                            // Ensure windowRegex is explicitly preserved (don't let JSON.stringify omit undefined)
                            if (item.windowRegex === undefined) {
                                item.windowRegex = null;
                            }
                        }
                        return JSON.stringify(item);
                    } catch (e) {
                        return data;
                    }
                });

                settings.set_strv('timers', newTimersData);

                // Update the subtitle with both workspace and regex status
                timer.workspaceId = newWorkspaceId;
                expanderRow.set_subtitle(this._createTimerSubtitle(timer));
            });

            expanderRow.add_row(comboBox);

            // Entry for window regex
            const regexEntry = new Adw.EntryRow({
                title: 'Window Regex', text: timer.windowRegex || '',
            });
            regexEntry.set_input_purpose(Gtk.InputPurpose.FREE_FORM);

            // Add placeholder with examples
            const placeholderText = 'e.g., /Calculator/ or /^(?!.*Huddle).*Slack/';
            regexEntry.connect('map', () => {
                const textWidget = regexEntry.get_delegate();
                if (textWidget) {
                    textWidget.set_placeholder_text(placeholderText);
                }
            });

            // Connect change event
            regexEntry.connect('changed', (entry) => {
                const newRegex = entry.text.trim();

                // Update timer in settings
                const timersData = settings.get_strv('timers');
                const newTimersData = timersData.map(data => {
                    try {
                        const item = JSON.parse(data);
                        if (item.id === timer.id) {
                            item.windowRegex = newRegex || null;
                            // Ensure workspaceId is explicitly preserved (don't let JSON.stringify omit undefined)
                            if (item.workspaceId === undefined) {
                                item.workspaceId = null;
                            }
                        }
                        return JSON.stringify(item);
                    } catch (e) {
                        return data;
                    }
                });

                settings.set_strv('timers', newTimersData);

                // Update the subtitle
                timer.windowRegex = newRegex || null;
                expanderRow.set_subtitle(this._createTimerSubtitle(timer));
            });

            expanderRow.add_row(regexEntry);
            group.add(expanderRow);
        });
    }

    _createTimerSubtitle(timer) {
        // Create subtitle showing workspace and regex status
        const hasWorkspace = timer.workspaceId !== null && timer.workspaceId !== undefined;
        const hasRegex = isNonEmptyString(timer.windowRegex);

        if (hasWorkspace && hasRegex) {
            return `Workspace ${timer.workspaceId} and Regex`;
        } else if (hasWorkspace) {
            return `Workspace ${timer.workspaceId}`;
        } else if (hasRegex) {
            return 'Window Regex';
        } else {
            return '';
        }
    }

    _updateTimersPage() {
        if (this._timerGroup && this._settings) {
            this._populateTimersGroup(this._timerGroup, this._settings);
        }
    }
}
