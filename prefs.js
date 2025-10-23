import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TrackerExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.tracker');

        // Create a new preferences page
        const page = new Adw.PreferencesPage({
            title: 'Tracker Backup', icon_name: 'document-save-symbolic',
        });
        window.add(page);

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

        // Add helper text for backup frequency
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

        // Add helper text for filename format
        const filenameHelperRow = new Adw.ActionRow({
            title: 'Timestamp placeholders: %Y, %m, %d, %H, %M, %S',
        });
        filenameHelperRow.add_css_class('caption');
        filenameHelperRow.add_css_class('dim-label');
        group.add(filenameHelperRow);
    }
}
