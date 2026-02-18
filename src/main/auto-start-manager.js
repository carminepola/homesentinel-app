const { app } = require("electron");
const path = require("path");
const fs = require("fs");

class AutoStartManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }

  // Imposta l'avvio automatico
  async setAutoStart(enabled) {
    switch (process.platform) {
      case "win32":
        return this.setAutoStartWindows(enabled);
      case "linux":
        return this.setAutoStartLinux(enabled);
      case "darwin":
        return this.setAutoStartMac(enabled);
      default:
        console.warn("Auto-start non supportato per questa piattaforma:", process.platform);
        return false;
    }
  }

  // Verifica se l'avvio automatico è attivo
  async isAutoStartEnabled() {
    switch (process.platform) {
      case "win32":
        return this.isAutoStartEnabledWindows();
      case "linux":
        return this.isAutoStartEnabledLinux();
      case "darwin":
        return this.isAutoStartEnabledMac();
      default:
        return false;
    }
  }

  // Implementazione Windows
  setAutoStartWindows(enabled) {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: enabled,
        path: process.execPath,
        args: []
      });
      return true;
    } catch (error) {
      console.error("Errore nell'impostazione dell'avvio automatico su Windows:", error);
      return false;
    }
  }

  isAutoStartEnabledWindows() {
    try {
      const loginItemSettings = app.getLoginItemSettings();
      return loginItemSettings.openAtLogin || false;
    } catch (error) {
      console.error("Errore nel verificare l'avvio automatico su Windows:", error);
      return false;
    }
  }

  // Implementazione Linux
  setAutoStartLinux(enabled) {
    try {
      const autostartDir = path.join(process.env.HOME, ".config", "autostart");
      const desktopFile = path.join(autostartDir, "ha-cam.desktop");

      if (enabled) {
        // Crea la directory autostart se non esiste
        if (!fs.existsSync(autostartDir)) {
          fs.mkdirSync(autostartDir, { recursive: true });
        }

        // Crea il file .desktop
        const execPath = process.execPath;
        const desktopContent = `[Desktop Entry]
Type=Application
Name=Ha-Cam
Comment=Home Assistant Camera Monitor
Exec=${execPath}
Icon=${path.join(path.dirname(execPath), "resources", "icon.png")}
Terminal=false
X-MultipleArgs=false
Categories=Utility;
StartupNotify=false
`;

        fs.writeFileSync(desktopFile, desktopContent);
        console.log("File autostart creato:", desktopFile);
        return true;
      } else {
        // Rimuovi il file .desktop se esiste
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
      const desktopFile = path.join(autostartDir, "ha-cam.desktop");
      return fs.existsSync(desktopFile);
    } catch (error) {
      console.error("Errore nel verificare l'avvio automatico su Linux:", error);
      return false;
    }
  }

  // Implementazione macOS
  setAutoStartMac(enabled) {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: enabled,
        path: process.execPath,
        args: []
      });
      return true;
    } catch (error) {
      console.error("Errore nell'impostazione dell'avvio automatico su macOS:", error);
      return false;
    }
  }

  isAutoStartEnabledMac() {
    try {
      const loginItemSettings = app.getLoginItemSettings();
      return loginItemSettings.openAtLogin || false;
    } catch (error) {
      console.error("Errore nel verificare l'avvio automatico su macOS:", error);
      return false;
    }
  }

  // Sincronizza l'impostazione dell'avvio automatico con le impostazioni salvate
  async syncAutoStart() {
    const settings = this.settingsManager.getSettings();
    const autoStart = settings.autoStart || false;

    const currentStatus = await this.isAutoStartEnabled();
    if (currentStatus !== autoStart) {
      console.log("Sincronizzazione auto-start:", autoStart);
      await this.setAutoStart(autoStart);
    }
  }
}

module.exports = AutoStartManager;
