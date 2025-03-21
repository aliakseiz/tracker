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
 dbus-run-session -- gnome-shell --nested --wayland
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

const Tracker = GObject.registerClass(class Tracker extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Timer Tracker');

        this._label = new St.Label({
            text: 'Tracker',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this.extension = extension;
        this._settings = this.extension.getSettings('org.gnome.shell.extensions.tracker');

        this._timerUIElements = new Map();

        this._totalTimeSelected = true; // Default to total time selected
        this._loadTimers();

        this._buildMenu();

        this.menu.connect('menu-closed', () => {
            this._onMenuClosed();
        });

        this._screenLockSignal = Main.screenShield.connect('locked', () => {
            this._onScreenLocked();
        });

        this._startPeriodicSave();

        this._startTimers();
    }

    _resetEditingState(timer) {
        let uiElements = this._timerUIElements.get(timer.id);
        if (!uiElements) {
            console.log(`Error: UI elements not found for timer "${timer.name}"`);
            return;
        }

        let {
            item,
            nameLabel,
            timeLabel,
            eyeButton,
            playPauseButton,
            resetButton,
            editButton,
            deleteButton
        } = uiElements;
        let nameEntry = timer.editEntries?.nameEntry;
        let timeEntry = timer.editEntries?.timeEntry;
        let saveButton = timer.saveButton;
        let cancelButton = timer.cancelButton;

        // Replace the entries with the original labels
        if (nameEntry && nameEntry.get_parent) {
            let nameEntryParent = nameEntry.get_parent();
            if (nameEntryParent && nameEntryParent.contains(nameEntry)) {
                nameEntryParent.replace_child(nameEntry, nameLabel);
            }
        }

        if (timeEntry && timeEntry.get_parent) {
            let timeEntryParent = timeEntry.get_parent();
            if (timeEntryParent && timeEntryParent.contains(timeEntry)) {
                timeEntryParent.replace_child(timeEntry, timeLabel);
            }
        }

        // Remove Save and Cancel buttons
        if (saveButton && item.actor.contains(saveButton)) {
            item.remove_child(saveButton);
        }
        if (cancelButton && item.actor.contains(cancelButton)) {
            item.remove_child(cancelButton);
        }

        // Restore padding to normal state
        item.remove_style_class_name('timer-edit');
        // Restore buttons color
        item.add_style_class_name('timer-paused');

        // Show the previously hidden elements
        eyeButton.show();
        playPauseButton.show();
        resetButton.show();
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
            id: 'settings',
            totalTimeSelected: this._totalTimeSelected
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
            reactive: false,
            style_class: 'summary-row',
        });

        let summaryWrapper = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'summary-wrapper',
        });

        // Left container for the total time eye button and label
        let leftContainer = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'left-container',
        });
        leftContainer.y_align = Clutter.ActorAlign.CENTER;

        // Right container for the action buttons
        let rightContainer = new St.BoxLayout({
            vertical: false,
            x_expand: false,
            style_class: 'right-container',
        });
        rightContainer.y_align = Clutter.ActorAlign.CENTER;

        // Total time eye button
        this._totalTimeEyeIcon = new St.Icon({
            icon_name: this._totalTimeSelected ? 'selection-mode-symbolic' : 'radio-symbolic',
            style_class: 'timer-icon',
        });

        this._totalTimeEyeButton = new St.Button({child: this._totalTimeEyeIcon});
        this._totalTimeEyeButton.connect('clicked', () => {
            this._toggleTotalTimeSelection();
        });
        summaryRow.add_child(this._totalTimeEyeButton);

        this._totalTimeLabel = new St.Label({text: 'Total: 00:00:00', x_expand: true});
        summaryRow.add_child(this._totalTimeLabel);

        // Download CSV button
        let downloadCsvIcon = new St.Icon({
            icon_name: 'document-save-symbolic',
            style_class: 'timer-icon',
        });
        let downloadCsvButton = new St.Button({child: downloadCsvIcon});
        downloadCsvButton.connect('clicked', () => {
            this._downloadCsv();
        });
        rightContainer.add_child(downloadCsvButton);

        // Pause all timers button
        let pauseAllIcon = new St.Icon({
            icon_name: 'media-playback-pause-symbolic',
            style_class: 'timer-icon',
        });
        let pauseAllButton = new St.Button({child: pauseAllIcon});
        pauseAllButton.connect('clicked', () => {
            this._pauseAllTimers();
        });
        rightContainer.add_child(pauseAllButton);

        // Total time reset button
        let totalResetIcon = new St.Icon({
            icon_name: 'edit-clear-all-symbolic',
            style_class: 'timer-icon',
        });
        let totalResetButton = new St.Button({child: totalResetIcon});
        totalResetButton.connect('clicked', () => {
            this._resetAllTimers();
        });
        rightContainer.add_child(totalResetButton);

        // Add new timer button
        let addIcon = new St.Icon({
            icon_name: 'list-add-symbolic',
            style_class: 'timer-icon',
        });
        let addButton = new St.Button({child: addIcon});
        addButton.connect('clicked', () => {
            this._addNewTimer();
        });
        rightContainer.add_child(addButton);

