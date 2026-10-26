const { app } = require("electron");

if (process.platform === "linux" && !process.argv.includes("--ozone-platform=x11")) {
  app.relaunch({ args: [...process.argv.slice(1), "--ozone-platform=x11"] });
  app.exit(0);
  return;
}

const { BrowserWindow, Menu, Notification, powerMonitor, ipcMain, dialog } = require("electron");
const path = require("path");

// Importa i moduli
const SettingsManager = require("./src/shared/settings-manager");
const WebSocketManager = require("./src/main/websocket-manager");
const PiPWindowManager = require("./src/main/pip-window-manager");
const AlarmWindowManager = require("./src/main/alarm-window-manager");
const IntercomWindowManager = require("./src/main/intercom-window-manager");
const TrayManager = require("./src/main/tray-manager");
const AutoStartManager = require("./src/main/auto-start-manager");
const StreamPreWarmer = require("./src/main/stream-prewarmer");
const DndScheduler = require("./src/main/dnd-scheduler");
const IPCHandlers = require("./src/main/ipc-handlers");
const EventLog = require("./src/main/event-log");
const appConfig = require("./src/shared/app-config");
const { isCameraVisibleInState } = require("./src/shared/alarm-states");


// Variabili globali
let mainWindow;
let isQuitting = false;
let settingsManager;
let websocketManager;
let pipWindowManager;
let alarmWindowManager;
let intercomWindowManager;
let trayManager;
let autoStartManager;
let streamPreWarmer;
let dndScheduler;
let ipcHandlers;
let isWebSocketConnected = false;
let isSystemLocked = false;
let isAlarmTriggered = false;
let intercomNotification = null;
let disconnectNotifyTimeout = null;
const eventLog = new EventLog();
let disconnectNotified = false;
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
    autoHideMenuBar: true,
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
          click: () => requestQuit(),
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
async function initializeManagers() {
  settingsManager = new SettingsManager(app);
  settingsManager.initializeSettingsPath();
  await settingsManager.loadSettings();

  websocketManager = new WebSocketManager(settingsManager);
  pipWindowManager = new PiPWindowManager(settingsManager);
  pipWindowManager.setWebSocketManager(websocketManager);
  alarmWindowManager = new AlarmWindowManager(settingsManager);
  alarmWindowManager.setWebSocketManager(websocketManager);
  intercomWindowManager = new IntercomWindowManager(settingsManager);
  intercomWindowManager.setOnOpenGate(() => {
    openGate();
  });
  trayManager = new TrayManager(settingsManager);
  autoStartManager = new AutoStartManager(settingsManager);
  streamPreWarmer = new StreamPreWarmer(settingsManager, websocketManager);
  pipWindowManager.setStreamPreWarmer(streamPreWarmer);
  dndScheduler = new DndScheduler(settingsManager, trayManager);
  // ipcHandlers verrà inizializzato dopo la creazione della finestra
}

// Configura i callback per gli eventi
function setupEventCallbacks() {
  websocketManager.setEventCallbacks({
    onSensorEvent: (eventData) => {
      const isActivation = pipWindowManager.isActivation(eventData.sensorState, eventData.previousState);
      const logActivation = (detail) => {
        if (isActivation) eventLog.add("sensor", eventData.friendlyName, detail);
      };

      if (isAlarmTriggered) {
        logActivation("Allarme in corso: telecamera non mostrata");
        return;
      }
      if (trayManager.getDndMode()) {
        logActivation("Silenziato (Non disturbare)");
        return;
      }
      if (isSystemLocked) {
        logActivation("Schermo bloccato: telecamera non mostrata");
        return;
      }
      const settings = settingsManager.getSettings();
      if (settings.alarmSettings?.enabled && settings.alarmSettings?.sensorId) {
        const alarmState = websocketManager.getAlarmState();
        if (!isCameraVisibleInState(eventData.mapping, alarmState)) {
          logActivation("Nascosta per lo stato dell'antifurto");
          return;
        }
      }
      logActivation("Telecamera mostrata");
      pipWindowManager.handleSensorEvent(eventData);
    },
    onAlarmEvent: (alarmData) => {
      if (alarmData.dismissed) {
        eventLog.add("alarm", "Allarme terminato", alarmData.sensorName);
        alarmWindowManager.dismissAlarm(alarmData.sensorState);
        isAlarmTriggered = false;
      } else {
        eventLog.add("alarm", "Allarme scattato", alarmData.sensorName);
        isAlarmTriggered = true;
        pipWindowManager.closeAllPiPWindows();
        alarmWindowManager.triggerAlarm(alarmData);
      }
    },
    onConnectionStatusChange: (isConnected) => {
      const wasConnected = isWebSocketConnected;
      isWebSocketConnected = isConnected;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("connection-status-changed", isConnected);
      }
      if (wasConnected !== isConnected) {
        handleConnectionNotification(isConnected);
      }
    },
    onAlarmStateChange: (alarmData) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("alarm-state-changed", alarmData.sensorState);
      }
    },
    onIntercomEvent: () => {
      eventLog.add("intercom", "Citofono", "Qualcuno al cancello");
      showIntercomDialog();
    },
    onGateLockOpened: (data) => {
      eventLog.add("gate", "Cancello aperto", data.friendlyName);
      if (intercomNotification) {
        intercomNotification.close();
        intercomNotification = null;
      }
      if (intercomWindowManager && intercomWindowManager.isDialogOpen()) {
        intercomWindowManager.closeIntercomWindow();
      }
    },
  });

  trayManager.setEventCallbacks({
    onDndModeChange: (dndMode) => {
      streamPreWarmer.setPaused("dnd", dndMode);
    },
    onQuit: () => requestQuit(),
  });
}

