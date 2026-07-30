const { ipcRenderer } = require("electron");
const { marked } = require("marked");

// Importa i moduli
const ThemeManager = require("./src/renderer/theme-manager");
const MappingManager = require("./src/renderer/mapping-manager");
const appConfig = require("./src/shared/app-config");

// Stato dell'applicazione
let appSettings = {};
let homeAssistantDevices = { sensors: [], cameras: [] };

// Gestori
let themeManager;
let mappingManager;

// Elementi DOM
const connectionStatus = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");
const dndToggle = document.getElementById("dnd-toggle");
const dndStatus = document.getElementById("dnd-status");
const darkModeToggle = document.getElementById("dark-mode-toggle");

// Inizializzazione
document.addEventListener("DOMContentLoaded", async () => {
  // Inizializza i gestori
  themeManager = new ThemeManager();

  // Carica le impostazioni
  appSettings = await ipcRenderer.invoke("get-settings");

  // Inizializza il gestore delle mappature dopo aver caricato i dispositivi
  mappingManager = new MappingManager(appSettings, homeAssistantDevices);

  // Imposta i valori iniziali
  updateUIFromSettings();

  // Carica lo stato dell'avvio automatico
  await loadAutoStartStatus();

  // Carica la versione dell'app
  await loadAppVersion();

  // Carica i dispositivi Home Assistant se configurato
  if (appSettings.homeAssistantUrl && appSettings.homeAssistantToken) {
    await loadHomeAssistantDevices();
    // Reinizializza il gestore delle mappature con i dispositivi caricati
    mappingManager = new MappingManager(appSettings, homeAssistantDevices);
  }

  // Aggiorna lo stato dei sensori
  updateSensorStatus();

  // Imposta gli event listener rimanenti
  setupEventListeners();
});

