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
    multiEventMode: "cascade",
    size: "medium",
  },
};

module.exports = { defaultSettings };
