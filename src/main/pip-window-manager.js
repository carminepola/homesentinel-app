const { BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const appConfig = require("../shared/app-config");

class PiPWindowManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.pipWindows = [];
    this.windowCameraMap = new Map();
    this.windowCameraIdMap = new Map();
    this.windowPositionMap = new Map();
    this.windowSettingsMap = new Map();
    this.websocketManager = null;
    this.isSystemLocked = false;

    this.setupIpcHandlers();
  }

  setWebSocketManager(websocketManager) {
    this.websocketManager = websocketManager;
  }

  createPiPWindow(cameraUrl, cameraSettings, duration) {
    if (!cameraUrl) {
      console.error("cameraUrl non fornito");
      return null;
    }

    // Verifica se il sistema è bloccato prima di creare la finestra
    if (this.isSystemLocked) {
      console.log("Creazione finestra PiP bloccata: sistema attualmente bloccato");
      return null;
    }

    cameraUrl = cameraUrl.replace("camera_proxy/", "camera_proxy_stream/");

    const globalSettings = this.settingsManager.getSettings();
    const globalPosition = globalSettings.pipSettings?.position || "top-right";

    if (!cameraSettings) {
      cameraSettings = {
        position: globalPosition,
        size: "medium",
      };
    }

    if (!cameraSettings.position) {
      cameraSettings.position = globalPosition;
    }

    // Definisci i percorsi delle icone
    const iconPngPath = path.join(__dirname, appConfig.paths.iconPng);
    const iconSvgPath = path.join(__dirname, "..", "..", "assets/icon.svg");

    // Usa SVG se esiste, altrimenti usa il PNG dalla configurazione
    const pipIcon = require("fs").existsSync(iconSvgPath) ? iconSvgPath : iconPngPath;

    const { width, height } = this.getCameraSize(cameraSettings.size, cameraSettings);
    const { x, y } = this.calculatePosition(cameraSettings.position, width, height);

    try {
      const pipWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        icon: pipIcon, // Usa la variabile pipIcon
        ...appConfig.pipWindow,
        webPreferences: appConfig.pipWindow.webPreferences,
      });

      pipWindow.loadFile(path.join(__dirname, "..", "..", "pip.html"));

      pipWindow.once("ready-to-show", () => {
        pipWindow.show();
        this.windowCameraMap.set(pipWindow.id, cameraUrl);
        pipWindow.webContents.send("load-camera", {
          url: cameraUrl,
          duration: duration || 10,
        });
      });

      pipWindow.on("closed", () => {
        const index = this.pipWindows.indexOf(pipWindow);
        if (index > -1) {
          this.pipWindows.splice(index, 1);
        }

        this.windowCameraMap.delete(pipWindow.id);
        this.windowCameraIdMap.delete(pipWindow.id);
        this.windowPositionMap.delete(pipWindow.id);
        this.windowSettingsMap.delete(pipWindow.id);
      });

      this.pipWindows.push(pipWindow);
      this.windowPositionMap.set(pipWindow.id, cameraSettings.position);
      this.windowSettingsMap.set(pipWindow.id, cameraSettings);

      return pipWindow;
    } catch (error) {
      console.error("Errore nella creazione della finestra PiP:", error);
      return null;
    }
  }

  getCameraSize(size, cameraSettings = null) {
    if (cameraSettings && cameraSettings.width && cameraSettings.height) {
      return {
        width: cameraSettings.width,
        height: cameraSettings.height,
      };
    }

    return appConfig.pipSizes[size] || appConfig.pipSizes["medium"];
  }

  calculatePosition(position, windowWidth, windowHeight) {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workArea;
    const margin = appConfig.margin;

    // Get existing windows in this position, sorted by their Y coordinate
    const existingWindows = this.pipWindows
      .filter((window) => {
        if (window.isDestroyed()) return false;
        const windowPosition = this.windowPositionMap.get(window.id);
        return windowPosition === position;
      })
      .sort((a, b) => {
        const boundsA = a.getBounds();
        const boundsB = b.getBounds();
        return boundsA.y - boundsB.y;
      });

    // Find the first available position
    let currentY = position.includes("top") ? margin : screenHeight - windowHeight - margin;
    const direction = position.includes("top") ? 1 : -1;

    for (const window of existingWindows) {
      const settings = this.windowSettingsMap.get(window.id);
      const size = this.getCameraSize(settings?.size, settings);
      const windowBounds = window.getBounds();

      // Check if there's enough space at currentY for the new window
      if (direction === 1) {
        // For top positions, check if currentY is before this window
        if (currentY + windowHeight <= windowBounds.y - 15) {
          break; // Found a gap
        }
        // Move to position after this window
        currentY = windowBounds.y + size.height + 15;
      } else {
        // For bottom positions, check if currentY is after this window
        if (currentY >= windowBounds.y + windowBounds.height + 15) {
          break; // Found a gap
        }
        // Move to position before this window
        currentY = windowBounds.y - windowHeight - 15;
      }
    }

    let x, y;
    switch (position) {
      case "top-left":
        x = margin;
        y = currentY;
        break;
      case "top-right":
        x = screenWidth - windowWidth - margin;
        y = currentY;
        break;
      case "bottom-left":
        x = margin;
        y = currentY;
        break;
      case "bottom-right":
      default:
        x = screenWidth - windowWidth - margin;
        y = currentY;
        break;
    }

    return { x, y };
  }

  closeAllPiPWindows() {
    const windowsToClose = [...this.pipWindows];

    windowsToClose.forEach((window) => {
      try {
        if (window && !window.isDestroyed()) {
          window.removeAllListeners();
          window.close();
        }
      } catch (error) {
        console.error(`Errore nella chiusura della finestra PiP ${window?.id}:`, error);
      }
    });

    this.pipWindows = [];
    this.windowCameraMap.clear();
    this.windowCameraIdMap.clear();
    this.windowPositionMap.clear();
    this.windowSettingsMap.clear();
  }

  closePiPWindow(windowId) {
    const window = this.pipWindows.find((w) => w.id === windowId);
    if (window) {
      window.close();
    }
  }

  async handleSensorEvent(eventData) {
    const { entity_id, sensorState, previousState, mapping } = eventData;

    if (sensorState !== "on" || previousState !== "off") {
      return;
    }

    // Verifica se il sistema è bloccato prima di gestire l'evento
    if (this.isSystemLocked) {
      console.log("Evento sensore ignorato: sistema attualmente bloccato");
      return;
    }

    const settings = this.settingsManager.getSettings();
    let finalCameraUrl = mapping.cameraUrl;

    if (mapping.cameraId) {
      if (!this.websocketManager) {
        console.error("WebSocketManager non configurato");
        return;
      }

      finalCameraUrl = await this.websocketManager.getCameraUrlWithToken(mapping.cameraId, settings.homeAssistantUrl, settings.homeAssistantToken);

      if (!finalCameraUrl) {
        console.error("Impossibile ottenere l'URL della camera");
        return;
      }
    } else if (mapping.cameraUrl) {
      finalCameraUrl = mapping.cameraUrl;
    }

    if (!finalCameraUrl) {
      console.error("URL telecamera non valido");
      return;
    }

    // Check for existing window
    let existingWindow = null;
    if (mapping.cameraId) {
      existingWindow = this.findWindowByCameraId(mapping.cameraId);
    }

    if (!existingWindow && finalCameraUrl) {
      existingWindow = this.findWindowByCameraUrl(finalCameraUrl);
    }

    if (existingWindow && !existingWindow.isDestroyed()) {
      this.restartWindowTimer(existingWindow, mapping.duration || settings.pipSettings.defaultDuration);
      return;
    }

    // Handle multi-event mode
    if (settings.pipSettings.multiEventMode === "replace" && this.pipWindows.length > 0) {
      this.closeAllPiPWindows();
    }

    const cameraSettings = mapping.cameraSettings || {};
    if (!cameraSettings.position) {
      cameraSettings.position = settings.pipSettings.position || "top-right";
    }

    const result = this.createPiPWindow(finalCameraUrl, cameraSettings, mapping.duration || settings.pipSettings.defaultDuration);
    if (result && mapping.cameraId) {
      this.windowCameraIdMap.set(result.id, mapping.cameraId);
    }
  }

  findWindowByCameraUrl(cameraUrl) {
    if (!cameraUrl) return null;

    for (const [windowId, storedUrl] of this.windowCameraMap.entries()) {
      if (storedUrl === cameraUrl) {
        const window = this.pipWindows.find((window) => window.id === windowId);
        if (window && !window.isDestroyed()) {
          return window;
        }
      }
    }

    return null;
  }

  findWindowByCameraId(cameraId) {
    if (!cameraId) return null;

    for (const [windowId, storedCameraId] of this.windowCameraIdMap.entries()) {
      if (storedCameraId === cameraId) {
        const window = this.pipWindows.find((window) => window.id === windowId);
        if (window && !window.isDestroyed()) {
          return window;
        }
      }
    }

    return null;
  }

  restartWindowTimer(window, duration) {
    if (!window || window.isDestroyed()) {
      return;
    }

    try {
      window.webContents.send("restart-timer", { duration });
    } catch (error) {
      console.error(`Errore nell'invio del restart-timer alla finestra ${window.id}:`, error);
    }
  }

  async testCamera(cameraUrl, cameraSettings, cameraId = null, duration = 5) {
    let finalCameraUrl = cameraUrl;

    const globalSettings = this.settingsManager.getSettings();
    const globalPosition = globalSettings.pipSettings?.position || "top-right";

    if (!cameraSettings) {
      cameraSettings = {};
    }

    if (!cameraSettings.position) {
      cameraSettings.position = globalPosition;
    }

    if (cameraId) {
      if (!this.websocketManager) {
        console.error("WebSocketManager non configurato");
        return;
      }

      finalCameraUrl = await this.websocketManager.getCameraUrlWithToken(cameraId, globalSettings.homeAssistantUrl, globalSettings.homeAssistantToken);

      if (!finalCameraUrl) {
        console.error("Impossibile ottenere l'URL della camera per il test");
        return;
      }
    }

    const result = this.createPiPWindow(finalCameraUrl, cameraSettings, duration);

    if (result && cameraId) {
      this.windowCameraIdMap.set(result.id, cameraId);
    }
  }

  getActivePiPWindowsCount() {
    return this.pipWindows.length;
  }

  getActivePiPWindows() {
    return this.pipWindows.map((window) => ({
      id: window.id,
      bounds: window.getBounds(),
    }));
  }

  setupIpcHandlers() {
    // Mantieni il vecchio metodo per compatibilità
    ipcMain.on("move-pip-window", (event, { deltaX, deltaY }) => {
      const pipWindow = BrowserWindow.fromWebContents(event.sender);
      if (!pipWindow || pipWindow.isDestroyed()) return;

      const currentBounds = pipWindow.getBounds();
      const newX = currentBounds.x + deltaX;
      const newY = currentBounds.y + deltaY;

      const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workArea;
      const boundedX = Math.max(0, Math.min(newX, screenWidth - currentBounds.width));
      const boundedY = Math.max(0, Math.min(newY, screenHeight - currentBounds.height));

      pipWindow.setPosition(Math.round(boundedX), Math.round(boundedY));
    });

    // Nuovo metodo per impostare la posizione assoluta (più fluido)
    ipcMain.on("set-window-position", (event, { x, y }) => {
      const pipWindow = BrowserWindow.fromWebContents(event.sender);
      if (!pipWindow || pipWindow.isDestroyed()) return;

      const currentBounds = pipWindow.getBounds();
      const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workArea;

      // Assicurati che la finestra rimanga entro i limiti dello schermo
      const boundedX = Math.max(0, Math.min(x, screenWidth - currentBounds.width));
      const boundedY = Math.max(0, Math.min(y, screenHeight - currentBounds.height));

      // Imposta la posizione in modo asincrono per migliorare la fluidità
      setImmediate(() => {
        if (!pipWindow.isDestroyed()) {
          pipWindow.setPosition(Math.round(boundedX), Math.round(boundedY), false);
        }
      });
    });

    // Nuovo metodo per ottenere la posizione attuale della finestra
    ipcMain.on("get-window-position", (event) => {
      const pipWindow = BrowserWindow.fromWebContents(event.sender);
      if (!pipWindow || pipWindow.isDestroyed()) return;

      const bounds = pipWindow.getBounds();
      event.reply("window-position", { x: bounds.x, y: bounds.y });
    });
  }

  // Metodo per impostare lo stato di blocco del sistema
  setSystemLocked(locked) {
    this.isSystemLocked = locked;
    console.log(`PiPWindowManager: Sistema ${locked ? "bloccato" : "sbloccato"}`);
  }

  // Metodo per verificare se il sistema è bloccato
  getSystemLocked() {
    return this.isSystemLocked;
  }
}

module.exports = PiPWindowManager;
