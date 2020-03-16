const Applet = imports.ui.applet;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;

function BumblebeeStatusApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

DEFAULT_BUMBLEBEED_STATUS_TIMEOUT_SECONDS = 2;

BumblebeeStatusApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        
        try {
            this.metadata = metadata;
            Main.systrayManager.registerRole("bumblebee-status", metadata.uuid);
            this._testStatus();
            this._restartPeriodicUpdateTimer(DEFAULT_BUMBLEBEED_STATUS_TIMEOUT_SECONDS);
        } catch (e) {
            global.logError(e);
        }
    },

    _periodicUpdateIcon: function() {
        this._testStatus();
        return GLib.SOURCE_CONTINUE;
    },

    _restartPeriodicUpdateTimer: function(new_delay) {
        if (this._periodicTimeoutId > 0) {
            Mainloop.source_remove(this._periodicTimeoutId);
        }

        this._updateFrequencySeconds = new_delay;
        this._periodicTimeoutId = Mainloop.timeout_add_seconds(this._updateFrequencySeconds, Lang.bind(this, this._periodicUpdateIcon));
    },

    _testStatus: function() {
        let srvOut = this._doCommand(["bash", "-c", "ps axco command | grep bumblebeed"])
        if (srvOut && srvOut.length > 0) {
            let out = this._doCommand(["cat", "/proc/acpi/bbswitch"]);
            if (out.endsWith("OFF")) {
                this.set_applet_icon_name("bumblebee-status-off");
                this.set_applet_tooltip(_("The high performance GPU is OFF"));
            } else if (out.endsWith("ON")) {
                this.set_applet_icon_name("bumblebee-status-on");
                this.set_applet_tooltip(_("The high performance GPU is ON"));
            }
        } else {
            this.set_applet_icon_name("bumblebee-status-inactive");
            this.set_applet_tooltip(_("The bumblebee service is not running"));
        }
    },

    _doCommand: function(command) {
        [res,pid,fdin,fdout,fderr] = GLib.spawn_async_with_pipes(null, command, null, GLib.SpawnFlags.SEARCH_PATH, null);
        let outstream = new Gio.UnixInputStream({fd:fdout,close_fd:true});
        let stdout = new Gio.DataInputStream({base_stream: outstream});

        let [out, size] = stdout.read_line(null);

        if (out == null) {
            global.logError("nvidia-prime applet: Could not execute " + command);
        } else {
            return out.toString();
        }
    },
    
    on_applet_clicked: function(event) {
        // this.menu.toggle();
    },

    on_applet_removed_from_panel: function() {
        Main.systrayManager.unregisterRole("bumblebee-status", this.metadata.uuid);
        if (this._periodicTimeoutId) {
            Mainloop.source_remove(this._periodicTimeoutId);
        }
    },
    
    getDisplayLayout: function() {
        return Applet.DisplayLayout.BOTH;
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new BumblebeeStatusApplet(metadata, orientation, panel_height, instance_id);
}