// Imposta gli event listener
function setupEventListeners() {
  // Event listener per il toggle DND
  if (dndToggle) {
    dndToggle.addEventListener("change", async () => {
      const dndMode = dndToggle.checked;
      if (dndStatus) {
        dndStatus.textContent = dndMode ? "Attivato" : "Disattivato";
      }
      try {
        await ipcRenderer.invoke("set-dnd-mode", dndMode);
      } catch (error) {
        console.error("Errore nell'impostazione della modalità DND:", error);
        dndToggle.checked = !dndMode;
        if (dndStatus) {
          dndStatus.textContent = !dndMode ? "Attivato" : "Disattivato";
        }
      }
    });
  }

  // Event listener per il toggle modalità scura
  if (darkModeToggle && themeManager) {
    darkModeToggle.addEventListener("change", () => {
      const newTheme = darkModeToggle.checked ? "dark" : "light";
      themeManager.setTheme(newTheme);
    });
  }

  // Event listener per il toggle avvio automatico
  const autoStartToggle = document.getElementById("auto-start-toggle");
  if (autoStartToggle) {
    autoStartToggle.addEventListener("change", async () => {
      const enabled = autoStartToggle.checked;
      try {
        const result = await ipcRenderer.invoke("set-auto-start", enabled);
        if (!result.success) {
          console.error("Errore nell'impostazione dell'avvio automatico:", result.error);
          autoStartToggle.checked = !enabled;
          alert(`Impossibile ${enabled ? "attivare" : "disattivare"} l'avvio automatico: ${result.error}`);
        }
      } catch (error) {
        console.error("Errore nell'impostazione dell'avvio automatico:", error);
        autoStartToggle.checked = !enabled;
        alert(`Errore nell'impostazione dell'avvio automatico: ${error.message}`);
      }
    });
  }

  // Event listener per il toggle allarme
  const alarmEnabledToggle = document.getElementById("alarm-enabled");
  if (alarmEnabledToggle) {
    alarmEnabledToggle.addEventListener("change", () => {
      const fields = document.getElementById("alarm-config-fields");
      if (fields) {
        fields.style.display = alarmEnabledToggle.checked ? "block" : "none";
      }
  refreshAlarmState();

  // Citofono / Cancello
  const intercomSensor = document.getElementById("intercom-sensor");
  if (intercomSensor) intercomSensor.value = appSettings.gateSettings?.intercomSensorId || "";
  const gateLock = document.getElementById("gate-lock");
  if (gateLock) gateLock.value = appSettings.gateSettings?.gateLockId || "";
    });
  }

  // Event listener per il toggle pianificazione DnD
  const dndScheduleEnabled = document.getElementById("dnd-schedule-enabled");
  if (dndScheduleEnabled) {
    dndScheduleEnabled.addEventListener("change", () => {
      const fields = document.getElementById("dnd-schedule-fields");
      if (fields) fields.style.display = dndScheduleEnabled.checked ? "block" : "none";
    });
  }

  // Event listener per il toggle PIN allarme
  const alarmPinEnabled = document.getElementById("alarm-pin-enabled");
  if (alarmPinEnabled) {
    alarmPinEnabled.addEventListener("change", () => {
      const pinGroup = document.getElementById("alarm-pin-group");
      if (pinGroup) {
        pinGroup.style.display = alarmPinEnabled.checked ? "block" : "none";
      }
    });
  }

  // Event listener per il cambio delle dimensioni predefinite
  const defaultSizeSelect = document.getElementById("default-size");
  if (defaultSizeSelect) {
    defaultSizeSelect.addEventListener("change", () => {
      toggleCustomSizeFields("default-size", "custom-size-container");
    });
  }

  // Event listener per il cambio delle dimensioni di test
  const testSizeSelect = document.getElementById("test-size");
  if (testSizeSelect) {
    testSizeSelect.addEventListener("change", () => {
      toggleCustomSizeFields("test-size", "test-custom-size-container");
    });
  }

  // Event listener per il cambio delle dimensioni di mappatura
  const mappingSizeSelect = document.getElementById("mapping-size");
  if (mappingSizeSelect) {
    mappingSizeSelect.addEventListener("change", () => {
      toggleCustomSizeFields("mapping-size", "mapping-custom-size-container");
    });
  }

  // Event listener per il salvataggio delle impostazioni
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      await saveSettings();
    });
  }

  // Event listener per il test di connessione
  const testConnectionBtn = document.getElementById("test-connection-btn");
  if (testConnectionBtn) {
    testConnectionBtn.addEventListener("click", async () => {
      await testConnection();
    });
  }

  // Event listener per il test PiP
  const testPipBtn = document.getElementById("test-pip-btn");
  if (testPipBtn) {
    testPipBtn.addEventListener("click", async () => {
      await testPiP();
    });
  }

  // Event listener per l'esportazione delle impostazioni
  const exportSettingsBtn = document.getElementById("export-settings-btn");
  if (exportSettingsBtn) {
    exportSettingsBtn.addEventListener("click", async () => {
      await exportSettings();
    });
  }

  // Event listener per l'importazione delle impostazioni
  const importSettingsBtn = document.getElementById("import-settings-btn");
  if (importSettingsBtn) {
    importSettingsBtn.addEventListener("click", async () => {
      await importSettings();
    });
  }

  // Event listener per il reset delle impostazioni
  const resetSettingsBtn = document.getElementById("reset-settings-btn");
  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener("click", async () => {
      await resetSettings();
    });
  }

  const hideBtn = document.getElementById("hide-btn");
  if (hideBtn) {
    hideBtn.addEventListener("click", async () => {
      await ipcRenderer.invoke("hide-window");
    });
  }

  // Event listener per il pulsante Esci
  const quitBtn = document.getElementById("quit-btn");
  if (quitBtn) {
    quitBtn.addEventListener("click", async () => {
      await ipcRenderer.invoke("quit-app");
    });
  }

  // Event listener per il test allarme
  const testAlarmBtn = document.getElementById("test-alarm-btn");
  if (testAlarmBtn) {
    testAlarmBtn.addEventListener("click", async () => {
      await ipcRenderer.invoke("test-alarm");
    });
  }

  const checkUpdateBtn = document.getElementById("check-update-btn");
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener("click", async () => {
      checkUpdateBtn.textContent = "Verifica...";
      checkUpdateBtn.disabled = true;
      await checkForUpdates();
      checkUpdateBtn.disabled = false;
    });
  }

  // Funzione per mostrare/nascondere i campi personalizzati
  function toggleCustomSizeFields(selectId, containerId) {
    const select = document.getElementById(selectId);
    const container = document.getElementById(containerId);
    
    if (select && container) {
      if (select.value === "custom") {
        container.style.display = "block";
      } else {
        container.style.display = "none";
      }
    }
  }

  // Menu hamburger
  const menuToggleBtn = document.getElementById("menu-toggle-btn");
  const mobileMenu = document.getElementById("mobile-menu");

  if (menuToggleBtn && mobileMenu) {
    menuToggleBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!mobileMenu.contains(e.target) && !menuToggleBtn.contains(e.target)) {
        mobileMenu.classList.remove("open");
      }
    });
  }

  // Gestione tab
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.getAttribute("data-tab");

      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabPanes.forEach((pane) => pane.classList.remove("active"));

      button.classList.add("active");
      document.getElementById(tabName).classList.add("active");

      if (mobileMenu) {
        mobileMenu.classList.remove("open");
      }
    });
  });
}

