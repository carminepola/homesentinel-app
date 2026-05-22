const { app } = require("electron");

if (process.platform === "linux" && !process.argv.includes("--ozone-platform=x11")) {
  app.relaunch({ args: [...process.argv.slice(1), "--ozone-platform=x11"] });
  app.exit(0);
  return;
}

const { BrowserWindow, Menu, Notification, powerMonitor } = require("electron");
const path = require("path");

// Importa i moduli
const SettingsManager = require("./src/shared/settings-manager");
const WebSocketManager = require("./src/main/websocket-manager");
const PiPWindowManager = require("./src/main/pip-window-manager");
const AlarmWindowManager = require("./src/main/alarm-window-manager");
const TrayManager = require("./src/main/tray-manager");
const AutoStartManager = require("./src/main/auto-start-manager");
const IPCHandlers = require("./src/main/ipc-handlers");
const appConfig = require("./src/shared/app-config");

// Variabili globali
let mainWindow;
let isQuitting = false;
let settingsManager;
let websocketManager;
let pipWindowManager;
let alarmWindowManager;
let trayManager;
let autoStartManager;
let ipcHandlers;
let isWebSocketConnected = false;
let isSystemLocked = false;
let gotTheLock;
const isAutoStart = process.argv.includes("--autostart");

// Crea la finestra principale
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: appConfig.mainWindow.width,
    height: appConfig.mainWindow.height,
    minWidth: appConfig.mainWindow.minWidth,
    icon: path.join(__dirname, appConfig.paths.iconPng),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    show: false,
    skipTaskbar: isAutoStart,
  });

  mainWindow.loadFile(appConfig.paths.mainWindowHtml);

  mainWindow.once("ready-to-show", () => {
    if (isAutoStart) {
      mainWindow.hide();
      mainWindow.setSkipTaskbar(false);
      return;
    }

    const settings = settingsManager.getSettings();
    const hasHomeAssistantConfig = settings.homeAssistantUrl && settings.homeAssistantToken;
    const hasTray = trayManager && trayManager.isAvailable;

    if (hasHomeAssistantConfig) {
      if (hasTray) {
        mainWindow.hide();
      } else {
        mainWindow.minimize();
      }
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      if (trayManager && trayManager.isAvailable) {
        mainWindow.hide();
      } else {
        mainWindow.minimize();
      }
    }
  });

  // Menu dell'app
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Impostazioni",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            mainWindow.webContents.send("open-settings");
          },
        },
        { type: "separator" },
        {
          label: "Esci",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Visualizza",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Inizializza i gestori
function initializeManagers() {
  settingsManager = new SettingsManager(app);
  settingsManager.initializeSettingsPath();
  settingsManager.loadSettings();

  websocketManager = new WebSocketManager(settingsManager);
  pipWindowManager = new PiPWindowManager(settingsManager);
  pipWindowManager.setWebSocketManager(websocketManager);
  alarmWindowManager = new AlarmWindowManager(settingsManager);
  alarmWindowManager.setWebSocketManager(websocketManager);
  trayManager = new TrayManager(settingsManager);
  autoStartManager = new AutoStartManager(settingsManager);
  // ipcHandlers verrà inizializzato dopo la creazione della finestra
}

// Configura i callback per gli eventi
function setupEventCallbacks() {
  websocketManager.setEventCallbacks({
    onSensorEvent: (eventData) => {
      const dndMode = trayManager.getDndMode();
      if (dndMode || isSystemLocked) {
        return;
      }
      pipWindowManager.handleSensorEvent(eventData);
    },
    onAlarmEvent: (alarmData) => {
      if (alarmData.dismissed) {
        alarmWindowManager.dismissAlarm(alarmData.sensorState);
      } else {
        alarmWindowManager.triggerAlarm(alarmData);
      }
    },
    onConnectionStatusChange: (isConnected) => {
      const wasConnected = isWebSocketConnected;
      isWebSocketConnected = isConnected;
      mainWindow.webContents.send("connection-status-changed", isConnected);

      if (wasConnected !== isConnected) {
        new Notification({
          title: appConfig.app.name,
          body: isConnected ? "Connesso a Home Assistant" : "Disconnesso da Home Assistant",
          silent: false,
        }).show();
      }
    },
  });

  trayManager.setEventCallbacks({
    onDndModeChange: (dndMode) => {
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
}

// Eventi dell'applicazione
// Gestione istanza singola
gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Se un'altra istanza è già in esecuzione, esci
  app.quit();
} else {
  // Esegui il codice solo se abbiamo il lock dell'istanza singola
  app.whenReady().then(() => {
    try {
      // Ascolta per eventi di seconda istanza
      app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        }
      });
      // Imposta l'icona dell'applicazione a livello globale

      app.setAppUserModelId(appConfig.app.name);
      if (process.platform !== "darwin") {
        // Su Windows e Linux, imposta l'icona dell'applicazione
        iconPath = path.join(__dirname, appConfig.paths.icon);
        if (require("fs").existsSync(iconPath)) {
          app.setAppUserModelId(appConfig.app.name);
          if (process.platform === "win32") {
            app.setAppUserModelId(appConfig.app.name);
          }
        }
      }

      // Inizializza prima i gestori per avere accesso alle impostazioni
      initializeManagers();

      // Crea la tray prima della finestra per sapere se è disponibile
      trayManager.createTray();

      createMainWindow();

      // Imposta la finestra principale nel tray manager e negli ipc handlers
      trayManager.setMainWindow(mainWindow);
      ipcHandlers = new IPCHandlers(mainWindow, settingsManager, websocketManager, pipWindowManager, alarmWindowManager, autoStartManager, trayManager, () => {
        isQuitting = true;
        app.quit();
      });

      setupEventCallbacks();

      // Configura i gestori per gli eventi di blocco/sblocco del sistema
      powerMonitor.on("lock-screen", () => {
        isSystemLocked = true;
        pipWindowManager.setSystemLocked(true);
        console.log("Sistema bloccato - sospensione creazione finestre PiP");
      });

      powerMonitor.on("unlock-screen", () => {
        isSystemLocked = false;
        pipWindowManager.setSystemLocked(false);
        console.log("Sistema sbloccato - ripresa creazione finestre PiP");
      });

      powerMonitor.on("suspend", () => {
        isSystemLocked = true;
        pipWindowManager.setSystemLocked(true);
        console.log("Sistema in sospensione - sospensione creazione finestre PiP");
      });

      powerMonitor.on("resume", () => {
        isSystemLocked = false;
        pipWindowManager.setSystemLocked(false);
        console.log("Sistema ripreso - ripresa creazione finestre PiP");
      });

      // Sincronizza l'impostazione di auto-start
      autoStartManager.syncAutoStart();

      websocketManager.connectToHomeAssistant();
    } catch (error) {
      console.error("Errore durante l'inizializzazione dell'applicazione:", error);
    }
  });

  // Questi eventi devono essere registrati solo se abbiamo il lock dell'istanza singola
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    try {
      if (pipWindowManager) {
        pipWindowManager.closeAllPiPWindows();
      }
      if (alarmWindowManager) {
        alarmWindowManager.closeAlarmWindow();
      }
      if (websocketManager) {
        websocketManager.closeConnection();
      }
      if (trayManager) {
        trayManager.destroy();
      }
    } catch (error) {
      console.error("Errore durante la pulizia delle risorse:", error);
    }
  });

  // Gestisci eccezioni non catturate
  process.on("uncaughtException", (error) => {
    console.error("Eccezione non catturata:", error);
    if (websocketManager) {
      websocketManager.closeConnection();
    }
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Rejection non gestita:", reason);
  });
}
