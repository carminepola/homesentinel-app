const { app } = require("electron");
const path = require("path");
const fs = require("fs");

class AutoStartManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }

  async setAutoStart(enabled) {
    switch (process.platform) {
      case "win32":
      case "darwin":
        return this.setAutoStartNative(enabled);
      case "linux":
        return this.setAutoStartLinux(enabled);
      default:
        console.warn("Auto-start non supportato per questa piattaforma:", process.platform);
        return false;
    }
  }

  async isAutoStartEnabled() {
    switch (process.platform) {
      case "win32":
      case "darwin":
        return this.isAutoStartEnabledNative();
      case "linux":
        return this.isAutoStartEnabledLinux();
      default:
        return false;
    }
  }

  setAutoStartNative(enabled) {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: enabled,
        path: process.execPath,
        args: ["--autostart"]
      });
      return true;
    } catch (error) {
      console.error("Errore nell'impostazione dell'avvio automatico su", process.platform, ":", error);
      return false;
    }
  }

  isAutoStartEnabledNative() {
    try {
      const loginItemSettings = app.getLoginItemSettings();
      return loginItemSettings.openAtLogin || false;
    } catch (error) {
      console.error("Errore nel verificare l'avvio automatico su", process.platform, ":", error);
      return false;
    }
  }

  setAutoStartLinux(enabled) {
    try {
      const autostartDir = path.join(process.env.HOME, ".config", "autostart");
      const desktopFile = path.join(autostartDir, "HomeSentinel.desktop");

      if (enabled) {
        if (!fs.existsSync(autostartDir)) {
          fs.mkdirSync(autostartDir, { recursive: true });
        }

        const execPath = process.execPath;
        const appPath = app.getAppPath();
        let iconPath = path.join(path.dirname(execPath), "resources", "icon.png");

        if (!fs.existsSync(iconPath)) {
          const iconCandidates = [
            path.join(appPath, "assets", "icon.png"),
            path.join(path.dirname(execPath), "icon.png"),
            path.join(path.dirname(execPath), "resources", "app.asar.unpacked", "assets", "icon.png")
          ];
          for (const candidate of iconCandidates) {
            if (fs.existsSync(candidate)) {
              iconPath = candidate;
              break;
            }
          }
          if (!fs.existsSync(iconPath)) {
            iconPath = execPath;
          }
        }

        const desktopContent = `[Desktop Entry]
Type=Application
Name=HomeSentinel
Comment=Home Assistant Camera Monitor
Exec=${execPath} --autostart
TryExec=${execPath}
Icon=${iconPath}
Terminal=false
StartupNotify=true
StartupWMClass=HomeSentinel
Categories=Utility;
X-GNOME-Autostart-enabled=true
X-MATE-Autostart-enabled=true
`;

        fs.writeFileSync(desktopFile, desktopContent);
        console.log("File autostart creato:", desktopFile);
        return true;
      } else {
        if (fs.existsSync(desktopFile)) {
          fs.unlinkSync(desktopFile);
          console.log("File autostart rimosso:", desktopFile);
        }
        return true;
      }
    } catch (error) {
      console.error("Errore nell'impostazione dell'avvio automatico su Linux:", error);
      return false;
    }
  }

  isAutoStartEnabledLinux() {
    try {
      const autostartDir = path.join(process.env.HOME, ".config", "autostart");
      const desktopFile = path.join(autostartDir, "HomeSentinel.desktop");
      return fs.existsSync(desktopFile);
    } catch (error) {
      console.error("Errore nel verificare l'avvio automatico su Linux:", error);
      return false;
    }
  }

  async syncAutoStart() {
    const settings = this.settingsManager.getSettings();
    const autoStart = settings.autoStart || false;

    const currentStatus = await this.isAutoStartEnabled();
    if (currentStatus !== autoStart) {
      await this.setAutoStart(autoStart);
    } else if (autoStart) {
      await this.setAutoStart(autoStart);
    }
  }
}

module.exports = AutoStartManager;
