// Configurazione centrale dell'applicazione
const appConfig = {
  // Informazioni sull'applicazione
  app: {
    name: "HomeSentinel",
    updateUrl: "https://git.devmin.it/api/v1/repos/carmine/homesentinel-app/releases/latest",
  },

  // Percorsi delle risorse
  paths: {
    iconPng: "assets/icon.png",
    icon: "assets/icon.ico",
    trayIcon: "assets/tray-icon.png",
    mainWindowHtml: "index.html",
    pipWindowHtml: "pip.html",
    intercomWindowHtml: "intercom.html",
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
    transparent: true,
    focusable: false,
    acceptFirstMouse: true,
  },

  // Configurazione WebSocket
  websocket: {
    reconnectDelay: 5000,
    heartbeatInterval: 30000,
  },

  // Configurazione streaming HLS
  hls: {
    // Endpoint per ottenere l'URL HLS tramite WebSocket
    // Home Assistant supporta lo streaming HLS tramite l'API WebSocket
    endpoint: "/api/camera_proxy_stream",
    // Timeout per la richiesta HLS (in millisecondi)
    timeout: 5000,
    maxBufferLength: 10, // Secondi di video da tenere in memoria
    maxMaxBufferLength: 30, // Massimo buffer consentito
    startLevel: 0, // Parte dalla qualità più bassa per evitare blocchi iniziali
    abrEwmaDefaultEstimate: 500000,
  },

  // Dimensioni predefinite per le finestre PiP
  pipSizes: {
    small: { width: 200, height: 150 },
    medium: { width: 320, height: 240 },
    large: { width: 480, height: 360 },
    square: { width: 240, height: 240 },
    horizontal: { width: 400, height: 225 },
    vertical: { width: 200, height: 360 },
  },

  // Configurazione finestra allarme
  alarmWindowHtml: "alarm.html",

  // Configurazione finestra citofono
  intercomWindow: {
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
  },

  // Durata di visualizzazione del popup citofono prima della chiusura automatica
  intercom: {
    autoCloseMs: 120000,
  },

  // Posizioni predefinite per le finestre PiP
  pipPositions: {
    "top-left": { offsetX: 20, offsetY: 20 },
    "top-right": { offsetX: 20, offsetY: 20 },
    "bottom-left": { offsetX: 20, offsetY: 20 },
    "bottom-right": { offsetX: 20, offsetY: 20 },
  },

  // Margini predefiniti per il posizionamento (verranno sovrascritti dalle impostazioni utente)
  margins: {
    top: 20,
    right: 20,
    bottom: 20,
    left: 20,
  },
};

module.exports = appConfig;
