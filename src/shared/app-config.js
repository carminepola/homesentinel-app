// Configurazione centrale dell'applicazione
const appConfig = {
  // Informazioni sull'applicazione
  app: {
    name: "Ha-Cam",
  },

  // Percorsi delle risorse
  paths: {
    iconPng: "assets/icon.png",
    icon: "assets/icon.ico",
    trayIcon: "assets/tray-icon.png",
    mainWindowHtml: "index.html",
    pipWindowHtml: "pip.html",
  },

  // Configurazione finestra principale
  mainWindow: {
    width: 1000,
    height: 700,
    minWidth: 800,
    show: false,
  },

  // Configurazione finestra PiP
  pipWindow: {
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: "#000000",
    focusable: false,
  },

  // Configurazione WebSocket
  websocket: {
    reconnectDelay: 5000,
    heartbeatInterval: 30000,
  },

  // Dimensioni predefinite per le finestre PiP
  pipSizes: {
    small: { width: 200, height: 150 },
    medium: { width: 320, height: 240 },
    large: { width: 480, height: 360 },
  },

  // Posizioni predefinite per le finestre PiP
  pipPositions: {
    "top-left": { offsetX: 20, offsetY: 20 },
    "top-right": { offsetX: 20, offsetY: 20 },
    "bottom-left": { offsetX: 20, offsetY: 20 },
    "bottom-right": { offsetX: 20, offsetY: 20 },
  },

  // Margini per il posizionamento
  margin: 20,
};

module.exports = appConfig;
