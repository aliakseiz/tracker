/** extension.js
 * MIT License
 * Copyright © 2024 Aliaksei Zhuk
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 Debug with:
 dbus-run-session gnome-shell --devkit --wayland

 Logs:
 journalctl -f -o cat /usr/bin/gnome-shell
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const PauseType = {
    MANUAL: 'manual', // user clicked pause (no auto-resume)
    AUTO: 'auto',     // screen lock or workspace switch (auto-resume)
    SILENT: 'silent', // destroy (no effect on auto-resume)
};

const Tracker = GObject.registerClass(class Tracker extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Timer Tracker');

        this._label = new St.Label({
            text: 'Tracker', y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this.extension = extension;
        this._settings = this.extension.getSettings();

        this._timerUIElements = new Map();

        this._totalTimeSelected = true; // Default to total time selected
        this._loadTimers();

        this._buildMenu();

        this.menu.connect('menu-closed', () => {
            this._onMenuClosed();
        });

        this._screenShieldSignal = Main.screenShield.connect('active-changed', (shield, active) => {
            if (active) {
                this._onScreenLocked();
            } else {
                this._onScreenUnlocked();
            }
        });

        // Connect to workspace change signal
        this._workspaceSignal = global.workspace_manager.connect('active-workspace-changed', (wm, from, to) => {
            this._onWorkspaceChanged(wm, from, to);
        });

        // Listen for settings changes from prefs dialog
        this._timerSettingsChangedHandler = this._settings.connect('changed::timers', () => {
            this._onTimersSettingsChanged();
        });

        this._startPeriodicSave();

        // Initialize backup functionality
        this._initBackup();

        this._startTimers();

        this._syncWorkspaces();
    }

    _initBackup() {
        this._backupId = null;

        // Load backup settings
        this._backupEnabled = this._settings.get_boolean('backup-enabled');
        this._backupPath = this._settings.get_string('backup-path');
        this._backupFrequency = this._settings.get_string('backup-frequency');
        this._backupFilenameFormat = this._settings.get_string('backup-filename-format');

        // Start backup timer if enabled
        if (this._backupEnabled) {
            this._startBackupTimer();
        }

        // Listen for setting changes
        this._settings.connect('changed::backup-enabled', () => {
            this._backupEnabled = this._settings.get_boolean('backup-enabled');
            if (this._backupEnabled) {
                this._startBackupTimer();
            } else {
                this._stopBackupTimer();
            }
        });

        this._settings.connect('changed::backup-path', () => {
            this._backupPath = this._settings.get_string('backup-path');
        });

        this._settings.connect('changed::backup-frequency', () => {
            this._backupFrequency = this._settings.get_string('backup-frequency');
            if (this._backupEnabled) {
                this._stopBackupTimer();
                this._startBackupTimer();
            }
        });

        this._settings.connect('changed::backup-filename-format', () => {
            this._backupFilenameFormat = this._settings.get_string('backup-filename-format');
        });
    }

    _startBackupTimer() {
        this._stopBackupTimer();

        // Parse the frequency string
        const frequency = this._parseFrequency(this._backupFrequency);
        if (frequency > 0) {
            this._backupId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, frequency, () => {
                this._performBackup(false); // false = automatic backup
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _stopBackupTimer() {
        if (this._backupId) {
            GLib.source_remove(this._backupId);
            this._backupId = null;
        }
    }

    _parseFrequency(frequencyString) {
        // Parse frequency string like "1h", "30m"
        const regex = /^(\d+)([mh])$/;
        const match = frequencyString.match(regex);

        if (!match) {
            return 0; // Invalid format, don't schedule backup
        }

        const value = parseInt(match[1]);
        const unit = match[2];

        if (unit === 'm') {
            return value * 60; // Convert minutes to seconds
        } else if (unit === 'h') {
            return value * 3600; // Convert hours to seconds
        }

        return 0;
    }

    _performBackup(showNotification = true) {
        try {
            const csv = this._generateCsv();
            const filePath = this._getBackupFilePath();

            if (filePath) {
                let file = Gio.File.new_for_path(filePath);
                let stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

                stream.write_all(csv, null);
                stream.close(null);

                // Show notification only if requested (manual backups)
                if (showNotification) {
                    const systemSource = MessageTray.getSystemSource();
                    const notification = new MessageTray.Notification({
                        source: systemSource, title: _('Tracker Backup'), body: _(`Backup saved to: ${filePath}`),
                    });

                    systemSource.addNotification(notification);
                }
            }
        } catch (err) {
            console.log(`Error performing backup: ${err.message}`);
        }
    }

    _generateCsv() {
        const DELIMITER = ',';
        const NEWLINE = '\n';

        // Create headers
        let csv = `Name${DELIMITER}Time${NEWLINE}`;

        // Populate rows
        this._timers.forEach(timer => {
            // Escape commas and wrap in quotes
            let name = `"${timer.name.replace(/"/g, '""')}"`;
            let time = this._formatTime(timer.timeElapsed);
            csv += `${name}${DELIMITER}${time}${NEWLINE}`;
        });

        return csv;
    }

    _getBackupFilePath() {
        try {
            // Expand ~ to home directory
            let path = this._backupPath.replace(/^~\//, GLib.get_home_dir() + '/');

            // Ensure directory exists
            const dir = Gio.File.new_for_path(path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            // Generate filename with timestamp
            const fileName = this._formatBackupFilename();
            const fullPath = GLib.build_filenamev([dir.get_path(), fileName]);

            return fullPath;
        } catch (err) {
            console.log(`Error creating backup file path: ${err.message}`);
            return null;
        }
    }

    _formatBackupFilename() {
        // Get current timestamp
        const now = GLib.DateTime.new_now_local();

        // Replace placeholders in filename format
        let formatted = this._backupFilenameFormat
            .replace(/%Y/g, now.format('%Y'))
            .replace(/%m/g, now.format('%m'))
            .replace(/%d/g, now.format('%d'))
            .replace(/%H/g, now.format('%H'))
            .replace(/%M/g, now.format('%M'))
            .replace(/%S/g, now.format('%S'));

        // Add .csv extension if not present
        if (!formatted.endsWith('.csv')) {
            formatted += '.csv';
        }

        return formatted;
    }

    _resetEditingState(timer) {
        let uiElements = this._timerUIElements.get(timer.id);
        if (!uiElements) {
            console.log(`Error: UI elements not found for timer "${timer.name}"`);
            return;
        }

        let {
            mainRow, nameLabel, timeLabel, eyeButton, expandButton, clearButton, editButton, deleteButton, actionsRow
        } = uiElements;

        // Check if timer is actually in editing mode
        if (!timer.isEditing) {
            return;
        }

        let nameEntry = timer.editEntries?.nameEntry;
        let timeEntry = timer.editEntries?.timeEntry;
        let saveButton = timer.saveButton;
        let cancelButton = timer.cancelButton;

        // Replace the entries with the original labels
        if (nameEntry && nameEntry.get_parent && nameEntry.get_parent()) {
            let nameEntryParent = nameEntry.get_parent();
            if (nameEntryParent && nameEntryParent.contains(nameEntry)) {
                nameEntryParent.replace_child(nameEntry, nameLabel);
            }
        }

        if (timeEntry && timeEntry.get_parent && timeEntry.get_parent()) {
            let timeEntryParent = timeEntry.get_parent();
            if (timeEntryParent && timeEntryParent.contains(timeEntry)) {
                timeEntryParent.replace_child(timeEntry, timeLabel);
            }
        }

        // Remove Save and Cancel buttons from actions row
        if (saveButton && saveButton.get_parent && saveButton.get_parent() === actionsRow) {
            actionsRow.remove_child(saveButton);
        }
        if (cancelButton && cancelButton.get_parent && cancelButton.get_parent() === actionsRow) {
            actionsRow.remove_child(cancelButton);
        }

        // Restore padding to normal state
        mainRow.remove_style_class_name('timer-edit');

        // Show the previously hidden elements
        eyeButton.show();
        expandButton.show();
        clearButton.show();
        editButton.show();
        deleteButton.show();
        timeLabel.show();

        // Reset the editing state
        timer.isEditing = false;
        timer.editEntries = null;
        timer.saveButton = null;
        timer.cancelButton = null;
    }


    _loadTimers() {
        let timersData = this._settings.get_strv('timers');
        this._timers = [];
        this._totalTimeSelected = true; // Default value

        timersData.forEach(data => {
            let item = JSON.parse(data);
            if (item.id === 'settings') {
                this._totalTimeSelected = item.totalTimeSelected !== undefined ? item.totalTimeSelected : true;
            } else {
                let timer = item;
                if (!timer.id) {
                    timer.id = GLib.uuid_string_random();
                }
                // Set timers to paused state upon loading
                timer.running = false;
                timer.lastUpdateTime = null;
                if (timer.autoResume === undefined) {
                    timer.autoResume = false;
                }

                this._timers.push(timer);
            }
        });
    }

    _saveTimers() {
        let timersData = this._timers.map(timer => {
            let timerCopy = {...timer};
            delete timerCopy.lastUpdateTime;
            return JSON.stringify(timerCopy);
        });

        // Add settings data
        let settingsData = {
            id: 'settings', totalTimeSelected: this._totalTimeSelected
        };
        timersData.push(JSON.stringify(settingsData));

        this._settings.set_strv('timers', timersData);
    }

    _buildMenu() {
        this.menu.removeAll();

        // Timers list
        this._timersSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._timersSection);

        // Add timers to the list
        this._timers.forEach(timer => {
            this._addTimerItem(timer);
        });

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Buttons row
        let summaryRow = new PopupMenu.PopupBaseMenuItem({
            reactive: false, style_class: 'summary-row',
        });

        let summaryWrapper = new St.BoxLayout({
            vertical: false, x_expand: true, style_class: 'summary-wrapper',
        });

        // Left container for the total time eye button and label
        let leftContainer = new St.BoxLayout({
            vertical: false, x_expand: true, style_class: 'left-container', y_align: Clutter.ActorAlign.CENTER,
        });

        // Right container for the action buttons
        let rightContainer = new St.BoxLayout({
            vertical: false, x_expand: false, style_class: 'right-container', y_align: Clutter.ActorAlign.CENTER,
        });

        // Total time eye button
        this._totalTimeEyeIcon = new St.Icon({
            icon_name: this._totalTimeSelected ? 'selection-mode-symbolic' : 'radio-symbolic', style_class: 'timer-icon',
        });

        this._totalTimeEyeButton = new St.Button({child: this._totalTimeEyeIcon});
        this._totalTimeEyeButton.connect('clicked', () => {
            this._toggleTotalTimeSelection();
        });
        summaryRow.add_child(this._totalTimeEyeButton);

        this._totalTimeLabel = new St.Label({text: 'Total: 00:00:00', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        summaryRow.add_child(this._totalTimeLabel);

        // Download CSV button
        let downloadCsvButton = new St.Button({child: new St.Icon({icon_name: 'document-save-symbolic'}), style_class: 'timer-icon-button button'});
        downloadCsvButton.connect('clicked', () => {
            this._downloadCsv();
        });
        rightContainer.add_child(downloadCsvButton);

        // Pause all timers button
        let pauseAllButton = new St.Button({
            child: new St.Icon({icon_name: 'media-playback-pause-symbolic'}), style_class: 'timer-icon-button button'
        });
        pauseAllButton.connect('clicked', () => {
            this._pauseAllTimers(PauseType.MANUAL);
        });
        rightContainer.add_child(pauseAllButton);

        // Total time reset button
        let totalResetButton = new St.Button({child: new St.Icon({icon_name: 'edit-clear-all-symbolic'}), style_class: 'timer-icon-button button'});
        totalResetButton.connect('clicked', () => {
            this._resetAllTimers();
        });
        rightContainer.add_child(totalResetButton);

        // Add new timer button
        let addButton = new St.Button({child: new St.Icon({icon_name: 'list-add-symbolic'}), style_class: 'timer-icon-button button'});
        addButton.connect('clicked', () => {
            this._addNewTimer();
        });
        rightContainer.add_child(addButton);

        // Assemble the buttons container
        summaryWrapper.add_child(leftContainer);
        summaryWrapper.add_child(rightContainer);

        // Add to summary row
        summaryRow.add_child(summaryWrapper);
        this.menu.addMenuItem(summaryRow);
    }

    _resetAllTimers() {
        let currentTime = GLib.get_real_time();

        this._timers.forEach(timer => {
            timer.timeElapsed = 0;

            // If the timer is running, reset the lastUpdateTime to current time
            if (timer.running) {
                timer.lastUpdateTime = currentTime;
            }

            // Update UI
            let uiElements = this._timerUIElements.get(timer.id);
            if (uiElements && uiElements.timeLabel) {
                uiElements.timeLabel.text = this._formatTime(timer.timeElapsed);
            }
        });

        // Update total time labels
        this._updateTotalTime();
        this._updatePanelLabel();

        this._saveTimers();
    }

    _startPeriodicSave() {
        this._periodicSaveId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._saveTimers();
            return GLib.SOURCE_CONTINUE;
        });
    }


    _addTimerItem(timer) {
        // Initialize expanded state if not already set
        if (timer.expanded === undefined) {
            timer.expanded = false;
        }

        // First row, main timer info
        let timerMainRow = new PopupMenu.PopupBaseMenuItem({
            style_class: 'timer-item-row', activate: false, reactive: true, can_focus: true,
        });

        // Checkbox icon
        let eyeIcon = new St.Icon({icon_name: timer.selected ? 'selection-mode-symbolic' : 'radio-symbolic', style_class: 'timer-icon'});
        let eyeButton = new St.Button({child: eyeIcon, style_class: 'timer-selector'});

        // Mark this button as the eye button for identification
        eyeButton._isEyeButton = true;

        eyeButton.connect('clicked', (button) => {
            timer.selected = !timer.selected;
            eyeIcon.icon_name = timer.selected ? 'selection-mode-symbolic' : 'radio-symbolic';

            if (timer.selected) {
                // Deselect total time
                this._totalTimeSelected = false;
                this._totalTimeEyeIcon.icon_name = 'radio-symbolic';
            } else {
                // If no timers are selected, select total time
                let anySelected = this._timers.some(t => t.selected);
                if (!anySelected) {
                    this._totalTimeSelected = true;
                    this._totalTimeEyeIcon.icon_name = 'selection-mode-symbolic';
                }
            }

            this._updatePanelLabel();
            this._saveTimers();
        });

        // Timer name
        let nameLabel = new St.Label({
            text: timer.name, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'timer-text', reactive: false,
        });

        // Timer time
        let timeLabel = new St.Label({
            text: this._formatTime(timer.timeElapsed), y_align: Clutter.ActorAlign.CENTER, style_class: 'timer-time', reactive: false,
        });

        // Expand/Collapse button
        let expandIcon = new St.Icon({
            icon_name: timer.expanded ? 'pan-down-symbolic' : 'pan-end-symbolic',
        });
        let expandButton = new St.Button({child: expandIcon, y_align: Clutter.ActorAlign.CENTER, style_class: 'timer-icon'});

        // Function to toggle timer expansion
        const toggleExpanded = () => {
            // Auto-collapse other timers
            this._timers.forEach(t => {
                if (t.id !== timer.id && t.expanded) {
                    t.expanded = false;
                    let uiElements = this._timerUIElements.get(t.id);
                    if (uiElements && uiElements.expandIcon && uiElements.actionsRow) {
                        this._collapseTimer(t, uiElements);
                    }
                }
            });

            // Toggle current timer
            timer.expanded = !timer.expanded;
            expandIcon.icon_name = timer.expanded ? 'pan-down-symbolic' : 'pan-end-symbolic';

            if (timer.expanded) {
                this._expandTimer(timer, timerActionsRow, expandIcon);
            } else {
                this._collapseTimer(timer, {actionsRow: timerActionsRow, expandIcon: expandIcon});
            }
        };

        expandButton.connect('clicked', () => {
            toggleExpanded();
        });

        // Vertical container for both rows (main + actions)
        let timerVerticalContainer = new St.BoxLayout({
            vertical: true, style_class: 'timer-vertical-container', x_expand: true,
        });

        // Main row
        let timerMainContent = new St.BoxLayout({
            vertical: false, style_class: 'timer-main-content', x_expand: true, reactive: true, can_focus: true,
        });

        // Add directly to main row
        timerMainContent.add_child(eyeButton);

        // Expandable container
        let expandableContainer = new St.BoxLayout({
            vertical: false, style_class: 'timer-expandable-container', x_expand: true, reactive: true, can_focus: true,
        });

        // Add remaining elements to expandable
        expandableContainer.add_child(nameLabel);
        expandableContainer.add_child(timeLabel);
        expandableContainer.add_child(expandButton);

        // Add to main content
        timerMainContent.add_child(expandableContainer);
        timerVerticalContainer.add_child(timerMainContent);

        // Second row, action buttons
        let timerActionsRow = new St.BoxLayout({
            vertical: false, style_class: 'timer-actions-row', x_align: Clutter.ActorAlign.END,  // Right-align
            visible: timer.expanded, opacity: timer.expanded ? 255 : 0, x_expand: true,
        });

        // Add actions to main row
        timerVerticalContainer.add_child(timerActionsRow);
        timerMainRow.actor.add_child(timerVerticalContainer);

        // Play/Pause button
        let iconName;
        if (timer.running) {
            iconName = 'media-playback-pause-symbolic';
        } else if (timer.autoResume) {
            iconName = 'view-refresh-symbolic'; // Auto-paused (circular arrow icon)
        } else {
            iconName = 'media-playback-start-symbolic'; // Manually paused (play icon)
        }

        let playPauseIcon = new St.Icon({icon_name: iconName});
        let playPauseButton = new St.Button({child: playPauseIcon, style_class: 'timer-icon-button button'});

        // Function to toggle the timer state
        const toggleTimerState = () => {
            let currentTime = GLib.get_real_time();
            if (timer.running) {
                // Pause timer
                let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
                timer.timeElapsed += elapsed;
                timer.running = false;
                timer.lastUpdateTime = null;
                timer.autoResume = false;

                // Update icon to "Play"
                playPauseIcon.icon_name = 'media-playback-start-symbolic';
                timerMainRow.add_style_class_name('timer-paused');
            } else {
                // Start timer
                timer.running = true;
                timer.lastUpdateTime = currentTime;
                timer.autoResume = typeof timer.workspaceId === 'number';

                // Update icon to "Pause"
                playPauseIcon.icon_name = 'media-playback-pause-symbolic';
                timerMainRow.remove_style_class_name('timer-paused');
            }
            this._saveTimers();
        };

        playPauseButton.connect('clicked', () => {
            toggleTimerState();
        });

        timerActionsRow.add_child(playPauseButton);

        // Clear button
        let clearButton = new St.Button({child: new St.Icon({icon_name: 'edit-clear-symbolic'}), style_class: 'timer-icon-button button'});

        clearButton.connect('clicked', () => {
            this._resetTimer(timer);
        });

        timerActionsRow.add_child(clearButton);

        // Edit button
        let editButton = new St.Button({child: new St.Icon({icon_name: 'document-edit-symbolic'}), style_class: 'timer-icon-button button'});

        editButton.connect('clicked', () => {
            // Pause the timer if it's running
            if (timer.running) {
                this._pauseTimer(timer);
            }
            this._editTimer(timer);
        });

        timerActionsRow.add_child(editButton);

        // Delete button
        let deleteButton = new St.Button({child: new St.Icon({icon_name: 'user-trash-symbolic'}), style_class: 'timer-icon-button button'});

        deleteButton.connect('clicked', () => {
            this._removeTimer(timer, timerMainRow);
        });

        timerActionsRow.add_child(deleteButton);

        // Hover highlight on main row
        timerMainRow.actor.connect('enter-event', () => {
            timerMainRow.actor.add_style_pseudo_class('highlighted');
        });
        timerMainRow.actor.connect('leave-event', () => {
            timerMainRow.actor.remove_style_pseudo_class('highlighted');
        });

        // Connect expand/collapse to clicking on the expandable container
        expandableContainer.connect('button-press-event', (actor, event) => {
            toggleExpanded();
            return Clutter.EVENT_STOP;
        });

        // Also connect to nameLabel and timeLabel for clicks
        nameLabel.connect('button-press-event', (actor, event) => {
            toggleExpanded();
            return Clutter.EVENT_STOP;
        });

        timeLabel.connect('button-press-event', (actor, event) => {
            toggleExpanded();
            return Clutter.EVENT_STOP;
        });

        // Apply 'timer-paused' class if the timer is paused
        if (!timer.running) {
            timerMainRow.add_style_class_name('timer-paused');
        }

        this._timersSection.addMenuItem(timerMainRow);

        // Store UI elements in the Map
        this._timerUIElements.set(timer.id, {
            item: timerMainRow,
            mainRow: timerMainRow,
            actionsRow: timerActionsRow,
            nameLabel: nameLabel,
            timeLabel: timeLabel,
            eyeButton: eyeButton,
            expandButton: expandButton,
            expandIcon: expandIcon,
            playPauseButton: playPauseButton,
            playPauseIcon: playPauseIcon,
            clearButton: clearButton,
            editButton: editButton,
            deleteButton: deleteButton
        });
    }

    _expandTimer(timer, actionsRow, expandIcon) {
        if (!actionsRow) return;

        // Show the actions row instantly
        actionsRow.visible = true;
        actionsRow.opacity = 255;
    }

    _collapseTimer(timer, uiElements) {
        if (!uiElements || !uiElements.actionsRow) return;

        let actionsRow = uiElements.actionsRow;

        // Hide the actions row instantly
        actionsRow.opacity = 0;
        actionsRow.visible = false;
    }

    _resetTimer(timer) {
        timer.timeElapsed = 0;
        if (timer.running) {
            timer.lastUpdateTime = GLib.get_real_time();
        } else {
            timer.lastUpdateTime = null;
        }

        // Update UI
        let uiElements = this._timerUIElements.get(timer.id);
        if (uiElements && uiElements.timeLabel) {
            uiElements.timeLabel.text = this._formatTime(timer.timeElapsed);
        }

        // Update total time labels
        this._updateTotalTime();
        this._updatePanelLabel();

        this._saveTimers();
    }


    _pauseTimer(timer) {
        let uiElements = this._timerUIElements.get(timer.id);

        let currentTime = GLib.get_real_time();
        let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
        timer.timeElapsed += elapsed;
        timer.running = false;
        timer.lastUpdateTime = null;
        timer.autoResume = false;

        // Update UI
        if (uiElements && uiElements.playPauseIcon) {
            uiElements.playPauseIcon.icon_name = 'media-playback-start-symbolic';
        }
        if (uiElements && uiElements.item) {
            uiElements.item.add_style_class_name('timer-paused');
        }

        this._saveTimers();
    }

    _parseTimeInput(timeString) {
        // Match hh:mm:ss or mm:ss or ss
        let regex = /^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}$/;
        if (!regex.test(timeString)) {
            return null;
        }

        let parts = timeString.split(':').map(Number).reverse();
        let seconds = 0;

        if (parts.length >= 1) {
            seconds += parts[0];
        }
        if (parts.length >= 2) {
            seconds += parts[1] * 60;
        }
        if (parts.length >= 3) {
            seconds += parts[2] * 3600;
        }

        return seconds;
    }


    _editTimer(timer) {
        let uiElements = this._timerUIElements.get(timer.id);
        let {
            mainRow, nameLabel, timeLabel, eyeButton, expandButton, clearButton, editButton, deleteButton, actionsRow
        } = uiElements;

        // Hide the buttons
        eyeButton.hide();
        expandButton.hide();
        clearButton.hide();
        editButton.hide();
        deleteButton.hide();

        // Create an entry field to edit the timer name
        let nameEntry = new St.Entry({
            text: timer.name, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'name-entry', hint_text: 'Timer name', can_focus: true,
        });

        // Create an entry field to edit the timer value
        let timeEntry = new St.Entry({
            text: this._formatTime(timer.timeElapsed), x_expand: false,   // Do not allow horizontal expansion
            width: 85, y_align: Clutter.ActorAlign.CENTER, style_class: 'timer-entry', hint_text: 'hh:mm:ss', can_focus: true,
        });

        // Replace the nameLabel and timeLabel with the entry fields
        let nameEntryParent = nameLabel.get_parent();
        nameEntryParent.replace_child(nameLabel, nameEntry);

        let timeEntryParent = timeLabel.get_parent();
        timeEntryParent.replace_child(timeLabel, timeEntry);

        // Create Save and Cancel buttons
        let saveButton = new St.Button({child: new St.Icon({icon_name: 'document-save-symbolic'}), style_class: 'timer-icon-button button'});
        let cancelButton = new St.Button({child: new St.Icon({icon_name: 'process-stop-symbolic'}), style_class: 'timer-icon-button button'});

        // Add the Save and Cancel buttons to the actions row
        actionsRow.add_child(saveButton);
        actionsRow.add_child(cancelButton);
        // Make actions row visible and animated
        actionsRow.visible = true;
        actionsRow.opacity = 255;

        // Apply edit styling
        mainRow.add_style_class_name('timer-edit');

        // Helper function to save the timer name and value
        const saveTimer = () => {
            timer.name = nameEntry.get_text();

            // Parse the time input
            let timeText = timeEntry.get_text();
            let newTimeElapsed = this._parseTimeInput(timeText);
            if (newTimeElapsed !== null) {
                timer.timeElapsed = newTimeElapsed;
            }

            // Replace the entries with the updated labels
            nameEntryParent.replace_child(nameEntry, nameLabel);
            nameLabel.text = timer.name;

            timeEntryParent.replace_child(timeEntry, timeLabel);
            timeLabel.text = this._formatTime(timer.timeElapsed);

            // Remove Save and Cancel buttons
            if (saveButton && saveButton.get_parent() === actionsRow) {
                actionsRow.remove_child(saveButton);
            }
            if (cancelButton && cancelButton.get_parent() === actionsRow) {
                actionsRow.remove_child(cancelButton);
            }

            // Remove edit styling
            mainRow.remove_style_class_name('timer-edit');

            // Show the previously hidden elements
            eyeButton.show();
            expandButton.show();
            clearButton.show();
            editButton.show();
            deleteButton.show();

            // Reset the editing state
            timer.isEditing = false;
            timer.editEntries = null;
            timer.saveButton = null;
            timer.cancelButton = null;

            this._saveTimers();
        };

        // Helper function to cancel editing
        const cancelEdit = () => {
            this._resetEditingState(timer);
        };

        // Connect signals for the Save and Cancel buttons
        saveButton.connect('clicked', saveTimer);
        cancelButton.connect('clicked', cancelEdit);

        // Handle key events for both entries
        const handleKeyPress = (entry, nextEntry, previousEntry) => {
            entry.clutter_text.connect('key-press-event', (actor, event) => {
                let symbol = event.get_key_symbol();
                let state = event.get_state();

                if (symbol === Clutter.KEY_Escape) {
                    cancelEdit();
                    // Prevent the menu from closing
                    return true; // Return true to stop event propagation
                } else if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                    saveTimer();
                    return true;
                } else if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab) {
                    let shiftPressed = state & Clutter.ModifierType.SHIFT_MASK;
                    if (shiftPressed || symbol === Clutter.KEY_ISO_Left_Tab) {
                        // Shift+Tab: Move focus to previous entry
                        if (previousEntry) {
                            previousEntry.grab_key_focus();
                            return true;
                        }
                    } else {
                        // Tab: Move focus to next entry
                        if (nextEntry) {
                            nextEntry.grab_key_focus();
                            return true;
                        }
                    }
                    return true;
                }
                return false; // Allow other keys to be handled normally
            });
        };

        // Apply key handling to both entries
        handleKeyPress(nameEntry, timeEntry, null);
        handleKeyPress(timeEntry, null, nameEntry);

        if (nameEntry && nameEntry.get_stage()) {
            nameEntry.grab_key_focus();
        }

        // Store the edit mode state and entry fields
        timer.isEditing = true;
        timer.editEntries = {nameEntry, timeEntry};
        timer.saveButton = saveButton;
        timer.cancelButton = cancelButton;
    }

    _removeTimer(timer, timerItem) {
        // Remove the timer from the timers array
        this._timers = this._timers.filter(t => t !== timer);

        // Remove UI elements from the Map
        this._timerUIElements.delete(timer.id);

        // Destroy the menu item to remove it from the menu
        timerItem.destroy();

        // Update the panel label and save timers
        this._updatePanelLabel();
        this._saveTimers();
    }


    _addNewTimer() {
        // Get current workspace ID
        let currentWorkspace = global.workspace_manager.get_active_workspace();
        let workspaceId = currentWorkspace ? currentWorkspace.index() : 0;

        let newTimer = {
            id: GLib.uuid_string_random(), // Assign a unique ID
            name: '<empty>', timeElapsed: 0, running: false, selected: false, workspaceId: null // Default to no workspace association
        };
        this._timers.push(newTimer);
        this._addTimerItem(newTimer);
        this._saveTimers();
    }


    _pauseAllTimers(pauseType = PauseType.MANUAL) {
        let currentTime = GLib.get_real_time();
        this._timers.forEach(timer => {
            if (timer.running) {
                let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
                timer.timeElapsed += elapsed;
                timer.running = false;
                timer.lastUpdateTime = null;

                const hasWorkspace = typeof timer.workspaceId === 'number';
                if (pauseType !== PauseType.MANUAL && hasWorkspace) {
                    timer.autoResume = true;
                }
            }

            if (pauseType === PauseType.MANUAL) {
                timer.autoResume = false;
            }

            // Update UI
            let uiElements = this._timerUIElements.get(timer.id);
            if (uiElements) {
                if (uiElements.playPauseIcon) {
                    uiElements.playPauseIcon.icon_name = timer.autoResume ? 'view-refresh-symbolic' : 'media-playback-start-symbolic';
                }

                if (uiElements.timeLabel) {
                    uiElements.timeLabel.text = this._formatTime(timer.timeElapsed);
                }

                if (uiElements.item) {
                    uiElements.item.add_style_class_name('timer-paused');
                }
            } else {
                console.log(`Warning: UI elements not found for timer "${timer.name}"`);
            }
        });
        this._saveTimers();
    }

    _toggleTotalTimeSelection() {
        this._totalTimeSelected = !this._totalTimeSelected;
        this._totalTimeEyeIcon.icon_name = this._totalTimeSelected ? 'selection-mode-symbolic' : 'radio-symbolic';
        if (this._totalTimeSelected) {
            // Deselect all individual timers
            this._timers.forEach(timer => {
                timer.selected = false;

                // Retrieve UI elements using timer.id
                let uiElements = this._timerUIElements.get(timer.id);
                if (uiElements && uiElements.eyeButton) {
                    // Update the eye icon to 'hidden'
                    uiElements.eyeButton.child.icon_name = 'radio-symbolic';
                }
            });
        }
        this._updatePanelLabel();
        this._saveTimers();
    }

    _updatePanelLabel() {
        let totalTime = 0;
        let currentTime = GLib.get_real_time();

        if (this._totalTimeSelected) {
            totalTime = this._timers.reduce((sum, timer) => {
                return sum + this._getTimerTotalTime(timer, currentTime);
            }, 0);
            this._label.text = this._formatTime(totalTime);
        } else {
            let selectedTimers = this._timers.filter(timer => timer.selected);
            if (selectedTimers.length > 0) {
                totalTime = selectedTimers.reduce((sum, timer) => {
                    return sum + this._getTimerTotalTime(timer, currentTime);
                }, 0);
                this._label.text = this._formatTime(totalTime);
            } else {
                // No timers selected and total time not selected
                // Show total time by default
                this._totalTimeSelected = true;
                this._totalTimeEyeIcon.icon_name = 'selection-mode-symbolic';
                this._label.text = this._formatTime(this._timers.reduce((sum, timer) => sum + this._getTimerTotalTime(timer, currentTime), 0));
            }
        }
    }

    _startTimers() {
        this._timerUpdate = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            let currentTime = GLib.get_real_time();
            this._timers.forEach(timer => {
                let uiElements = this._timerUIElements.get(timer.id);
                if (!uiElements) {
                    // UI elements not found for this timer, skip updating
                    return;
                }
                if (timer.running) {
                    if (timer.lastUpdateTime === null || timer.lastUpdateTime === undefined) {
                        // Since the timer is running, but lastUpdateTime is invalid, reset it
                        timer.lastUpdateTime = currentTime;
                        // Do not update timeElapsed this cycle
                    } else {
                        let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
                        timer.timeElapsed += elapsed;
                        timer.lastUpdateTime = currentTime;
                    }
                    uiElements.timeLabel.text = this._formatTime(timer.timeElapsed);
                } else {
                    uiElements.timeLabel.text = this._formatTime(timer.timeElapsed);
                }

            });
            this._updateTotalTime();
            this._updatePanelLabel();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getTimerTotalTime(timer, currentTime) {
        if (timer.running && timer.lastUpdateTime) {
            let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
            return timer.timeElapsed + elapsed;
        } else {
            return timer.timeElapsed;
        }
    }

    _updateTotalTime() {
        let totalTime = 0;
        let currentTime = GLib.get_real_time();
        totalTime = this._timers.reduce((sum, timer) => {
            return sum + this._getTimerTotalTime(timer, currentTime);
        }, 0);
        this._totalTimeLabel.text = `Total: ${this._formatTime(totalTime)}`;
    }

    _onMenuClosed() {
        this._timers.forEach(timer => {
            if (timer.isEditing) {
                this._resetEditingState(timer);
            }
        });
    }


    _formatTime(seconds) {
        let hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
        let mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        let secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${hrs}:${mins}:${secs}`;
    }

    _onScreenLocked() {
        this._pauseAllTimers(PauseType.AUTO);
    }

    _onScreenUnlocked() {
        this._syncWorkspaces();
    }

    _downloadCsv() {
        const DELIMITER = ',';
        const NEWLINE = '\n';

        // Create headers
        let csv = `Name${DELIMITER}Time${NEWLINE}`;

        // Populate rows
        this._timers.forEach(timer => {
            // Escape commas and wrap in quotes
            let name = `"${timer.name.replace(/"/g, '""')}"`;
            let time = this._formatTime(timer.timeElapsed);
            csv += `${name}${DELIMITER}${time}${NEWLINE}`;
        });

        const now = GLib.DateTime.new_now_local();
        const timestamp = now.format('%Y-%m-%d_%H-%M-%S');
        const filePath = `${GLib.get_home_dir()}/timers_${timestamp}.csv`;

        try {
            let file = Gio.File.new_for_path(filePath);
            let stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

            stream.write_all(csv, null);
            stream.close(null);

            const systemSource = MessageTray.getSystemSource();
            const notification = new MessageTray.Notification({
                // The source of the notification
                source: systemSource, // A title for the notification
                title: _('Tracker'), // The content of the notification
                body: _(`CSV exported to: ${filePath}`),
            });
            notification.connect('activated', _notification => {
                try {
                    Gio.AppInfo.launch_default_for_uri(`file://${filePath}`, null);
                } catch (err) {
                    console.log(`Error: cannot open file: ${err.message}`);
                }
            });
            notification.addAction("Show in Files", () => {
                const directory = Gio.File.new_for_path(GLib.path_get_dirname(filePath));
                if (directory) {
                    try {
                        Gio.AppInfo.launch_default_for_uri(directory.get_uri(), null);
                    } catch (err) {
                        console.log(`Error: cannot open directory: ${err.message}`);
                    }
                }
            });

            systemSource.addNotification(notification);
        } catch (err) {
            console.log(`Error: failed to export CSV: ${err.message}`);
        }
    }

    _onWorkspaceChanged(wm, from, to) {
        this._syncWorkspaces();
    }

    _onTimersSettingsChanged() {
        // Load new timer data from settings
        let timersData = this._settings.get_strv('timers');

        // Update workspace IDs for all timers
        timersData.forEach(data => {
            let item = JSON.parse(data);
            if (item.id !== 'settings') {
                const timer = this._timers.find(t => t.id === item.id);
                if (timer) {
                    // Normalize workspace ID: treat undefined as null
                    const newWorkspaceId = item.workspaceId === undefined ? null : item.workspaceId;
                    if (timer.workspaceId !== newWorkspaceId) {
                        timer.workspaceId = newWorkspaceId;
                    }
                }
            }
        });

        // Sync workspaces to apply the changes
        this._syncWorkspaces();
    }

    _syncWorkspaces() {
        let currentWorkspace = global.workspace_manager.get_active_workspace();
        if (!currentWorkspace) {
            return;
        }

        let workspaceId = currentWorkspace.index();
        let currentTime = GLib.get_real_time();

        this._timers.forEach(timer => {
            let uiElements = this._timerUIElements.get(timer.id);
            if (!uiElements) {
                return;
            }

            // Check if timer has a workspace assignment (not null and not undefined)
            const hasWorkspaceAssignment = typeof timer.workspaceId === 'number';

            // Pause timers that don't belong to this workspace
            if (hasWorkspaceAssignment && timer.workspaceId !== workspaceId) {
                if (timer.running) {
                    timer.autoResume = true;

                    let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
                    timer.timeElapsed += elapsed;
                    timer.running = false;
                    timer.lastUpdateTime = null;

                    if (uiElements.playPauseIcon) {
                        uiElements.playPauseIcon.icon_name = 'view-refresh-symbolic';
                    }
                    if (uiElements.item) {
                        uiElements.item.add_style_class_name('timer-paused');
                    }
                }
            }
            // Resume auto-paused timers that belong to this workspace
            else if (hasWorkspaceAssignment && timer.workspaceId === workspaceId && timer.autoResume) {
                timer.running = true;
                timer.lastUpdateTime = currentTime;

                if (uiElements.playPauseIcon) {
                    uiElements.playPauseIcon.icon_name = 'media-playback-pause-symbolic';
                }
                if (uiElements.item) {
                    uiElements.item.remove_style_class_name('timer-paused');
                }
            }
        });

        this._saveTimers();
    }

    destroy() {
        if (this._timerUpdate) {
            GLib.source_remove(this._timerUpdate);
            this._timerUpdate = null;
        }

        this._pauseAllTimers(PauseType.SILENT);
        this._saveTimers();

        if (this._periodicSaveId) {
            GLib.source_remove(this._periodicSaveId);
            this._periodicSaveId = null;
        }

        this._stopBackupTimer();

        // Disconnect screen lock signals
        if (this._screenShieldSignal) {
            Main.screenShield.disconnect(this._screenShieldSignal);
            this._screenShieldSignal = null;
        }

        // Workspace signals
        if (this._workspaceSignal) {
            global.workspace_manager.disconnect(this._workspaceSignal);
            this._workspaceSignal = null;
        }

        // Disconnect settings change handler
        if (this._timerSettingsChangedHandler) {
            this._settings.disconnect(this._timerSettingsChangedHandler);
            this._timerSettingsChangedHandler = null;
        }

        // Clean up settings
        if (this._settings) {
            this._settings = null;
        }

        super.destroy();
    }
});

export default class TrackerExtension extends Extension {
    enable() {
        this._indicator = new Tracker(this);

        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
