Make an extension for Gnome IDE to manage multiple timers.
It should display a clickable label in the Gnome panel. This label should show the text "Tracker" by default.
Clicking the Tracker label/button should display the panel with several items (from top to bottom):
- total time from all timers
- list of timers
- row with buttons represented as icons: pause all timers, add new timer

Items in the list of timers should have the following layout (from left to right):
- greyed out eye icon (or a white eye icon, if selected) indicating that the timer value of the selected timer(s) should be displayed in the Gnome panel instead of default "Tracker" text
- label with the timer name
- timer time
- icon button (play/pause) to start/pause the timer (icon changes depending on the current state of the timer)
- icon button (pencil) to modify timer name
- icon button (basket) to remove the timer

Hovering a timer item in the list should highlight it as a normal menu item.

If multiple timers selected using the eye icon, the sum of selected timers values should be displayed in the Gnome panel. By default no timer should be selected.
The first item in the panel "total time from all timers" should also have an eye icon, which should display the sum of all timers in the Gnome panel instead of the default "Tracker" label. It should deselect all specific timers in the list when pressed.  

Pressing the Edit timer button should change the timer label to the input and allow to modify the timer name.
There should be two buttons on the right to the input: save (checkmark icon) and cancel (X cross icon).

Pressing the Add new timer button should add an empty timer to the end of the list in paused state. 
Default timer name is "<empty>". Default eye icon state: not selected. Default timer value: 00:00:00

The timers states should be persistent between the shell restarts and screen locks.

* * *

Debug with:
```shell
dbus-run-session -- gnome-shell --nested --wayland
```

* * *

Compile schemas:
```shell
glib-compile-schemas schemas/
```