// Funzioni per le impostazioni
function updateUIFromSettings() {
  // Home Assistant settings
  const haUrl = document.getElementById("ha-url");
  if (haUrl) haUrl.value = appSettings.homeAssistantUrl || "";

  const haToken = document.getElementById("ha-token");
  if (haToken) haToken.value = appSettings.homeAssistantToken || "";

  // PiP settings
  const pipDuration = document.getElementById("pip-duration");
  if (pipDuration) pipDuration.value = appSettings.pipSettings?.defaultDuration || 10;

  const pipPosition = document.getElementById("pip-position");
  if (pipPosition) pipPosition.value = appSettings.pipSettings?.position || "top-right";


  const defaultSize = document.getElementById("default-size");
  if (defaultSize) defaultSize.value = appSettings.pipSettings?.size || "medium";

  // Margin settings
  const marginTop = document.getElementById("margin-top");
  if (marginTop) marginTop.value = appSettings.pipSettings?.margins?.top || 40;

  const marginRight = document.getElementById("margin-right");
  if (marginRight) marginRight.value = appSettings.pipSettings?.margins?.right || 20;

  const marginBottom = document.getElementById("margin-bottom");
  if (marginBottom) marginBottom.value = appSettings.pipSettings?.margins?.bottom || 20;

  const marginLeft = document.getElementById("margin-left");
  if (marginLeft) marginLeft.value = appSettings.pipSettings?.margins?.left || 20;

  // Auto start
  const autoStart = document.getElementById("auto-start-toggle");
  if (autoStart) autoStart.checked = appSettings.autoStart || false;

  // HLS streaming
  const useHls = document.getElementById("use-hls");
  if (useHls) useHls.checked = appSettings.streamingSettings?.useHLS || false;

  // PreWarmer settings
  const prewarmerEnabled = document.getElementById("prewarmer-enabled");
  if (prewarmerEnabled) prewarmerEnabled.checked = appSettings.preWarmerSettings?.enabled ?? true;

  const prewarmerInterval = document.getElementById("prewarmer-interval");
  if (prewarmerInterval) prewarmerInterval.value = appSettings.preWarmerSettings?.intervalSeconds || 30;

  // Alarm settings
  const alarmEnabled = document.getElementById("alarm-enabled");
  if (alarmEnabled) alarmEnabled.checked = appSettings.alarmSettings?.enabled || false;

  const alarmSensor = document.getElementById("alarm-sensor");
  if (alarmSensor) alarmSensor.value = appSettings.alarmSettings?.sensorId || "";

  const alarmConfigFields = document.getElementById("alarm-config-fields");
  if (alarmConfigFields) {
    alarmConfigFields.style.display = appSettings.alarmSettings?.enabled ? "block" : "none";
  }

  const alarmPinEnabled = document.getElementById("alarm-pin-enabled");
  if (alarmPinEnabled) alarmPinEnabled.checked = appSettings.alarmSettings?.pinEnabled || false;

  const alarmPin = document.getElementById("alarm-pin");
  if (alarmPin) alarmPin.value = appSettings.alarmSettings?.pin || "";

  const alarmPinGroup = document.getElementById("alarm-pin-group");
  if (alarmPinGroup) {
    alarmPinGroup.style.display = appSettings.alarmSettings?.pinEnabled ? "block" : "none";
  }

  refreshAlarmState();

  // Dark mode
  if (darkModeToggle && themeManager) {
    darkModeToggle.checked = themeManager.getCurrentTheme() === "dark";
  }

  // DND mode
  if (dndToggle) {
    dndToggle.checked = appSettings.dndMode || false;
  }
  if (dndStatus) {
    dndStatus.textContent = appSettings.dndMode ? "Attivato" : "Disattivato";
  }

  // Pianificazione DnD
  const dndSchedule = appSettings.dndSchedule || {};
  const schedEnabled = document.getElementById("dnd-schedule-enabled");
  const schedStart = document.getElementById("dnd-schedule-start");
  const schedEnd = document.getElementById("dnd-schedule-end");
  const schedFields = document.getElementById("dnd-schedule-fields");
  if (schedEnabled) schedEnabled.checked = !!dndSchedule.enabled;
  if (schedStart) schedStart.value = dndSchedule.startTime || "18:00";
  if (schedEnd) schedEnd.value = dndSchedule.endTime || "09:00";
  if (schedFields) schedFields.style.display = dndSchedule.enabled ? "block" : "none";
  const days = dndSchedule.days || [false, false, false, false, false, false, false];
  document.querySelectorAll("#dnd-schedule-days input[type='checkbox']").forEach((input) => {
    const idx = parseInt(input.getAttribute("data-day"), 10);
    input.checked = !!days[idx];
  });

  // Update sensor mappings list
  if (mappingManager) {
    mappingManager.updateSensorMappingsList();
  }
}

