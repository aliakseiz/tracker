import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const TaskTimeTracker = GObject.registerClass(
class TaskTimeTracker extends PanelMenu.Button {
    // Initialization function
    _init(extension) {
        super._init(0.0, 'Tracker', false); // Initialize the button with a label and other properties

        this.extension = extension; // Reference to the extension instance
        this.settings = this.extension.getSettings('org.gnome.shell.extensions.task-time-tracker'); // Load settings

        this._initUI(); // Initialize the user interface
        this._loadItems(); // Load the task items from settings
        this._connectSignals(); // Connect necessary signals
    }

    // Initialize the user interface
    _initUI() {
        let label = new St.Label({
            text: 'Tracker',
            y_align: Clutter.ActorAlign.CENTER
        });

        this.add_child(label); // Add the label to the button

        // Create the menu and add it to the UI
        this.menu = new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP);
        this.menu.actor.add_style_class_name('task-time-tracker-menu');
        Main.layoutManager.uiGroup.add_child(this.menu.actor);
        this.menu.close();

        // Create a box layout for the menu content
        this.box = new St.BoxLayout({ vertical: true });
        let boxItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
        boxItem.add_child(this.box);
        this.menu.addMenuItem(boxItem);

        this.itemList = new St.BoxLayout({ vertical: true }); // List to hold task items
        this.box.add_child(this.itemList);

        this.inputItem = new St.Entry({ hint_text: "New item...", can_focus: true }); // Input field for new tasks
        this.box.add_child(this.inputItem);


//------------------
        // add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'task-time-tracker-menu-button-container'
        });

        let customButtonBox = new St.BoxLayout({
            style_class: 'task-time-tracker-button-box',
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true,
            pack_start: false
        });

        // custom round add button
        let addButton = this._createRoundButton('view-refresh-symbolic', _('Refresh'));
        addButton.connect('clicked', (self) => {
            this._addNewItem();
        });
        customButtonBox.add_child(addButton);

        // custom start button
        let startButton = this._createRoundButton('org.gnome.SystemMonitor-symbolic', _('System Monitor'));
        startButton.connect('clicked', (self) => {
            this._startAllTimers();
        });
        customButtonBox.add_child(startButton);

        // custom pause button
        let pauseButton = this._createRoundButton('preferences-system-symbolic', _('Preferences'));
        pauseButton.connect('clicked', (self) => {
            this._pauseAllTimers()
        });
        customButtonBox.add_child(pauseButton);

        // now add the buttons to the top bar
        item.actor.add_child(customButtonBox);

        // add buttons
        this.menu.addMenuItem(item);

