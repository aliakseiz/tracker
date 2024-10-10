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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// TODO click on a timer should not close the menu
// TODO click on a timer should control start/pause state
// TODO hovering timer control buttons should highlight them with a circle indicating that they are clickable
// TODO change the text color based on the Gnome theme dark/light
// TODO pause all timers on screen lock and log out

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

        this._loadTimers();

        this._buildMenu();

        this.menu.connect('menu-closed', () => {
            this._onMenuClosed();
        });

        this._startTimers();
    }

    _loadTimers() {
        let currentTime = GLib.get_real_time();
        let timersData = this._settings.get_strv('timers');
        this._timers = timersData.map(data => {
            let timer = JSON.parse(data);
            if (!timer.id) {
                timer.id = GLib.uuid_string_random();
            }
            if (timer.running) {
                // Set startTime to current time
                timer.startTime = currentTime;
            } else {
                timer.startTime = null;
            }
            return timer;
        });
    }

    _saveTimers() {
        let timersData = this._timers.map(timer => {
            // Exclude startTime from being saved
            let timerCopy = {...timer};
            delete timerCopy.startTime;
            return JSON.stringify(timerCopy);
        });
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
        let buttonsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'summary-row',
        });
        let buttonsBox = new St.BoxLayout({x_expand: true});


        // Total time item with eye icon
        // let totalTimeItem = new PopupMenu.PopupBaseMenuItem();

        this._totalTimeEyeIcon = new St.Icon({
            icon_name: 'radio-symbolic',
            style_class: 'timer-icon',
        });
        this._totalTimeEyeButton = new St.Button({child: this._totalTimeEyeIcon});
        this._totalTimeEyeButton.connect('clicked', () => {
            this._toggleTotalTimeSelection();
        });
        buttonsItem.add_child(this._totalTimeEyeButton);

        this._totalTimeLabel = new St.Label({text: 'Total: 00:00:00', x_expand: true});
        buttonsItem.add_child(this._totalTimeLabel);

        // this.menu.addMenuItem(totalTimeItem);

        // Pause all timers button
        let pauseAllIcon = new St.Icon({
            icon_name: 'media-playback-pause-symbolic',
            style_class: 'timer-icon',
        });
        let pauseAllButton = new St.Button({child: pauseAllIcon});
        pauseAllButton.connect('clicked', () => {
            this._pauseAllTimers();
        });
        buttonsBox.add_child(pauseAllButton);

        // Add new timer button
        let addIcon = new St.Icon({
            icon_name: 'list-add-symbolic',
            style_class: 'timer-icon',
        });
        let addButton = new St.Button({child: addIcon});
        addButton.connect('clicked', () => {
            this._addNewTimer();
        });
        buttonsBox.add_child(addButton);

        buttonsItem.actor.add_child(buttonsBox);
        this.menu.addMenuItem(buttonsItem);
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
            if (timer.running) {
                // Pause timer
                let currentTime = GLib.get_real_time();
                let elapsed = (currentTime - timer.startTime) / 1000000;
                timer.timeElapsed += elapsed;
                timer.running = false;
                timer.startTime = null;

                // Update icon to "Play"
                playPauseIcon.icon_name = 'media-playback-start-symbolic';
                timerItem.add_style_class_name('timer-paused');
            } else {
                // Start timer
                timer.running = true;
                timer.startTime = GLib.get_real_time();

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

        // Edit button
        let editButton = new St.Button({
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'timer-icon',
            })
        });
        editButton.connect('clicked', () => {
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
            playPauseIcon: playPauseIcon, // Add this to update the icon elsewhere
            editButton: editButton,
            deleteButton: deleteButton
        });
    }


    _editTimer(timer) {
        let uiElements = this._timerUIElements.get(timer.id);
        let {item, nameLabel, timeLabel, eyeButton, playPauseButton, editButton, deleteButton} = uiElements;

        // Hide the Eye, Play/Pause, Edit, and Delete buttons, and the time label
        eyeButton.hide();
        playPauseButton.hide();
        editButton.hide();
        deleteButton.hide();
        timeLabel.hide();

        // Create an entry field to edit the timer name
        let entry = new St.Entry({text: timer.name});
        let entryParent = nameLabel.get_parent();

        // Replace the name label with the entry field
        entryParent.replace_child(nameLabel, entry);

        // Create Save and Cancel buttons
        let saveIcon = new St.Icon({
            icon_name: 'document-save-symbolic',
            style_class: 'timer-icon',
        });
        let saveButton = new St.Button({child: saveIcon});
        let cancelIcon = new St.Icon({
            icon_name: 'process-stop-symbolic',
            style_class: 'timer-icon',
        });
        let cancelButton = new St.Button({child: cancelIcon});

        // Add the Save and Cancel buttons to the timer item
        item.add_child(saveButton);
        item.add_child(cancelButton);

        // Helper function to save the timer name
        const saveTimerName = () => {
            timer.name = entry.get_text();
            // Replace the entry with the updated name label
            entryParent.replace_child(entry, nameLabel);
            nameLabel.text = timer.name;

            // Remove Save and Cancel buttons
            item.remove_child(saveButton);
            item.remove_child(cancelButton);

            // Show the previously hidden elements
            eyeButton.show();
            playPauseButton.show();
            editButton.show();
            deleteButton.show();
            timeLabel.show();

            // Reset the editing state
            timer.isEditing = false;
            timer.editEntry = null;

            this._saveTimers();
        };

        // Helper function to cancel editing
        const cancelEdit = () => {
            // Replace the entry with the original name label
            entryParent.replace_child(entry, nameLabel);

            // Remove Save and Cancel buttons
            item.remove_child(saveButton);
            item.remove_child(cancelButton);

            // Show the previously hidden elements
            eyeButton.show();
            playPauseButton.show();
            editButton.show();
            deleteButton.show();
            timeLabel.show();

            // Reset the editing state
            timer.isEditing = false;
            timer.editEntry = null;
        };

        // Connect signals for the Save and Cancel buttons
        saveButton.connect('clicked', saveTimerName);
        cancelButton.connect('clicked', cancelEdit);

        // Handle Enter key press on the entry field
        entry.clutter_text.connect('activate', saveTimerName);

        // Auto-focus the entry field after a slight delay
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            if (entry && entry.get_stage()) {
                entry.grab_key_focus();
            }
            return GLib.SOURCE_REMOVE;
        });

        // Store the edit mode state and entry field
        timer.isEditing = true;
        timer.editEntry = entry;
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
            startTime: null,
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
                let elapsed = (currentTime - timer.startTime) / 1000000;
                timer.timeElapsed += elapsed;
                timer.startTime = null;
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
                log(`Warning: UI elements not found for timer "${timer.name}"`);
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
                this._label.text = 'Tracker';
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
                if (timer.running && timer.startTime) {
                    // Ensure startTime is a number
                    let startTime = parseInt(timer.startTime, 10);
                    if (isNaN(startTime)) {
                        // If parsing fails, reset startTime
                        timer.startTime = currentTime;
                        startTime = currentTime;
                    }
                    let elapsed = (currentTime - startTime) / 1000000;
                    let totalElapsed = timer.timeElapsed + elapsed;
                    uiElements.timeLabel.text = this._formatTime(totalElapsed);
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
        if (timer.running && timer.startTime) {
            let elapsed = (currentTime - timer.startTime) / 1000000;
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
                let uiElements = this._timerUIElements.get(timer.id);
                let {item, nameLabel, eyeButton, playPauseButton, editButton, deleteButton, timeLabel} = uiElements;
                let entry = timer.editEntry;

                if (entry && typeof entry.get_parent === 'function') {
                    // Replace the entry with the original name label
                    let entryParent = entry.get_parent();
                    entryParent.replace_child(entry, nameLabel);
                } else {
                    log(`Error: Invalid entry for timer "${timer.name}"`);
                    // In case entry is invalid, reset the name label
                    if (nameLabel && nameLabel.get_parent) {
                        let parent = nameLabel.get_parent();
                        parent.replace_child(nameLabel, nameLabel);
                    }
                }

                // Remove Save and Cancel buttons
                if (timer.saveButton && item.contains(timer.saveButton)) {
                    item.remove_child(timer.saveButton);
                }
                if (timer.cancelButton && item.contains(timer.cancelButton)) {
                    item.remove_child(timer.cancelButton);
                }

                // Show the previously hidden elements
                eyeButton.show();
                playPauseButton.show();
                editButton.show();
                deleteButton.show();
                timeLabel.show();

                // Reset the editing state
                timer.isEditing = false;
                timer.editEntry = null;
                timer.saveButton = null;
                timer.cancelButton = null;
            }
        });
    }


    _formatTime(seconds) {
        let hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
        let mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        let secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${hrs}:${mins}:${secs}`;
    }

    destroy() {
        if (this._timerUpdate) {
            GLib.source_remove(this._timerUpdate);
            this._timerUpdate = null;
        }

        // Clean up settings
        if (this._settings) {
            this._settings.run_dispose();
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