async function saveSettings() {
  // Collect all settings
  const newSettings = {
    homeAssistantUrl: document.getElementById("ha-url")?.value || "",
    homeAssistantToken: document.getElementById("ha-token")?.value || "",
    autoStart: document.getElementById("auto-start-toggle")?.checked || false,
    dndMode: appSettings.dndMode || false,
    dndSchedule: {
      enabled: document.getElementById("dnd-schedule-enabled")?.checked || false,
      startTime: document.getElementById("dnd-schedule-start")?.value || "18:00",
      endTime: document.getElementById("dnd-schedule-end")?.value || "09:00",
      days: (() => {
        const arr = [false, false, false, false, false, false, false];
        document.querySelectorAll("#dnd-schedule-days input[type='checkbox']").forEach((input) => {
          const idx = parseInt(input.getAttribute("data-day"), 10);
          if (!isNaN(idx)) arr[idx] = input.checked;
        });
        return arr;
      })(),
    },
    pipSettings: {
      defaultDuration: parseInt(document.getElementById("pip-duration")?.value || 10),
      position: document.getElementById("pip-position")?.value || "top-right",
      multiEventMode: "cascade", // Always use cascade mode
      size: document.getElementById("default-size")?.value || "medium",
      margins: {
        top: parseInt(document.getElementById("margin-top")?.value || 20),
        right: parseInt(document.getElementById("margin-right")?.value || 20),
        bottom: parseInt(document.getElementById("margin-bottom")?.value || 20),
        left: parseInt(document.getElementById("margin-left")?.value || 20),
      },
    },
    streamingSettings: {
      useHLS: document.getElementById("use-hls")?.checked || false,
    },
    preWarmerSettings: {
      enabled: document.getElementById("prewarmer-enabled")?.checked ?? true,
      intervalSeconds: parseInt(document.getElementById("prewarmer-interval")?.value || 30),
    },
    alarmSettings: {
      enabled: document.getElementById("alarm-enabled")?.checked || false,
      sensorId: document.getElementById("alarm-sensor")?.value || "",
      pinEnabled: document.getElementById("alarm-pin-enabled")?.checked || false,
      pin: document.getElementById("alarm-pin")?.value || "",
    },
    gateSettings: {
      intercomSensorId: document.getElementById("intercom-sensor")?.value || "",
      gateLockId: document.getElementById("gate-lock")?.value || "",
    },
    sensorCameraMappings: appSettings.sensorCameraMappings || [],
  };

  try {
    await ipcRenderer.invoke("save-settings", newSettings);
    appSettings = newSettings;

    // Show success message
    showNotification("Impostazioni salvate con successo", "success");

    // Reload devices if Home Assistant settings changed
    if (newSettings.homeAssistantUrl && newSettings.homeAssistantToken) {
      await loadHomeAssistantDevices();
      // Reinizializza il gestore delle mappature con i dispositivi aggiornati
      mappingManager = new MappingManager(appSettings, homeAssistantDevices);
    }
  } catch (error) {
    showNotification("Errore nel salvataggio delle impostazioni: " + error.message, "error");
  }
}

