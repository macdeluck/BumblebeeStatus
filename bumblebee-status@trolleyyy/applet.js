const Applet = imports.ui.applet;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Config = imports.misc.config;

DEFAULT_BUMBLEBEED_STATUS_TIMEOUT_SECONDS = 1;

function BumblebeeStatusUpdater(status_handler) {
    this._init(status_handler);
}

const BumblebeeDaemonStatus = {
    Unknown: 'unknown',
    NotInstalled: 'not-installed',
    Installed: 'installed',
    Running: 'running',
    Stopped: 'stopped'
};

const BumblebeeSwitchStatus = {
    Unknown: 'unknown',
    Inactive: 'inactive',
    Off: 'off',
    On: 'on'
};

BumblebeeStatusUpdater.prototype = {
    _init: function(status_handler) {
        this.status_handler = status_handler;
        this.handlers = [];
        this.current_status = {
            bbdaemon_status: BumblebeeDaemonStatus.Unknown,
            bbswitch_status: BumblebeeSwitchStatus.Unknown
        };
    },

    has_finished: function() {
        return this.handlers.length == 0;
    },

    get_current_status_async: function() {
        if (this.current_status.bbdaemon_status == BumblebeeDaemonStatus.Unknown) {
            this.spawn_command_if_needed("which bumblebeed", this.on_get_bumblebeed_installation_info);
        }
        if (this.current_status.bbdaemon_status != BumblebeeDaemonStatus.Unknown &&
            this.current_status.bbdaemon_status != BumblebeeDaemonStatus.NotInstalled) {
            this.spawn_command_if_needed("pgrep bumblebeed", this.on_get_bumblebeed_daemon_status);
        }
        if (this.current_status.bbdaemon_status != BumblebeeDaemonStatus.NotInstalled) {
            this.spawn_command_if_needed("cat /proc/acpi/bbswitch", this.on_get_bbswitch_info);
        }
    },

    spawn_command_if_needed: function(cmd, handler, bind = true) {
        if (this.handlers.indexOf(handler) >= 0) {
            return;
        }
        this.handlers.push(handler);
        let targetHandler = handler;
        if (bind) {
            targetHandler = Lang.bind(this, handler);
        }
        try {
            Util.spawn_async(["sh", "-c", "(" + cmd + ") || exit 0"], targetHandler);
        }
        catch (err) {
            global.logError("Error occured", err);
        }
    },

    resolve: function(handler) {
        let i = this.handlers.indexOf(handler);
        if (i < 0) {
            global.logError("Unable to resolve handler", handler);
            return;
        }
        this.handlers.splice(i, 1);
        this.status_handler(this.current_status);
    },

    on_get_bumblebeed_installation_info: function(output) {
        if (output) {
            this.current_status = {
                bbdaemon_status: BumblebeeDaemonStatus.Installed,
                bbswitch_status: this.current_status.bbswitch_status
            };
            this.spawn_command_if_needed(["pgrep", "bumblebeed"], this.on_get_bumblebeed_daemon_status);
        }
        this.resolve(this.on_get_bumblebeed_installation_info);
    },

    on_get_bumblebeed_daemon_status: function(output) {
        let bbdaemon_status = BumblebeeDaemonStatus.Stopped;
        if (output && output.trim().length > 0) {
            bbdaemon_status = BumblebeeDaemonStatus.Running;
        }
        this.current_status = {
            bbdaemon_status: bbdaemon_status,
            bbswitch_status: this.current_status.bbswitch_status
        };
        this.resolve(this.on_get_bumblebeed_daemon_status);
    },

    on_get_bbswitch_info: function(output) {
        let status = BumblebeeSwitchStatus.Unknown;
        if (output && output.trim().endsWith("OFF")) {
            status = BumblebeeSwitchStatus.Off;
        } else if (output && output.trim().endsWith("ON")) {
            status = BumblebeeSwitchStatus.On;
        }
        this.current_status = {
            bbdaemon_status: this.current_status.bbdaemon_status,
            bbswitch_status: status
        };
        this.resolve(this.on_get_bbswitch_info);
    }
}

function BumblebeeStatusApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

BumblebeeStatusApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function (metadata, orientation, panel_height, instance_id) {
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        try {
            this.metadata = metadata;
            Main.systrayManager.registerRole("bumblebee-status", metadata.uuid);

            let cinnamonVersion = Config.PACKAGE_VERSION.split('.');
            let majorVersion = parseInt(cinnamonVersion[0]);
            let midVersion = parseInt(cinnamonVersion[1]);
            this.use_pkexec = majorVersion > 3 || (majorVersion == 3 && midVersion > 5);

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.current_daemon_action = null;

            this.updater = new BumblebeeStatusUpdater(Lang.bind(this, this.set_status_handler));
            this.bumblebee_status = this.updater.current_status;
            this.lastStatusIcon = null;
            this.lastStatusText = null;
            this.lastBbDaemonOption = null;
            this.get_current_status_async();
            this.update_menu();
            this.update_icon();
            this.start_loop(DEFAULT_BUMBLEBEED_STATUS_TIMEOUT_SECONDS, Lang.bind(this, this.loop_body));
        } catch (e) {
            global.logError(e);
        }
    },

    change_bumblebee_daemon_status: function(action) {
        let cmd = "systemctl " + action + " bumblebeed.service";
        if (this.use_pkexec) {
            Util.spawnCommandLine("sh -c 'pkexec " + cmd + "'");
        } else {
            Util.spawnCommandLine("gksu '" + cmd + "'");
        }
    },

    get_current_status_async: function() {
        this.updater.get_current_status_async();
    },

    set_status_handler: function(bumblebee_status) {
        this.bumblebee_status = bumblebee_status;
    },

    update_icon: function() {
        switch (this.bumblebee_status.bbdaemon_status) {
            case BumblebeeDaemonStatus.Stopped:
            case BumblebeeDaemonStatus.Installed:
                statusIcon = "bumblebee-status-inactive";
                statusText = _("The bumblebee service is not running");
                break;
            case BumblebeeDaemonStatus.NotInstalled:
                statusIcon = "bumblebee-status-unavailable";
                statusText = _("The bumblebee is not installed");
                break;
            default:
                statusIcon = "bumblebee-status-unavailable";
                statusText = _("Unknown error");
                break;
        }
        if (this.bumblebee_status.bbdaemon_status == BumblebeeDaemonStatus.Running) {
            switch (this.bumblebee_status.bbswitch_status) {
                case BumblebeeSwitchStatus.On:
                    statusIcon = "bumblebee-status-on";
                    statusText = _("The high performance GPU is ON");
                    break;
                case BumblebeeSwitchStatus.Off:
                    statusIcon = "bumblebee-status-off";
                    statusText = _("The high performance GPU is OFF");
                    break;
                case BumblebeeSwitchStatus.Unknown:
                    statusIcon = "bumblebee-status-unavailable";
                    statusText = _("Test for bumblebee status returned unexpected result");
                    break;
            }
        }
        if (this.lastStatusIcon != statusIcon) {
            this.lastStatusIcon = statusIcon;
            this.set_applet_icon_name(statusIcon);
        }
        if (this.lastStatusText != statusText) {
            this.lastStatusText = statusText;
            this.set_applet_tooltip(statusText);
        }
    },

    create_daemon_menu_item: function() {
        if (!this.daemonMenuItem) {
            global.log("creating daemonMenuItem");
            this.daemonMenuItem = this.menu.addAction(_(""), Lang.bind(this, function () {
                this.change_bumblebee_daemon_status(this.lastBbDaemonOption == "running" ? "stop" : "start");
            }));
        }
    },

    destroy_daemon_menu_item: function() {
        if (this.daemonMenuItem) {
            global.log("destroying daemonMenuItem");
            this.daemonMenuItem.destroy();
            this.daemonMenuItem = null;
        }
    },

    update_menu: function() {
        let bbDaemonOption = null;
        if (this.bumblebee_status.bbdaemon_status == BumblebeeDaemonStatus.Running) {
            bbDaemonOption = "running";
        } else if (this.bumblebee_status.bbdaemon_status == BumblebeeDaemonStatus.Stopped) {
            bbDaemonOption = "stopped";
        }
        if (bbDaemonOption != this.lastBbDaemonOption) {
            this.lastBbDaemonOption = bbDaemonOption;
            if (bbDaemonOption == "running") {
                this.create_daemon_menu_item();
                this.daemonMenuItem.label.set_text(_("Stop Bumblebee daemon"));
            } else if (bbDaemonOption == "stopped") {
                this.create_daemon_menu_item();
                this.daemonMenuItem.label.set_text(_("Start Bumblebee daemon"));
            } else {
                this.destroy_daemon_menu_item();
            }
        }
    },

    loop_body: function() {
        this.get_current_status_async();
        this.update_menu();
        this.update_icon();
    },

    start_loop: function (delay, loop_body) {
        this.destroy_loop();

        let loop_body_wrapper = function () {
            let res = loop_body();
            if (res) {
                return res;
            }
            return GLib.SOURCE_CONTINUE;
        }

        this.loopId = Mainloop.timeout_add_seconds(delay, loop_body_wrapper);
    },

    destroy_loop: function () {
        if (this.loopId > 0) {
            Mainloop.source_remove(this.loopId);
        }
    },

    on_applet_clicked: function (event) {
        if (this.daemonMenuItem) {
            this.menu.toggle();
        }
    },

    on_applet_removed_from_panel: function () {
        Main.systrayManager.unregisterRole("bumblebee-status", this.metadata.uuid);
        this.destroy_loop();
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new BumblebeeStatusApplet(metadata, orientation, panel_height, instance_id);
}
