const { BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const appConfig = require("../shared/app-config");

class IntercomWindowManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.intercomWindow = null;
    this.autoCloseTimeout = null;
    this.pendingCameraStream = null;
    this.onOpenGate = null;

    this.setupIpcHandlers();
  }

  setOnOpenGate(callback) {
    this.onOpenGate = callback;
  }

  setupIpcHandlers() {
    ipcMain.on("intercom-open-gate", () => {
      if (this.onOpenGate) this.onOpenGate();
      this.closeIntercomWindow();
    });

    ipcMain.on("intercom-close", () => {
      this.closeIntercomWindow();
    });
  }

  getAutoCloseMs() {
    return appConfig.intercom?.autoCloseMs || 120000;
  }

  showDialog(cameraStream = null) {
    this.pendingCameraStream = cameraStream;

    // Se il popup è già aperto, riportalo in primo piano e riavvia il timer
    if (this.intercomWindow && !this.intercomWindow.isDestroyed()) {
      this.startAutoCloseTimer();
      this.intercomWindow.webContents.send("intercom-reset-timer", {
        durationMs: this.getAutoCloseMs(),
      });
      if (this.pendingCameraStream) {
        this.intercomWindow.webContents.send("intercom-camera", this.pendingCameraStream);
      }
      this.intercomWindow.show();
      this.intercomWindow.focus();
      return;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().bounds;
    const width = 440;
    const height = 300;
    const x = Math.round((screenWidth - width) / 2);
    const y = Math.round((screenHeight - height) / 2 - screenHeight * 0.15);

    try {
      const { webPreferences, ...windowOptions } = appConfig.intercomWindow || {};

      const intercomWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        minWidth: width,
        minHeight: height,
        maxWidth: width,
        maxHeight: height,
        icon: path.join(__dirname, "..", "..", appConfig.paths.iconPng),
        ...windowOptions,
        webPreferences,
      });
      this.intercomWindow = intercomWindow;

      intercomWindow.setAlwaysOnTop(true, "screen-saver");

      this.intercomWindow.loadFile(path.join(__dirname, "..", "..", appConfig.paths.intercomWindowHtml));

      this.intercomWindow.once("ready-to-show", () => {
        if (!this.intercomWindow || this.intercomWindow.isDestroyed()) return;
        this.intercomWindow.show();
        this.intercomWindow.focus();
        this.intercomWindow.webContents.send("intercom-init", {
          durationMs: this.getAutoCloseMs(),
        });
        if (this.pendingCameraStream) {
          this.intercomWindow.webContents.send("intercom-camera", this.pendingCameraStream);
        }
        this.startAutoCloseTimer();
      });

      intercomWindow.on("closed", () => {
        // Una finestra chiusa in ritardo non deve azzerare quella aperta nel frattempo
        if (this.intercomWindow !== intercomWindow) return;
        this.intercomWindow = null;
        this.pendingCameraStream = null;
        this.clearAutoCloseTimer();
      });
    } catch (error) {
      console.error("Errore nella creazione della finestra citofono:", error);
      this.intercomWindow = null;
      this.clearAutoCloseTimer();
    }
  }

  // Invia lo stream della telecamera al popup già aperto (risolto in modo asincrono)
  setCameraStream(cameraStream) {
    if (!cameraStream) return;
    this.pendingCameraStream = cameraStream;
    if (this.intercomWindow && !this.intercomWindow.isDestroyed() && !this.intercomWindow.webContents.isLoading()) {
      this.intercomWindow.webContents.send("intercom-camera", cameraStream);
    }
  }

  startAutoCloseTimer() {
    this.clearAutoCloseTimer();
    this.autoCloseTimeout = setTimeout(() => {
      this.closeIntercomWindow();
    }, this.getAutoCloseMs());
  }

  clearAutoCloseTimer() {
    if (this.autoCloseTimeout) {
      clearTimeout(this.autoCloseTimeout);
      this.autoCloseTimeout = null;
    }
  }

  closeIntercomWindow() {
    this.clearAutoCloseTimer();

    if (this.intercomWindow && !this.intercomWindow.isDestroyed()) {
      try {
        this.intercomWindow.close();
      } catch (error) {
        console.error("Errore nella chiusura della finestra citofono:", error);
      }
    }

    this.intercomWindow = null;
  }

  isDialogOpen() {
    return !!(this.intercomWindow && !this.intercomWindow.isDestroyed());
  }
}

module.exports = IntercomWindowManager;