async function testConnection() {
  const url = document.getElementById("ha-url")?.value;
  const token = document.getElementById("ha-token")?.value;

  if (!url || !token) {
    showNotification("Inserisci URL e token di Home Assistant", "error");
    return;
  }

  try {
    const response = await fetch(`${url}/api/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      showNotification("Connessione a Home Assistant riuscita", "success");
      updateConnectionStatus(true);
    } else {
      throw new Error("Credenziali non valide");
    }
  } catch (error) {
    showNotification("Errore di connessione: " + error.message, "error");
    updateConnectionStatus(false);
  }
}

function updateConnectionStatus(isConnected) {
  if (connectionStatus && connectionText) {
    if (isConnected) {
      connectionStatus.classList.remove("offline");
      connectionStatus.classList.add("online");
      connectionText.textContent = "Connesso";
    } else {
      connectionStatus.classList.remove("online");
      connectionStatus.classList.add("offline");
      connectionText.textContent = "Non connesso";
    }
  }
}

// Funzioni per i dispositivi Home Assistant
async function loadHomeAssistantDevices() {
  try {
    const devices = await ipcRenderer.invoke("get-home-assistant-devices");

    if (devices.error) {
      showNotification("Errore nel caricamento dei dispositivi: " + devices.error, "error");
      return;
    }

    homeAssistantDevices = devices;
    updateDeviceSelects();
    restoreAlarmSensorValue();
    restoreGateValues();
    updateConnectionStatus(true);

    // Aggiorna i dispositivi nel MappingManager
    if (mappingManager) {
      mappingManager.updateHomeAssistantDevices(homeAssistantDevices);
    }
  } catch (error) {
    showNotification("Errore nel caricamento dei dispositivi: " + error.message, "error");
    updateConnectionStatus(false);
  }
}

function updateDeviceSelects() {
  // Update sensor selects
  const sensorSelect = document.getElementById("sensor-select");
  const testCameraSelect = document.getElementById("test-camera");
  const cameraSelect = document.getElementById("camera-select");

  if (sensorSelect) {
    // Clear existing options
    sensorSelect.innerHTML = '<option value="">-- Seleziona un sensore --</option>';

    // Add sensor options
    homeAssistantDevices.sensors.forEach((sensor) => {
      const option = document.createElement("option");
      option.value = sensor.entity_id;
      option.textContent = sensor.attributes.friendly_name || sensor.entity_id;
      sensorSelect.appendChild(option);
    });
  }

  if (testCameraSelect) {
    testCameraSelect.innerHTML = '<option value="">-- Seleziona una telecamera --</option>';

    homeAssistantDevices.cameras.forEach((camera) => {
      const option = document.createElement("option");
      option.value = camera.entity_id;
      option.textContent = camera.attributes.friendly_name || camera.entity_id;
      testCameraSelect.appendChild(option);
    });
  }

  if (cameraSelect) {
    cameraSelect.innerHTML = '<option value="">-- Seleziona una telecamera --</option>';

    homeAssistantDevices.cameras.forEach((camera) => {
      const option = document.createElement("option");
      option.value = camera.entity_id;
      option.textContent = camera.attributes.friendly_name || camera.entity_id;
      cameraSelect.appendChild(option);
    });
  }

  const alarmSensorSelect = document.getElementById("alarm-sensor");
  if (alarmSensorSelect) {
    alarmSensorSelect.innerHTML = '<option value="">-- Seleziona un sensore --</option>';

    homeAssistantDevices.sensors.forEach((sensor) => {
      if (sensor.entity_id.startsWith("alarm_control_panel.")) {
        const option = document.createElement("option");
        option.value = sensor.entity_id;
        option.textContent = sensor.attributes.friendly_name || sensor.entity_id;
        alarmSensorSelect.appendChild(option);
      }
    });
  }

  const intercomSelect = document.getElementById("intercom-sensor");
  if (intercomSelect) {
    intercomSelect.innerHTML = '<option value="">-- Seleziona un sensore --</option>';

    homeAssistantDevices.sensors.forEach((sensor) => {
      if (sensor.entity_id.startsWith("binary_sensor.") || sensor.entity_id.startsWith("input_boolean.")) {
        const option = document.createElement("option");
        option.value = sensor.entity_id;
        option.textContent = sensor.attributes.friendly_name || sensor.entity_id;
        intercomSelect.appendChild(option);
      }
    });
  }

  const gateLockSelect = document.getElementById("gate-lock");
  if (gateLockSelect) {
    gateLockSelect.innerHTML = '<option value="">-- Seleziona una entita\' lock --</option>';

    (homeAssistantDevices.locks || []).forEach((lock) => {
      const option = document.createElement("option");
      option.value = lock.entity_id;
      option.textContent = lock.attributes.friendly_name || lock.entity_id;
      gateLockSelect.appendChild(option);
    });
  }
}

function restoreAlarmSensorValue() {
  const alarmSensorSelect = document.getElementById("alarm-sensor");
  if (alarmSensorSelect && appSettings.alarmSettings?.sensorId) {
    alarmSensorSelect.value = appSettings.alarmSettings.sensorId;
  }
}

function restoreGateValues() {
  const intercomSelect = document.getElementById("intercom-sensor");
  if (intercomSelect && appSettings.gateSettings?.intercomSensorId) {
    intercomSelect.value = appSettings.gateSettings.intercomSensorId;
  }
  const gateLockSelect = document.getElementById("gate-lock");
  if (gateLockSelect && appSettings.gateSettings?.gateLockId) {
    gateLockSelect.value = appSettings.gateSettings.gateLockId;
  }
}

// Funzioni per lo stato dei sensori
async function updateSensorStatus() {
  try {
    const sensorStatus = await ipcRenderer.invoke("get-sensor-status");
    const statusList = document.getElementById("sensor-status-list");

    if (!statusList) return;

    if (!sensorStatus || sensorStatus.length === 0) {
      statusList.innerHTML = "<p>Nessun sensore monitorato</p>";
      return;
    }

    statusList.innerHTML = "";

    sensorStatus.forEach((status) => {
      const statusElement = document.createElement("div");
      statusElement.className = "sensor-status-item";

      const sensorName = getSensorName(status.sensorId);
      const statusClass = status.status === "on" ? "on" : status.status === "off" ? "off" : "unknown";
      const statusText = status.status === "on" ? "ON" : status.status === "off" ? "OFF" : "Sconosciuto";

      statusElement.innerHTML = `
        <span class="sensor-status-name">${sensorName}</span>
        <span class="sensor-status-value ${statusClass}">${statusText}</span>
      `;

      statusList.appendChild(statusElement);
    });
  } catch (error) {
    console.error("Errore nell'aggiornamento dello stato dei sensori:", error);
  }
}

function getSensorName(sensorId) {
  const sensor = homeAssistantDevices.sensors.find((s) => s.entity_id === sensorId);
  return sensor ? sensor.attributes.friendly_name || sensor.entity_id : sensorId;
}

// Funzioni per il test
async function testPiP() {
  // Controlla se la modalità DND è attiva
  if (dndToggle && dndToggle.checked) {
    showNotification("Impossibile eseguire il test: modalità Non Disturbare attiva", "warning");
    return;
  }

  const cameraId = document.getElementById("test-camera")?.value;
  const cameraUrl = document.getElementById("test-camera-url")?.value;
  const duration = parseInt(document.getElementById("test-duration")?.value || 5);
  const sizeSelect = document.getElementById("test-size")?.value || "medium";

  // Verifica che sia stato selezionato una camera o inserito un URL
  if (!cameraId && !cameraUrl) {
    showNotification("Seleziona una telecamera o inserisci un URL", "error");
    return;
  }

  let cameraSettings = {
    size: sizeSelect,
  };

  // Se è selezionata la dimensione personalizzata, aggiungi width e height
  if (sizeSelect === "custom") {
    const customWidth = parseInt(document.getElementById("test-custom-width")?.value || 320);
    const customHeight = parseInt(document.getElementById("test-custom-height")?.value || 240);
    
    // Valida le dimensioni personalizzate
    if (customWidth < 100 || customWidth > 1920 || customHeight < 100 || customHeight > 1080) {
      showNotification("Dimensioni personalizzate non valide. Larghezza: 100-1920px, Altezza: 100-1080px", "error");
      return;
    }
    
    cameraSettings.width = customWidth;
    cameraSettings.height = customHeight;
  }

  try {
    // Passiamo sia l'URL (se presente) sia l'ID della camera e la durata
    // Il processo principale gestirà la generazione dell'URL con token dinamico
    await ipcRenderer.invoke("test-camera", cameraUrl, cameraSettings, cameraId, duration);
    showNotification("Test PiP avviato", "success");
  } catch (error) {
    showNotification("Errore nell'avvio del test: " + error.message, "error");
  }
}

// Funzioni di notifica
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  requestAnimationFrame(() => {
    notification.classList.add("show");
  });

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 250);
  }, 3000);
}

// Funzioni per la gestione delle impostazioni
async function exportSettings() {
  try {
    const result = await ipcRenderer.invoke("export-settings");
    if (result.success) {
      showNotification(`Impostazioni esportate in: ${result.path}`, "success");
    } else if (!result.canceled) {
      showNotification(`Errore nell'esportazione: ${result.error}`, "error");
    }
  } catch (error) {
    showNotification("Errore nell'esportazione delle impostazioni: " + error.message, "error");
  }
}

