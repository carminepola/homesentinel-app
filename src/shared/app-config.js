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
    reconnectDelay: 1000, // Primo tentativo di riconnessione, poi backoff esponenziale
    maxReconnectDelay: 30000,
    authFailedReconnectDelay: 300000, // Token non valido: inutile riprovare spesso
    heartbeatInterval: 20000,
    pongTimeout: 10000, // Senza pong entro questo tempo la connessione è considerata persa
    handshakeTimeout: 10000,
    requestTimeout: 10000,
    httpTimeout: 8000, // Timeout per le chiamate REST a Home Assistant
    wakeCheckTimeout: 3000, // Ping di verifica dopo sospensione/sblocco
    disconnectNotifyDelay: 15000, // Notifica la disconnessione solo se dura più di così
  },

  // Pre-riscaldamento degli stream
  preWarmer: {
    hlsKeepAliveInterval: 15000, // Frequenza di interrogazione della playlist HLS
    requestTimeout: 8000,
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
