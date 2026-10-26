const defaultSettings = {
  homeAssistantUrl: "",
  homeAssistantToken: "",
  autoStart: false,
  dndMode: false,
  dndSchedule: {
    enabled: false,
    startTime: "18:00",
    endTime: "09:00",
    // Indici in ordine getDay(): 0=Domenica ... 6=Sabato
    days: [false, false, false, false, false, false, false],
  },
  sensorCameraMappings: [],
  // Telecamere esterne a Home Assistant: { id: "custom_...", name, url, streamType: "auto" | "mjpeg" | "hls" | "mp4" }
  customCameras: [],
  pipSettings: {
    defaultDuration: 10,
    position: "top-right",
    size: "medium",
    // Usate quando size è "custom"
    width: 320,
    height: 240,
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
  preWarmerSettings: {
    enabled: true,
    intervalSeconds: 30,
  },
  alarmSettings: {
    enabled: false,
    sensorId: "",
    pinEnabled: false,
    pin: "",
  },
  gateSettings: {
    intercomSensorId: "",
    gateLockId: "",
    intercomCameraId: "",
  },
};

module.exports = { defaultSettings };