// Assemble the buttons container
        summaryWrapper.add_child(leftContainer);
        summaryWrapper.add_child(rightContainer);

// Add the assembled container to the summaryRow
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
        let timerItem = new PopupMenu.PopupBaseMenuItem({
            style_class: 'timer-item',
            activate: false, // Prevent the menu from closing when the item is activated
        });

        // Eye icon
        let eyeIcon = new St.Icon({
            icon_name: timer.selected ? 'selection-mode-symbolic' : 'radio-symbolic',
            style_class: 'timer-icon',
        });
        let eyeButton = new St.Button({child: eyeIcon});
        eyeButton.connect('clicked', () => {
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
        timerItem.add_child(eyeButton);

        // Timer name
        let nameLabel = new St.Label({
            text: timer.name,
            x_expand: true,
            style_class: 'timer-text',
        });

        // Timer time
        let timeLabel = new St.Label({
            text: this._formatTime(timer.timeElapsed),
            style_class: 'timer-time',
        });

        // Create a container for nameLabel and timeLabel
        let labelContainer = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            reactive: true,        // Make it clickable
            can_focus: true,
            track_hover: true,
            style_class: 'timer-label-container',
        });

        // Add nameLabel and timeLabel to the container
        labelContainer.add_child(nameLabel);
        labelContainer.add_child(timeLabel);

        // Add the container to the timerItem
        timerItem.add_child(labelContainer);

        // Play/Pause button
        let iconName = timer.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        let playPauseIcon = new St.Icon({
            icon_name: iconName,
            style_class: 'timer-icon play-button',
        });
        let playPauseButton = new St.Button({child: playPauseIcon});

        // Function to toggle the timer state
        const toggleTimerState = () => {
            let currentTime = GLib.get_real_time();
            if (timer.running) {
                // Pause timer
                let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
                timer.timeElapsed += elapsed;
                timer.running = false;
                timer.lastUpdateTime = null;

                // Update icon to "Play"
                playPauseIcon.icon_name = 'media-playback-start-symbolic';
                timerItem.add_style_class_name('timer-paused');
            } else {
                // Start timer
                timer.running = true;
                timer.lastUpdateTime = currentTime;

                // Update icon to "Pause"
                playPauseIcon.icon_name = 'media-playback-pause-symbolic';
                timerItem.remove_style_class_name('timer-paused');
            }
            this._saveTimers();
        };

        // Connect the click handler to the Play/Pause button
        playPauseButton.connect('clicked', () => {
            toggleTimerState();
        });

        // Connect the click handler to the label container
        labelContainer.connect('button-press-event', (actor, event) => {
            // Prevent the menu from closing
            // event.stop_propagation();

            // Toggle the timer state
            toggleTimerState();

            // Prevent the menu from closing by stopping event propagation
            return Clutter.EVENT_STOP;
        });

        timerItem.add_child(playPauseButton);

        // Reset button
        let resetButton = new St.Button({
            child: new St.Icon({
                icon_name: 'edit-clear-symbolic',
                style_class: 'timer-icon',
            })
        });

        resetButton.connect('clicked', () => {
            this._resetTimer(timer);
        });

        timerItem.add_child(resetButton);

        // Edit button
        let editButton = new St.Button({
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'timer-icon',
            })
        });
        editButton.connect('clicked', () => {
            // Pause the timer if it's running
            if (timer.running) {
                this._pauseTimer(timer);
            }
            this._editTimer(timer);
        });

        timerItem.add_child(editButton);

        // Delete button
        let deleteButton = new St.Button({
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'timer-icon',
            })
        });
        deleteButton.connect('clicked', () => {
            this._removeTimer(timer, timerItem);
        });
        timerItem.add_child(deleteButton);

        // Hover highlight
        timerItem.actor.connect('enter-event', () => {
            timerItem.actor.add_style_pseudo_class('highlighted');
        });
        timerItem.actor.connect('leave-event', () => {
            timerItem.actor.remove_style_pseudo_class('highlighted');
        });

        // Apply 'timer-paused' class if the timer is paused
        if (!timer.running) {
            timerItem.add_style_class_name('timer-paused');
        }


        this._timersSection.addMenuItem(timerItem);

        // Store UI elements in the Map
        this._timerUIElements.set(timer.id, {
            item: timerItem,
            nameLabel: nameLabel,
            timeLabel: timeLabel,
            eyeButton: eyeButton,
            playPauseButton: playPauseButton,
            playPauseIcon: playPauseIcon,
            resetButton: resetButton,
            editButton: editButton,
            deleteButton: deleteButton
        });
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
            item,
            nameLabel,
            timeLabel,
            eyeButton,
            playPauseButton,
            resetButton,
            editButton,
            deleteButton
        } = uiElements;

        // Hide the Eye, Play/Pause, Edit, and Delete buttons
        eyeButton.hide();
        playPauseButton.hide();
        resetButton.hide();
        editButton.hide();
        deleteButton.hide();

        // Create an entry field to edit the timer name
        let nameEntry = new St.Entry({
            text: timer.name,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'name-entry',
            hint_text: 'Timer name',
            can_focus: true,
        });

        // Create an entry field to edit the timer value
        let timeEntry = new St.Entry({
            text: this._formatTime(timer.timeElapsed),
            x_expand: false,   // Do not allow horizontal expansion
            width: 85,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'timer-entry',
            hint_text: 'hh:mm:ss',
            can_focus: true,
        });

        // Replace the nameLabel and timeLabel with the entry fields
        let nameEntryParent = nameLabel.get_parent();
        nameEntryParent.replace_child(nameLabel, nameEntry);

        let timeEntryParent = timeLabel.get_parent();
        timeEntryParent.replace_child(timeLabel, timeEntry);

        // Create Save and Cancel buttons
        let saveIcon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            icon_name: 'document-save-symbolic',
            style_class: 'timer-icon',
        });
        let saveButton = new St.Button({child: saveIcon});
        let cancelIcon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            icon_name: 'process-stop-symbolic',
            style_class: 'timer-icon',
        });
        let cancelButton = new St.Button({child: cancelIcon});

        // Add the Save and Cancel buttons to the timer item
        item.add_child(saveButton);
        item.add_child(cancelButton);
        // Decrease padding to fit input text fields without changing the container height
        item.add_style_class_name('timer-edit');
        // Make buttons not-paused
        item.remove_style_class_name('timer-paused');

        // Helper function to save the timer name and value
        const saveTimer = () => {
            timer.name = nameEntry.get_text();

            // Parse the time input
            let timeText = timeEntry.get_text();
            let newTimeElapsed = this._parseTimeInput(timeText);
            if (newTimeElapsed !== null) {
                timer.timeElapsed = newTimeElapsed;
            }
            // If the input is invalid, silently ignore and keep the previous value

            // Replace the entries with the updated labels
            nameEntryParent.replace_child(nameEntry, nameLabel);
            nameLabel.text = timer.name;

            timeEntryParent.replace_child(timeEntry, timeLabel);
            timeLabel.text = this._formatTime(timer.timeElapsed);

            // Remove Save and Cancel buttons
            item.remove_child(saveButton);
            item.remove_child(cancelButton);

            // Restore padding to normal state
            item.remove_style_class_name('timer-edit');
            // Restore buttons color
            item.add_style_class_name('timer-paused');

            // Show the previously hidden elements
            eyeButton.show();
            playPauseButton.show();
            resetButton.show();
            editButton.show();
            deleteButton.show();

            // Reset the editing state
            timer.isEditing = false;
            timer.editEntries = null;

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

        // Auto-focus the nameEntry field
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
        let newTimer = {
            id: GLib.uuid_string_random(), // Assign a unique ID
            name: '<empty>',
            timeElapsed: 0,
            running: false,
            selected: false
        };
        this._timers.push(newTimer);
        this._addTimerItem(newTimer);
        this._saveTimers();
    }


    _pauseAllTimers() {
        let currentTime = GLib.get_real_time();
        this._timers.forEach(timer => {
            if (timer.running) {
                let currentTime = GLib.get_real_time();
                let elapsed = (currentTime - timer.lastUpdateTime) / 1000000;
                timer.timeElapsed += elapsed;
                timer.running = false;
                timer.lastUpdateTime = null;
            }
            timer.running = false; // Ensure all timers are set to not running

            // Update UI
            let uiElements = this._timerUIElements.get(timer.id);
            if (uiElements) {
                if (uiElements.playPauseButton) {
                    // Update icon to "Play"
                    uiElements.playPauseIcon.icon_name = 'media-playback-start-symbolic';
                }
                if (uiElements.timeLabel) {
                    uiElements.timeLabel.text = this._formatTime(timer.timeElapsed);
                }
                if (uiElements.item) {
                    // Add 'timer-paused' class
                    uiElements.item.add_style_class_name('timer-paused');
                }
            } else {
                // Log a warning if UI elements are missing
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
                this._label.text = this._formatTime(
                    this._timers.reduce((sum, timer) => sum + this._getTimerTotalTime(timer, currentTime), 0)
                );
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
        this._pauseAllTimers();
        this._saveTimers();
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
                source: systemSource,
                // A title for the notification
                title: _('Tracker'),
                // The content of the notification
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

    destroy() {
        if (this._timerUpdate) {
            GLib.source_remove(this._timerUpdate);
            this._timerUpdate = null;
        }

        // Pause all timers and save the state
        this._pauseAllTimers();
        this._saveTimers();

        if (this._periodicSaveId) {
            GLib.source_remove(this._periodicSaveId);
            this._periodicSaveId = null;
        }

        // Disconnect screen lock signal
        if (this._screenLockSignal) {
            Main.screenShield.disconnect(this._screenLockSignal);
            this._screenLockSignal = null;
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