async function importSettings() {
  try {
    const result = await ipcRenderer.invoke("import-settings");
    if (result.success) {
      appSettings = result.settings;
      updateUIFromSettings();
      showNotification("Impostazioni importate con successo", "success");

      // Ricarica i dispositivi se Home Assistant è configurato
      if (appSettings.homeAssistantUrl && appSettings.homeAssistantToken) {
        await loadHomeAssistantDevices();
        // Reinizializza il gestore delle mappature con i dispositivi aggiornati
        mappingManager = new MappingManager(appSettings, homeAssistantDevices);
      }
    } else if (!result.canceled) {
      showNotification(`Errore nell'importazione: ${result.error}`, "error");
    }
  } catch (error) {
    showNotification("Errore nell'importazione delle impostazioni: " + error.message, "error");
  }
}

async function resetSettings() {
  if (confirm("Sei sicuro di voler resettare tutte le impostazioni ai valori predefiniti? Questa azione non può essere annullata.")) {
    try {
      const result = await ipcRenderer.invoke("reset-settings");
      if (result.success) {
        appSettings = result.settings;
        updateUIFromSettings();
        showNotification("Impostazioni resettate con successo", "success");

        // Ricarica i dispositivi se Home Assistant è configurato
        if (appSettings.homeAssistantUrl && appSettings.homeAssistantToken) {
          await loadHomeAssistantDevices();
          // Reinizializza il gestore delle mappature con i dispositivi aggiornati
          mappingManager = new MappingManager(appSettings, homeAssistantDevices);
        }
      } else {
        showNotification(`Errore nel reset: ${result.error}`, "error");
      }
    } catch (error) {
      showNotification("Errore nel reset delle impostazioni: " + error.message, "error");
    }
  }
}

