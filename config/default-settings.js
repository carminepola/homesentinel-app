// Impostazioni predefinite per l'applicazione
const defaultSettings = {
  homeAssistantUrl: "",
  homeAssistantToken: "",
  autoStart: false,
  dndMode: false,
  sensorCameraMappings: [],
  customCameras: [],
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
    useHLS: false,
  },
};

module.exports = { defaultSettings };
