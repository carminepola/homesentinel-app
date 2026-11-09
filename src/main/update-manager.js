const { app, Notification } = require("electron");
const { execFileSync } = require("child_process");
const appConfig = require("../shared/app-config");

// Ogni quanto controllare gli aggiornamenti in background (solo Windows e AppImage)
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;

function isPackageInstalled(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Come è stata installata l'app, e quindi come si aggiorna:
//  - "auto": electron-updater scarica e installa da solo (Windows NSIS, AppImage)
//  - "package": ci pensa il gestore di pacchetti del sistema (repository Forgejo)
//  - "manual": nessun meccanismo automatico (es. avvio dai sorgenti)
function detectInstallation() {
  if (!app.isPackaged) {
    return { type: "sviluppo", mode: "manual" };
  }
  if (process.platform === "win32") {
    return { type: "Windows", mode: "auto" };
  }
  if (process.platform !== "linux") {
    return { type: process.platform, mode: "manual" };
  }
  if (process.env.APPIMAGE) {
    return { type: "AppImage", mode: "auto" };
  }
  if (isPackageInstalled("rpm", ["-q", "HomeSentinel"])) {
    return { type: "RPM", mode: "package", command: "sudo dnf upgrade --refresh HomeSentinel" };
  }
  if (isPackageInstalled("dpkg-query", ["-W", "homesentinel"])) {
    return { type: "DEB", mode: "package", command: "sudo apt update && sudo apt install --only-upgrade homesentinel" };
  }
  if (isPackageInstalled("pacman", ["-Q", "homesentinel"])) {
    return { type: "Arch", mode: "package", command: "sudo pacman -Syu" };
  }
  return { type: "sconosciuto", mode: "manual" };
}

class UpdateManager {
  constructor() {
    this.installation = detectInstallation();
    this.autoUpdater = null;
    this.mainWindow = null;
    this.checkTimer = null;
    this.status = { state: "idle" };
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  getInstallation() {
    return this.installation;
  }

  getStatus() {
    return { ...this.status, mode: this.installation.mode, type: this.installation.type, command: this.installation.command };
  }

  setStatus(status) {
    this.status = status;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("update-status", this.getStatus());
    }
  }

  start() {
    if (this.installation.mode !== "auto") return;

    // Caricato solo qui: nelle installazioni da pacchetto non serve
    const { autoUpdater } = require("electron-updater");
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = app.getVersion().includes("-beta");
    autoUpdater.logger = {
      info: (msg) => console.log("[updater]", msg),
      warn: (msg) => console.warn("[updater]", msg),
      error: (msg) => console.error("[updater]", msg),
      debug: () => {},
    };

    autoUpdater.on("checking-for-update", () => this.setStatus({ state: "checking" }));
    autoUpdater.on("update-not-available", () => this.setStatus({ state: "idle" }));
    autoUpdater.on("update-available", (info) => this.setStatus({ state: "downloading", version: info.version, percent: 0 }));
    autoUpdater.on("download-progress", (progress) => {
      this.setStatus({ state: "downloading", version: this.status.version, percent: Math.round(progress.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.setStatus({ state: "ready", version: info.version });
      if (Notification.isSupported()) {
        new Notification({
          title: appConfig.app.name,
          body: `Aggiornamento v${info.version} pronto: verrà installato al prossimo riavvio dell'app`,
        }).show();
      }
    });
    autoUpdater.on("error", (error) => {
      console.error("[updater] errore:", error?.message || error);
      this.setStatus({ state: "error", error: error?.message || String(error) });
    });

    setTimeout(() => this.checkNow(), FIRST_CHECK_DELAY_MS);
    this.checkTimer = setInterval(() => this.checkNow(), CHECK_INTERVAL_MS);
  }

  async checkNow() {
    if (!this.autoUpdater || this.status.state === "downloading" || this.status.state === "ready") return;
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      // L'errore viene già segnalato dall'evento "error"
    }
  }

  installNow() {
    if (!this.autoUpdater || this.status.state !== "ready") return false;
    // isSilent=false (installer NSIS visibile), isForceRunAfter=true (riapre l'app)
    setImmediate(() => this.autoUpdater.quitAndInstall(false, true));
    return true;
  }

  stop() {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
  }
}

module.exports = { UpdateManager, detectInstallation };