// IPC event listeners
ipcRenderer.on("open-settings", () => {
  // Switch to settings tab
  const settingsTab = document.querySelector('[data-tab="settings"]');
  if (settingsTab) {
    settingsTab.click();
  }
});

// Carica lo stato dell'avvio automatico
async function loadAutoStartStatus() {
  try {
    const result = await ipcRenderer.invoke("get-auto-start-status");
    const autoStartToggle = document.getElementById("auto-start-toggle");
    if (autoStartToggle && result !== undefined) {
      autoStartToggle.checked = result.enabled || false;
    }
  } catch (error) {
    console.error("Errore nel caricamento dello stato dell'avvio automatico:", error);
  }
}

async function loadAppVersion() {
  try {
    const { version } = await ipcRenderer.invoke("get-app-version");
    const el = document.getElementById("app-version");
    if (el) {
      el.textContent = `v${version}`;
    }
  } catch (error) {
    console.error("Errore nel caricamento della versione:", error);
  }
}

async function checkForUpdates() {
  try {
    const result = await ipcRenderer.invoke("check-for-updates");
    const content = document.getElementById("update-status-content");
    const btn = document.getElementById("check-update-btn");
    if (!content) return;

    if (result.error) {
      content.innerHTML = `<span class="status-text" style="color: var(--text-tertiary)">Impossibile verificare gli aggiornamenti</span>`;
      if (btn) btn.textContent = "Verifica Aggiornamenti";
      return;
    }

    if (result.hasUpdate) {
      const changelogHtml = result.releaseDescription
        ? `<div class="changelog" style="margin-top: 0.75rem; padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px; font-size: 0.8125rem; max-height: 200px; overflow-y: auto;">${marked.parse(result.releaseDescription)}</div>`
        : "";
      content.innerHTML = `
        <div class="update-available">
          <div class="update-info">
            <span class="update-icon">&#x2191;</span>
            <span>Nuova versione disponibile: <strong>v${result.latestVersion}</strong></span>
          </div>
          <span class="status-text" style="color: var(--text-tertiary); font-size: 0.8125rem">Installata: v${result.currentVersion}</span>
          ${changelogHtml}
          <button id="open-downloads-btn" class="btn primary" style="margin-top: 0.5rem">Scarica Aggiornamento</button>
        </div>`;

      const dlBtn = document.getElementById("open-downloads-btn");
      if (dlBtn && result.assets && result.assets.length > 0) {
        dlBtn.addEventListener("click", () => {
          const platform = process.platform;
          let assetUrl = "";
          if (platform === "win32") {
            assetUrl = result.assets.find((a) => a.name.endsWith(".exe"))?.url || "";
          } else if (platform === "linux") {
            assetUrl = result.assets.find((a) => a.name.endsWith(".AppImage"))?.url || "";
          }
          if (assetUrl) {
            ipcRenderer.invoke("open-release-page", assetUrl);
          } else if (result.releaseUrl) {
            ipcRenderer.invoke("open-release-page", result.releaseUrl);
          }
        });
      }
      if (btn) btn.textContent = "Verifica Aggiornamenti";
    } else {
      content.innerHTML = `<span class="status-text" style="color: var(--success)">L'app e aggiornata (v${result.currentVersion})</span>`;
      if (btn) btn.textContent = "Verifica Aggiornamenti";
    }
  } catch (error) {
    console.error("Errore nel check aggiornamenti:", error);
  }
}