// Uscita centralizzata (menu, tray, pulsante): avvisa se ci sono impostazioni non salvate
async function requestQuit() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    let hasUnsavedChanges = false;
    try {
      hasUnsavedChanges = await mainWindow.webContents.executeJavaScript("window.hasUnsavedChanges === true");
    } catch (error) {
      // Renderer non disponibile: esci comunque
    }
    if (hasUnsavedChanges) {
      if (!mainWindow.isVisible()) mainWindow.show();
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Annulla", "Esci senza salvare"],
        defaultId: 0,
        cancelId: 0,
        title: appConfig.app.name,
        message: "Ci sono impostazioni non salvate",
        detail: "Se esci ora le modifiche andranno perse.",
      });
      if (response === 0) return;
    }
  }
  isQuitting = true;
  app.quit();
}

// Notifica le disconnessioni solo se durano più di qualche secondo:
// le micro-interruzioni (cambio rete, riavvio rapido di HA) restano silenziose
function handleConnectionNotification(isConnected) {
  const showNotification = (body) => {
    new Notification({ title: appConfig.app.name, body, silent: false }).show();
  };

  if (isConnected) {
    if (disconnectNotifyTimeout) {
      clearTimeout(disconnectNotifyTimeout);
      disconnectNotifyTimeout = null;
    }
    if (disconnectNotified) {
      disconnectNotified = false;
      eventLog.add("connection", "Riconnesso a Home Assistant");
      showNotification("Riconnesso a Home Assistant");
    } else if (!handleConnectionNotification.firstConnectDone) {
      showNotification("Connesso a Home Assistant");
    }
    handleConnectionNotification.firstConnectDone = true;
    return;
  }

  if (disconnectNotifyTimeout || disconnectNotified) return;
  disconnectNotifyTimeout = setTimeout(() => {
    disconnectNotifyTimeout = null;
    if (!isWebSocketConnected && !isQuitting) {
      disconnectNotified = true;
      eventLog.add("connection", "Disconnesso da Home Assistant");
      showNotification("Disconnesso da Home Assistant");
    }
  }, appConfig.websocket.disconnectNotifyDelay);
}

// Mostra il popup del citofono con pulsante per aprire il cancello.
// Il popup si chiude automaticamente dopo 2 minuti (config: appConfig.intercom.autoCloseMs)
// Se configurata una telecamera citofono, il suo flusso viene mostrato come sfondo della card.
async function showIntercomDialog() {
  const settings = settingsManager.getSettings();
  const gateSettings = settings.gateSettings || {};
  if (!gateSettings.intercomSensorId) return;

  if (!gateSettings.gateLockId) {
    const notification = new Notification({
      title: appConfig.app.name,
      body: "Qualcuno al cancello (citofono)",
      silent: false,
    });
    notification.on("close", () => {
      if (intercomNotification === notification) {
        intercomNotification = null;
      }
    });
    intercomNotification = notification;
    notification.show();
    return;
  }

  // Il popup appare subito; lo stream della telecamera viene aggiunto appena risolto
  intercomWindowManager.showDialog();
  if (gateSettings.intercomCameraId) {
    const cameraStream = await resolveIntercomCameraStream(gateSettings.intercomCameraId);
    intercomWindowManager.setCameraStream(cameraStream);
  }
}

