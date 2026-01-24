// Impostazioni predefinite per l'applicazione
const defaultSettings = {
  homeAssistantUrl: "",
  homeAssistantToken: "",
  autoStart: false,
  dndMode: false, // Modalità Do Not Disturb
  sensorCameraMappings: [],
  pipSettings: {
    defaultDuration: 10,
    position: "top-right",
    size: "medium",
    margins: {
      top: 20,
      right: 20,
      bottom: 20,
      left: 20,
    },
  },
  streamingSettings: {
    useHLS: false, // Utilizza HLS streaming via WebSocket invece di camera_proxy_stream
  },
};

module.exports = { defaultSettings };