//------------------

        // Add buttons to the menu
        //this._addButtonToBox('+', () => this._addNewItem(), this.box);
        //this._addButtonToBox('Start All', () => this._startAllTimers(), this.box);
        //this._addButtonToBox('Pause All', () => this._pauseAllTimers(), this.box);

        this.connect('button-press-event', () => this.menu.open()); // Open the menu on button press
    }
    
    _createRoundButton(iconName) {
        let button = new St.Button({
            style_class: 'message-list-clear-button button task-time-tracker-button-action'
        });

        button.child = new St.Icon({
            icon_name: iconName
        });

        return button;
    }

    // Load task items from settings
    _loadItems() {
        this.items = this.settings.get_value('items').deep_unpack();
        this.itemList.destroy_all_children(); // Clear the list first
        let filteredItems = this.items.filter(item => item[0] !== undefined && item[1] !== undefined); // Filter out corrupted elements
        this.items = []; // Clear the items array to prevent duplication
        filteredItems.forEach(item => this._addItem(item[0], item[1], false)); // Add each item to the UI
    }



    // Add a new task item
    _addItem(text, time = 0) {
        let itemBox = new St.BoxLayout({ vertical: false }); // Box for each task item
        let label = new St.Label({ text, style_class: 'task-label' }); // Label for task name
        let timeLabel = new St.Label({ text: this._formatTime(time), style_class: 'time-label' }); // Label for task time

        let timer = { time, interval: null, timeLabel, actor: itemBox }; // Timer object

        // Connect events for label (left-click to toggle, right-click to reset)
        label.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) this._toggleTimer(timer);
            if (event.get_button() === 3) this._resetTimer(timer);
        });

        // Add buttons for removing and selecting tasks
        this._addButtonToBox('🗑', () => this._removeItem(itemBox, text, timer), itemBox);
        this._addButtonToBox('✓', () => this._selectItem(timer), itemBox);

        // Add label and timeLabel to itemBox
        itemBox.add_child(label);
        itemBox.add_child(timeLabel);
        this.itemList.add_child(itemBox); // Add itemBox to the list

        this.items.push([text, String(time)]); // Add item to items array
        this._saveItems(); // Save items to settings
    }

    // Add a new item from the input field
    _addNewItem() {
        let text = this.inputItem.get_text().trim(); // Get text from input field
        if (text) { // If text is not empty
            this._addItem(text); // Add the item
            this.inputItem.set_text(""); // Clear the input field
        }
    }

    // Remove a task item
    _removeItem(itemBox, text, timer) {
        this._pauseTimer(timer); // Pause the timer
        this.itemList.remove_child(itemBox); // Remove the itemBox from the list
        this.items = this.items.filter(item => item[0] !== text); // Remove the item from items array
        this._saveItems(); // Save items to settings
        if (this.selectedTimer === timer) this._deselectItem(); // Deselect the timer if it was selected
    }

    // Start a timer
    _startTimer(timer) {
        if (!this.runningTimers) {
            this.runningTimers = [];
        }

        // Set up a GLib timeout to update the timer every second
        timer.interval = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            timer.time++;
            timer.timeLabel.set_text(this._formatTime(timer.time));
            let text = this._getTaskText(timer.actor);

            if (text) {
                this.items.forEach(item => {
                    if (item[0] === text) item[1] = timer.time;
                });
                this._saveItems();

                if (this.selectedTimer === timer) {
                    this.actor.label.set_text(`${this.actor._text}: ${this._formatTime(timer.time)}`);
                }
            }
            return true;
        });

        // Add to running timers list
        this.runningTimers.push(timer);
    }

    // Pause a timer
    _pauseTimer(timer) {
        if (timer.interval !== null) {
            log(`Pausing timer for ${this._getTaskText(timer.actor)}`);
            GLib.Source.remove(timer.interval);
            timer.interval = null;

            // Remove from running timers list
            this.runningTimers = this.runningTimers.filter(t => t !== timer);
        }
    }

    // Reset a timer
    _resetTimer(timer) {
        this._pauseTimer(timer);
        timer.time = 0;
        timer.timeLabel.set_text(this._formatTime(timer.time));
        this._updateItemTime(timer);
    }

    // Format time from seconds to hh:mm:ss
    _formatTime(seconds) {
        let minutes = Math.floor(seconds / 60);
        let hours = Math.floor(minutes / 60);
        minutes = minutes % 60;
        seconds = seconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // Start all timers
    _startAllTimers() {
        this.itemList.get_children().forEach(child => {
            let text = this._getTaskText(child);
            if (text) {
                let item = this.items.find(item => item[0] === text);
                if (item) {
                    let timer = { time: parseInt(item[1]), interval: null, timeLabel: this._getTimeLabel(child), actor: child };
                    this._startTimer(timer);
                }
            }
        });
    }

    // Pause all timers
    _pauseAllTimers() {
        log('Pausing all timers');
        this.itemList.get_children().forEach(child => {
            let text = this._getTaskText(child);
            if (text) {
                let item = this.items.find(item => item[0] === text);
                if (item) {
                    let timer = { time: parseInt(item[1]), interval: null, timeLabel: this._getTimeLabel(child), actor: child };
                    // Find the running timer from the child
                    let runningTimer = this.runningTimers.find(t => t.actor === child);
                    if (runningTimer) {
                        this._pauseTimer(runningTimer);
                    }
                }
            }
        });
    }

    // Select a timer
    _selectItem(timer) {
        if (this.selectedTimer) {
            this.selectedTimer = null;
            this.actor.label.set_text(this.actor._text);
        }
        if (this.selectedTimer !== timer) {
            this.selectedTimer = timer;
            this.actor.label.set_text(`${this.actor._text}: ${this._formatTime(timer.time)}`);
        }
    }

    // Deselect a timer
    _deselectItem() {
        this.selectedTimer = null;
        this.actor.label.set_text(this.actor._text);
    }

    // Add a button to a box
    _addButtonToBox(label, callback, box) {
        let button = new St.Button({ label });
        button.connect('clicked', callback);
        box.add_child(button);
    }

    // Save items to settings
    _saveItems() {
       this.settings.set_value('items', new GLib.Variant('aa{ss}', this.items.map(item => [item[0], String(item[1])])));
    }

    // Update item time in settings
    _updateItemTime(timer) {
        let text = this._getTaskText(timer.actor);
        if (text) {
            this.items.forEach(item => {
                if (item[0] === text) item[1] = timer.time;
            });
            this._saveItems();
            if (this.selectedTimer === timer) {
                this.actor.label.set_text(`${this.actor._text}: ${this._formatTime(timer.time)}`);
            }
        }
    }

    // Get the task text from an actor
    _getTaskText(actor) {
        return actor.get_children().find(child => child.has_style_class_name('task-label'))?.get_text();
    }

    // Get the time label from an actor
    _getTimeLabel(actor) {
        return actor.get_children().find(child => child.has_style_class_name('time-label'));
    }

    // Connect signals
    _connectSignals() {
        this.screenLockSignal = Main.screenShield.connect('lock-screen', () => this._pauseAllTimers());
    }

    // Disconnect signals
    _disconnectSignals() {
        Main.screenShield.disconnect(this.screenLockSignal);
    }

    // Destroy the extension
    destroy() {
        this._disconnectSignals();
        this.settings.run_dispose();
        super.destroy();
    }
});

export default class TaskTimeTrackerExtension extends Extension {
    enable() {
        this._indicator = new TaskTimeTracker(this);
        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

