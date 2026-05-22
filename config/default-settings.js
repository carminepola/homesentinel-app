const defaultSettings = {
  homeAssistantUrl: "",
  homeAssistantToken: "",
  autoStart: false,
  dndMode: false,
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
    useHLS: false,
  },
  alarmSettings: {
    enabled: false,
    sensorId: "",
    pinEnabled: false,
    pin: "",
  },
};

module.exports = { defaultSettings };
