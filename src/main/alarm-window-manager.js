const { BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const appConfig = require("../shared/app-config");

class AlarmWindowManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.alarmWindow = null;
    this.websocketManager = null;
    this.alarmTriggered = false;
    this.alarmStartTime = null;
    this.onAlarmDismissed = null;

    this.setupIpcHandlers();
  }

  setWebSocketManager(websocketManager) {
    this.websocketManager = websocketManager;
  }

  setOnAlarmDismissed(callback) {
    this.onAlarmDismissed = callback;
  }

  setupIpcHandlers() {
    ipcMain.handle("alarm-request-dismiss", () => {
      return this.handleRequestDismiss();
    });

    ipcMain.handle("alarm-check-pin", (event, pin) => {
      return this.handleCheckPin(pin);
    });

    ipcMain.on("alarm-close", () => {
      this.closeAlarmWindow();
    });
  }

  async triggerAlarm(alarmData) {
    if (this.alarmTriggered && this.alarmWindow && !this.alarmWindow.isDestroyed()) {
      if (alarmData.state) {
        this.alarmWindow.webContents.send("alarm-state-update", {
          state: alarmData.state,
        });
      }
      return;
    }

    this.alarmTriggered = true;
    this.alarmStartTime = new Date().toISOString();

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().bounds;

    try {
      this.alarmWindow = new BrowserWindow({
        width: screenWidth,
        height: screenHeight,
        x: 0,
        y: 0,
        fullscreen: true,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
        },
      });

      this.alarmWindow.setVisibleOnAllWorkspaces(true);
      this.alarmWindow.setAlwaysOnTop(true, "screen-saver");

      this.alarmWindow.loadFile(path.join(__dirname, "..", "..", "alarm.html"));

      this.alarmWindow.once("ready-to-show", () => {
        this.alarmWindow.show();
        this.alarmWindow.focus();

        this.alarmWindow.webContents.send("alarm-init", {
          sensorName: alarmData.sensorName || "Allarme",
          state: alarmData.state || "triggered",
          startTime: this.alarmStartTime,
        });

        this.loadAlarmCameras();
      });

      this.alarmWindow.on("closed", () => {
        this.alarmWindow = null;
      });

      this.alarmWindow.webContents.on("before-input-event", (event, input) => {
        if (input.key === "Escape") {
          event.preventDefault();
        }
      });
    } catch (error) {
      console.error("Errore nella creazione della finestra di allarme:", error);
      this.alarmTriggered = false;
      this.alarmWindow = null;
    }
  }

  async loadAlarmCameras() {
    if (!this.alarmWindow || this.alarmWindow.isDestroyed() || !this.websocketManager) {
      return;
    }

    const settings = this.settingsManager.getSettings();
    const mappings = settings.sensorCameraMappings || [];

    if (mappings.length === 0) return;

    const globalUseHLS = settings.streamingSettings?.useHLS || false;
    const loadedCameras = new Set();

    for (const mapping of mappings) {
      if (!mapping.cameraId) continue;
      if (loadedCameras.has(mapping.cameraId)) continue;
      loadedCameras.add(mapping.cameraId);

      try {
        let cameraUrl = null;
        let cameraName = null;
        let useHLS = false;

        const isCustom = mapping.cameraId.startsWith("custom_");

        if (isCustom) {
          const customCamera = (settings.customCameras || []).find(c => c.id === mapping.cameraId);
          if (customCamera) {
            cameraUrl = customCamera.url;
            cameraName = customCamera.name;
            const customStreamType = customCamera.streamType || "auto";
            useHLS = customStreamType === "hls" || (customStreamType === "auto" && globalUseHLS);
          }
        } else {
          const mappingStreamType = mapping.streamType || "auto";
          useHLS = mappingStreamType === "hls" ? true :
                    mappingStreamType === "mjpeg" ? false : globalUseHLS;

          const cameraResult = await this.websocketManager.getCameraUrlWithToken(
            mapping.cameraId,
            settings.homeAssistantUrl,
            settings.homeAssistantToken,
            useHLS
          );

          if (cameraResult) {
            cameraUrl = cameraResult.url;
            cameraName = cameraResult.friendlyName;
            useHLS = cameraResult.streamType === "hls";
          }
        }

        if (cameraUrl && this.alarmWindow && !this.alarmWindow.isDestroyed()) {
          this.alarmWindow.webContents.send("alarm-camera-add", {
            cameraId: mapping.cameraId,
            cameraName: cameraName,
            url: cameraUrl,
            useHLS: useHLS,
          });
        }
      } catch (error) {
        console.error(`Errore nel caricamento della telecamera ${mapping.cameraId}:`, error);
      }
    }
  }

  async dismissAlarm(newState) {
    if (!this.alarmTriggered) return;

    this.alarmTriggered = false;
    this.closeAlarmWindow();
    if (this.onAlarmDismissed) this.onAlarmDismissed();
  }

  async userDismissAlarm() {
    if (!this.alarmTriggered) return;

    await this.disarmAlarm();
    this.alarmTriggered = false;
    this.closeAlarmWindow();
    if (this.onAlarmDismissed) this.onAlarmDismissed();
  }

  async disarmAlarm() {
    const settings = this.settingsManager.getSettings();
    const alarmConfig = settings.alarmSettings || {};
    const entityId = alarmConfig.sensorId;

    if (!entityId || !this.websocketManager) {
      return;
    }

    const serviceData = { entity_id: entityId };
    if (alarmConfig.pin) {
      serviceData.code = alarmConfig.pin;
    }

    try {
      const result = await this.websocketManager.callService(
        "alarm_control_panel",
        "alarm_disarm",
        serviceData
      );
      if (!result.success) {
        console.error("Disarm antifurto fallito:", result.error || result.result?.error?.message);
      }
      return result;
    } catch (error) {
      console.error("Errore nel disarm dell'antifurto:", error.message);
      return { success: false, error: error.message };
    }
  }

  closeAlarmWindow() {
    this.alarmTriggered = false;
    this.alarmStartTime = null;

    if (this.alarmWindow && !this.alarmWindow.isDestroyed()) {
      try {
        this.alarmWindow.webContents.send("alarm-close");
        this.alarmWindow.close();
      } catch (error) {
        console.error("Errore nella chiusura della finestra di allarme:", error);
      }
    }

    this.alarmWindow = null;
  }

  isAlarmActive() {
    return this.alarmTriggered;
  }

  handleRequestDismiss() {
    const settings = this.settingsManager.getSettings();
    const alarmConfig = settings.alarmSettings || {};

    if (alarmConfig.pinEnabled && alarmConfig.pin) {
      if (this.alarmWindow && !this.alarmWindow.isDestroyed()) {
        this.alarmWindow.webContents.send("alarm-show-pin");
      }
      return { requiresPin: true };
    }

    this.userDismissAlarm();
    return { requiresPin: false };
  }

  handleCheckPin(pin) {
    const settings = this.settingsManager.getSettings();
    const alarmConfig = settings.alarmSettings || {};

    if (alarmConfig.pin && pin === alarmConfig.pin) {
      this.userDismissAlarm();
      return { success: true };
    }

    return { success: false };
  }

  setSystemLocked(locked) {
    // Alarm window is not affected by system lock
  }
}

module.exports = AlarmWindowManager;