// Risolve l'URL dello stream della telecamera citofono (HLS se abilitato, altrimenti MJPEG)
async function resolveIntercomCameraStream(cameraId) {
  try {
    const settings = settingsManager.getSettings();
    if (!settings.homeAssistantUrl || !settings.homeAssistantToken || !websocketManager) {
      return null;
    }
    const useHLS = settings.streamingSettings?.useHLS || false;
    const result = await websocketManager.getCameraUrlWithToken(
      cameraId,
      settings.homeAssistantUrl,
      settings.homeAssistantToken,
      useHLS
    );
    if (!result || !result.url) return null;
    return {
      url: result.url,
      streamType: result.streamType || "mjpeg",
      mjpegUrl: result.mjpegUrl || null,
      cameraName: result.friendlyName || null,
    };
  } catch (error) {
    console.error("Errore nel recupero dello stream citofono:", error);
    return null;
  }
}

// Apre il cancello tramite il servizio lock.unlock di Home Assistant
async function openGate() {
  const settings = settingsManager.getSettings();
  const gateLockId = settings.gateSettings?.gateLockId;
  if (!gateLockId || !websocketManager) {
    return { success: false, error: "Cancello non configurato" };
  }

  const result = await websocketManager.callService("lock", "unlock", { entity_id: gateLockId });
  if (!result.success) {
    console.error("Apertura cancello fallita:", result.error);
  }
  return { success: result.success, error: result.error };
}

function setupMainIpcHandlers() {
  ipcMain.handle("open-gate", () => openGate());
  ipcMain.handle("get-recent-events", () => eventLog.list());
  eventLog.setOnAdd((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("event-logged", entry);
    }
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
  app.whenReady().then(async () => {
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

      // Inizializza prima i gestori per avere accesso alle impostazioni
      await initializeManagers();

      // Crea la tray prima della finestra per sapere se è disponibile
      trayManager.createTray();

      createMainWindow();

      // Imposta la finestra principale nel tray manager e negli ipc handlers
      trayManager.setMainWindow(mainWindow);
      ipcHandlers = new IPCHandlers(mainWindow, settingsManager, websocketManager, pipWindowManager, alarmWindowManager, autoStartManager, trayManager, streamPreWarmer, dndScheduler, () => requestQuit());
      setupMainIpcHandlers();


      setupEventCallbacks();

      alarmWindowManager.setOnAlarmDismissed(() => {
        isAlarmTriggered = false;
      });

      // Con il Non disturbare già attivo all'avvio il pre-warmer parte in pausa
      streamPreWarmer.setPaused("dnd", trayManager.getDndMode());
      streamPreWarmer.start();
      dndScheduler.start();

      // Configura i gestori per gli eventi di blocco/sblocco del sistema
      const logPowerEvent = (name) => {
        console.log(`[${new Date().toISOString()}] ${name}: wsConnected=${isWebSocketConnected}, pipWindows=${pipWindowManager.getActivePiPWindowsCount()}`);
      };

      const setLocked = (locked) => {
        isSystemLocked = locked;
        pipWindowManager.setSystemLocked(locked);
        // La ripresa del pre-warmer avviene dopo la verifica della connessione (reconnectAfterWake)
        if (locked) {
          streamPreWarmer.setPaused("locked", true);
        }
      };

      powerMonitor.on("lock-screen", () => {
        setLocked(true);
        logPowerEvent("lock-screen");
      });

      powerMonitor.on("unlock-screen", () => {
        setLocked(false);
        logPowerEvent("unlock-screen");
        reconnectAfterWake();
      });

      powerMonitor.on("suspend", () => {
        setLocked(true);
        logPowerEvent("suspend");
      });

      powerMonitor.on("resume", () => {
        setLocked(false);
        logPowerEvent("resume");
        reconnectAfterWake();
      });

      // resume e unlock-screen arrivano spesso insieme: un solo controllo per risveglio
      let wakeTimeout = null;
      function reconnectAfterWake() {
        if (wakeTimeout) clearTimeout(wakeTimeout);

        wakeTimeout = setTimeout(async () => {
          wakeTimeout = null;
          // Dopo una sospensione la rete può impiegare qualche secondo a tornare
          await websocketManager.checkConnection();
          if (!isSystemLocked) {
            streamPreWarmer.setPaused("locked", false);
          }
          await pipWindowManager.refreshActivePiPWindows();
        }, 1500);
      }

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
      if (intercomWindowManager) {
        intercomWindowManager.closeIntercomWindow();
      }
      if (streamPreWarmer) {
        streamPreWarmer.stop();
      }
      if (dndScheduler) {
        dndScheduler.stop();
      }
      if (disconnectNotifyTimeout) {
        clearTimeout(disconnectNotifyTimeout);
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
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Rejection non gestita:", reason);
  });
}