ipcRenderer.on("dnd-mode-changed", (event, dndMode) => {
  if (dndToggle) {
    dndToggle.checked = dndMode;
  }
  if (dndStatus) {
    dndStatus.textContent = dndMode ? "Attivato" : "Disattivato";
  }
});

ipcRenderer.on("connection-status-changed", (event, isConnected) => {
  updateConnectionStatus(isConnected);
});

ipcRenderer.on("alarm-state-changed", (event, state) => {
  updateAlarmStateDisplay(state);
});

function updateAlarmStateDisplay(state) {
  const display = document.getElementById("alarm-state-display");
  const text = document.getElementById("alarm-state-text");
  const dot = document.getElementById("alarm-state-dot");
  if (!display || !text || !dot) return;

  const { getAlarmStateLabel } = require("./src/shared/alarm-states");
  text.textContent = getAlarmStateLabel(state);

  dot.classList.remove("triggered", "armed", "disarmed", "offline");
  const lower = (state || "").toLowerCase();
  if (lower === "triggered") {
    dot.classList.add("triggered");
  } else if (lower.startsWith("armed")) {
    dot.classList.add("armed");
  } else if (lower === "disarmed") {
    dot.classList.add("disarmed");
  } else {
    dot.classList.add("offline");
  }
}

async function refreshAlarmState() {
  const display = document.getElementById("alarm-state-display");
  const alarmEnabled = document.getElementById("alarm-enabled")?.checked;
  if (display) {
    display.style.display = alarmEnabled ? "block" : "none";
  }
  if (!alarmEnabled) return;
  try {
    const result = await ipcRenderer.invoke("get-alarm-state");
    updateAlarmStateDisplay(result?.state);
  } catch (error) {
    console.error("Errore nel recupero dello stato antifurto:", error);
  }
}

// Update sensor status periodically
setInterval(updateSensorStatus, 5000);
