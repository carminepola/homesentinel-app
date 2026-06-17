const { Tray, Menu, nativeImage, app } = require("electron");
const path = require("path");
const fs = require("fs");
const appConfig = require("../shared/app-config");

class TrayManager {
  constructor(settingsManager) {
    this.mainWindow = null;
    this.settingsManager = settingsManager;
    this.tray = null;
    this.isAvailable = false;
    const settings = settingsManager.getSettings();
    this.dndMode = settings.dndMode || false;
    this.onDndModeChange = null;
    this.onQuit = null;
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  setEventCallbacks(callbacks) {
    this.onDndModeChange = callbacks.onDndModeChange;
    this.onQuit = callbacks.onQuit;
  }

  createTray() {
    try {
      if (process.platform === "linux" && this._isGnomeWithoutTray()) {
        console.log("ℹ️ GNOME rilevato senza supporto tray icon");
        this.isAvailable = false;
        return false;
      }

      const trayIcon = this._loadTrayIcon();
      if (!trayIcon) throw new Error("Nessuna icona valida trovata");

      this.tray = new Tray(trayIcon);
      this.tray.setToolTip(appConfig.app.name);
      this._updateContextMenu();

      // Click sinistro → mostra finestra
      this.tray.on("click", () => {
        if (process.platform === "win32") {
          this.tray.popUpContextMenu();
        } else {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
          }
        }
      });

      // Click destro → apre menu contestuale (cross-platform)
      this.tray.on("right-click", () => {
        this.tray.popUpContextMenu();
      });

      this.isAvailable = true;
      console.log("✅ Tray creata con successo");
      return true;
    } catch (error) {
      console.error("❌ Errore nella creazione della tray:", error);
      this.isAvailable = false;
      try {
        const emptyIcon = nativeImage.createEmpty();
        this.tray = new Tray(emptyIcon);
        this._updateContextMenu();
      } catch (fallbackError) {
        console.error("❌ Fallback tray fallito:", fallbackError);
      }
      return false;
    }
  }

  _isGnomeWithoutTray() {
    const xdgDesktop = process.env.XDG_CURRENT_DESKTOP || "";
    const gnomeVariants = ["GNOME", "GNOME-Classic", "ubuntu:GNOME"];
    if (!gnomeVariants.some(d => xdgDesktop.includes(d))) return false;

    try {
      const { execSync } = require("child_process");
      execSync("dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -q 'org.kde.StatusNotifierWatcher'", {
        timeout: 2000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return false;
    } catch {
      return true;
    }
  }

  _loadTrayIcon() {
    const possibiliPercorsi = [
      path.join(__dirname, "..", "..", "assets/try-icon.svg"), // Prima prova SVG
      path.join(__dirname, "..", "..", "assets/try-icon.png"), // Fallback a PNG
      path.join(process.resourcesPath, "icon.svg"), // SVG nelle risorse
      path.join(process.resourcesPath, "icon.png"), // PNG nelle risorse
    ];

    for (const percorso of possibiliPercorsi) {
      if (fs.existsSync(percorso)) {
        try {
          let icona = nativeImage.createFromPath(percorso);
          if (!icona.isEmpty()) {
            // Per SVG, non ridimensionare forzatamente su Linux per mantenere la qualità
            if (process.platform === "linux") {
              icona.setTemplateImage(true); // Importante per GNOME
              // Su Linux con SVG, è meglio non ridimensionare forzatamente
              // Il sistema gestirà automaticamente le dimensioni appropriate
            } else {
              // Per Windows e macOS, ridimensiona se necessario
              icona = icona.resize({ width: 512, height: 512, quality: "best" });
              icona.setTemplateImage(false);
            }
            console.log(`Icona tray caricata da: ${percorso}`);
            return icona;
          }
        } catch (err) {
          console.warn(`Errore nel caricare ${percorso}:`, err.message);
        }
      }
    }
    return null;
  }

  _updateContextMenu() {
    const template = [
      {
        label: "Mostra finestra principale",
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "Non disturbare",
        type: "checkbox",
        checked: this.dndMode,
        click: () => this._toggleDndMode(),
      },
      { type: "separator" },
      {
        label: "Esci",
        click: () => {
          if (this.onQuit) this.onQuit();
          else app.quit();
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    if (this.tray) this.tray.setContextMenu(menu);
  }

  _toggleDndMode() {
    this.dndMode = !this.dndMode;
    this._updateContextMenu();
    if (this.onDndModeChange) this.onDndModeChange(this.dndMode);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("dnd-mode-changed", this.dndMode);
    }
    const settings = this.settingsManager.getSettings();
    settings.dndMode = this.dndMode;
    this.settingsManager.updateSettings(settings);
    this.settingsManager.saveSettingsToFile();
  }

  setDndMode(enabled) {
    this.dndMode = enabled;
    this._updateContextMenu();
    if (this.onDndModeChange) this.onDndModeChange(this.dndMode);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("dnd-mode-changed", this.dndMode);
    }
    const settings = this.settingsManager.getSettings();
    settings.dndMode = this.dndMode;
    this.settingsManager.updateSettings(settings);
    this.settingsManager.saveSettingsToFile();
  }

  getDndMode() {
    return this.dndMode;
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
