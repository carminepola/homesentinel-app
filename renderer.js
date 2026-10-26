const { ipcRenderer } = require("electron");
const { marked } = require("marked");

// Importa i moduli
const ThemeManager = require("./src/renderer/theme-manager");
const MappingManager = require("./src/renderer/mapping-manager");
const { getAlarmStateLabel } = require("./src/shared/alarm-states");

// Stato dell'applicazione
let appSettings = {};
let homeAssistantDevices = { sensors: [], cameras: [], locks: [] };
let isConnected = false;
let lastSensorStatus = [];
let recentEvents = [];
let editingCustomCameraId = null;

// Modifiche non salvate nel form impostazioni (letto anche dal processo principale all'uscita)
let settingsBaseline = null;
window.hasUnsavedChanges = false;

// Gestori
let themeManager;
let mappingManager;

// Elementi DOM
const connectionStatus = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");
const dndToggle = document.getElementById("dnd-toggle");
const dndStatus = document.getElementById("dnd-status");

const $ = (id) => document.getElementById(id);

// Inizializzazione
document.addEventListener("DOMContentLoaded", async () => {
  themeManager = new ThemeManager();

  appSettings = await ipcRenderer.invoke("get-settings");

  // Il gestore delle mappature viene creato una sola volta: ricrearlo duplicherebbe i listener
  mappingManager = new MappingManager(appSettings, homeAssistantDevices);

  updateUIFromSettings();
  setupEventListeners();
  resetSettingsBaseline();
  updateDashboard();

  // Stato reale della connessione WebSocket (l'evento potrebbe essere arrivato prima del caricamento)
  ipcRenderer.invoke("get-connection-status").then(updateConnectionStatus).catch(() => {});
  ipcRenderer.invoke("get-recent-events").then((events) => {
    recentEvents = events || [];
    renderEvents();
  }).catch(() => {});

  // Operazioni indipendenti in parallelo per un avvio più rapido
  const tasks = [loadAutoStartStatus(), loadAppVersion()];
  if (isHomeAssistantConfigured()) {
    tasks.push(loadHomeAssistantDevices());
  }
  await Promise.all(tasks);

  updateSensorStatus();
});

function isHomeAssistantConfigured() {
  return !!(appSettings.homeAssistantUrl && appSettings.homeAssistantToken);
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === tabName);
  });
  updateSaveBar();
}

// Imposta gli event listener
function setupEventListeners() {
  if (dndToggle) {
    dndToggle.addEventListener("change", async () => {
      const dndMode = dndToggle.checked;
      updateDndDisplay(dndMode);
      try {
        await ipcRenderer.invoke("set-dnd-mode", dndMode);
      } catch (error) {
        console.error("Errore nell'impostazione della modalità DND:", error);
        updateDndDisplay(!dndMode);
      }
    });
  }

  // L'avvio automatico viene applicato subito (non fa parte del form da salvare)
  const autoStartToggle = $("auto-start-toggle");
  if (autoStartToggle) {
    autoStartToggle.addEventListener("change", async () => {
      const enabled = autoStartToggle.checked;
      try {
        const result = await ipcRenderer.invoke("set-auto-start", enabled);
        if (!result.success) {
          autoStartToggle.checked = !enabled;
          showNotification(`Impossibile ${enabled ? "attivare" : "disattivare"} l'avvio automatico: ${result.error || "errore sconosciuto"}`, "error");
          return;
        }
        appSettings.autoStart = enabled;
        showNotification(enabled ? "Avvio automatico attivato" : "Avvio automatico disattivato", "success");
      } catch (error) {
        autoStartToggle.checked = !enabled;
        showNotification(`Errore nell'impostazione dell'avvio automatico: ${error.message}`, "error");
      }
    });
  }

  const alarmEnabledToggle = $("alarm-enabled");
  if (alarmEnabledToggle) {
    alarmEnabledToggle.addEventListener("change", () => {
      $("alarm-config-fields").style.display = alarmEnabledToggle.checked ? "" : "none";
      refreshAlarmState();
    });
  }

  const dndScheduleEnabled = $("dnd-schedule-enabled");
  if (dndScheduleEnabled) {
    dndScheduleEnabled.addEventListener("change", () => {
      $("dnd-schedule-fields").style.display = dndScheduleEnabled.checked ? "" : "none";
    });
  }

  const alarmPinEnabled = $("alarm-pin-enabled");
  if (alarmPinEnabled) {
    alarmPinEnabled.addEventListener("change", () => {
      $("alarm-pin-group").style.display = alarmPinEnabled.checked ? "" : "none";
    });
  }

  $("default-size")?.addEventListener("change", () => toggleCustomSizeFields("default-size", "custom-size-container"));

  // Navigazione tra le sezioni delle impostazioni
  document.querySelectorAll(".settings-nav-btn").forEach((button) => {
    button.addEventListener("click", () => switchSettingsSection(button.getAttribute("data-section")));
  });

  document.querySelectorAll("#position-picker .corner").forEach((corner) => {
    corner.addEventListener("click", () => {
      setPipPosition(corner.getAttribute("data-value"));
      $("pip-position").dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  $("prewarmer-enabled")?.addEventListener("change", updatePrewarmerRow);

  ["dnd-schedule-start", "dnd-schedule-end"].forEach((id) => {
    $(id)?.addEventListener("input", updateDndTimeline);
  });
  document.querySelectorAll(".day-presets [data-days]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.getAttribute("data-days").split(",");
      document.querySelectorAll("#dnd-schedule-days input[type='checkbox']").forEach((input) => {
        input.checked = selected.includes(input.getAttribute("data-day"));
      });
      updateDndTimeline();
      updateSaveBar();
    });
  });
  document.querySelectorAll("#dnd-schedule-days input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", updateDndTimeline);
  });
  $("test-size")?.addEventListener("change", () => toggleCustomSizeFields("test-size", "test-custom-size-container"));

  // Rilevamento modifiche nel form impostazioni
  const settingsPane = $("settings");
  const onSettingsEdit = (event) => {
    if (event.target.id === "auto-start-toggle") return;
    updateSaveBar();
  };
  settingsPane.addEventListener("input", onSettingsEdit);
  settingsPane.addEventListener("change", onSettingsEdit);

  $("save-settings-btn")?.addEventListener("click", saveSettings);
  $("discard-settings-btn")?.addEventListener("click", discardSettingsChanges);
  $("test-connection-btn")?.addEventListener("click", testConnection);
  $("test-pip-btn")?.addEventListener("click", testPiP);
  $("export-settings-btn")?.addEventListener("click", exportSettings);
  $("import-settings-btn")?.addEventListener("click", importSettings);
  $("reset-settings-btn")?.addEventListener("click", resetSettings);
  $("hide-btn")?.addEventListener("click", () => ipcRenderer.invoke("hide-window"));
  // La conferma per modifiche non salvate è gestita dal processo principale
  $("quit-btn")?.addEventListener("click", () => ipcRenderer.invoke("quit-app"));
  $("test-alarm-btn")?.addEventListener("click", () => ipcRenderer.invoke("test-alarm"));

  const checkUpdateBtn = $("check-update-btn");
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener("click", async () => {
      checkUpdateBtn.textContent = "Verifica in corso...";
      checkUpdateBtn.disabled = true;
      await checkForUpdates();
      checkUpdateBtn.textContent = "Verifica aggiornamenti";
      checkUpdateBtn.disabled = false;
    });
  }

  // Dashboard
  $("onboarding-start-btn")?.addEventListener("click", () => {
    switchTab("settings");
    switchSettingsSection("connection");
    $("ha-url")?.focus();
  });
  $("quick-open-gate-btn")?.addEventListener("click", openGateFromDashboard);
  $("quick-add-mapping-btn")?.addEventListener("click", () => {
    switchTab("sensors");
    mappingManager.openMappingModal();
  });
  $("quick-test-btn")?.addEventListener("click", () => switchTab("test"));

  // Telecamere personalizzate
  $("add-custom-camera-btn")?.addEventListener("click", () => openCustomCameraModal());
  $("save-custom-camera-btn")?.addEventListener("click", saveCustomCamera);
  $("cancel-custom-camera-btn")?.addEventListener("click", closeCustomCameraModal);
  $("close-custom-camera-modal")?.addEventListener("click", closeCustomCameraModal);

  // Esc chiude le finestre modali
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if ($("custom-camera-modal").classList.contains("show")) closeCustomCameraModal();
    if ($("mapping-modal").classList.contains("show")) mappingManager.closeMappingModal();
  });

  // Gestione tab
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.getAttribute("data-tab")));
  });

  // Aggiorna i tempi relativi degli eventi
  setInterval(renderEvents, 30000);
}

function toggleCustomSizeFields(selectId, containerId) {
  const select = $(selectId);
  const container = $(containerId);
  if (select && container) {
    container.style.display = select.value === "custom" ? "" : "none";
  }
}

// Assicura che una select contenga l'opzione salvata, anche se Home Assistant non l'ha (ancora)
// restituita: così salvare le impostazioni offline non cancella la configurazione esistente
function ensureSelectValue(select, value) {
  if (!select) return;
  if (value && !Array.from(select.options).some((o) => o.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value} (non trovato)`;
    select.appendChild(option);
  }
  select.value = value || "";
}

function switchSettingsSection(section) {
  document.querySelectorAll(".settings-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-section") === section);
  });
  document.querySelectorAll(".settings-section").forEach((pane) => {
    pane.classList.toggle("active", pane.getAttribute("data-section") === section);
  });
  document.querySelector("main").scrollTop = 0;
}

function setPipPosition(position) {
  $("pip-position").value = position;
  document.querySelectorAll("#position-picker .corner").forEach((corner) => {
    const active = corner.getAttribute("data-value") === position;
    corner.classList.toggle("active", active);
    corner.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function updatePrewarmerRow() {
  $("prewarmer-interval-row").classList.toggle("disabled", !$("prewarmer-enabled").checked);
}

const parseTime = (value) => {
  const [h, m] = (value || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
};

// Disegna la fascia oraria di Non disturbare sulla timeline delle 24 ore e la descrive a parole
function updateDndTimeline() {
  const track = $("dnd-timeline-track");
  if (!track) return;
  const startValue = $("dnd-schedule-start").value || "00:00";
  const endValue = $("dnd-schedule-end").value || "00:00";
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  const day = 24 * 60;

  const segments = start === end ? [] : start < end ? [[start, end]] : [[start, day], [0, end]];
  track.replaceChildren(...segments.map(([from, to]) => {
    const segment = document.createElement("div");
    segment.className = "day-timeline-segment";
    segment.style.left = `${(from / day) * 100}%`;
    segment.style.width = `${((to - from) / day) * 100}%`;
    return segment;
  }));

  let description;
  if (start === end) {
    description = "Scegli orari diversi per attivare la pianificazione.";
  } else if (start > end) {
    description = `Dalle ${startValue} fino alle ${endValue} del giorno dopo.`;
  } else {
    description = `Dalle ${startValue} alle ${endValue}.`;
  }
  $("dnd-schedule-description").textContent = description;
}

// Funzioni per le impostazioni
function updateUIFromSettings() {
  $("ha-url").value = appSettings.homeAssistantUrl || "";
  $("ha-token").value = appSettings.homeAssistantToken || "";

  const pip = appSettings.pipSettings || {};
  $("pip-duration").value = pip.defaultDuration || 10;
  setPipPosition(pip.position || "top-right");
  $("default-size").value = pip.size || "medium";
  $("custom-width").value = pip.width || 320;
  $("custom-height").value = pip.height || 240;
  toggleCustomSizeFields("default-size", "custom-size-container");

  const margins = pip.margins || {};
  $("margin-top").value = margins.top ?? 20;
  $("margin-right").value = margins.right ?? 20;
  $("margin-bottom").value = margins.bottom ?? 20;
  $("margin-left").value = margins.left ?? 20;

  $("auto-start-toggle").checked = appSettings.autoStart || false;
  $("use-hls").checked = appSettings.streamingSettings?.useHLS || false;
  $("prewarmer-enabled").checked = appSettings.preWarmerSettings?.enabled ?? true;
  $("prewarmer-interval").value = appSettings.preWarmerSettings?.intervalSeconds || 30;
  updatePrewarmerRow();

  const alarm = appSettings.alarmSettings || {};
  $("alarm-enabled").checked = alarm.enabled || false;
  ensureSelectValue($("alarm-sensor"), alarm.sensorId);
  $("alarm-config-fields").style.display = alarm.enabled ? "" : "none";
  $("alarm-pin-enabled").checked = alarm.pinEnabled || false;
  $("alarm-pin").value = alarm.pin || "";
  $("alarm-pin-group").style.display = alarm.pinEnabled ? "" : "none";
  refreshAlarmState();

  restoreGateValues();

  updateDndDisplay(appSettings.dndMode || false);

  const dndSchedule = appSettings.dndSchedule || {};
  $("dnd-schedule-enabled").checked = !!dndSchedule.enabled;
  $("dnd-schedule-start").value = dndSchedule.startTime || "18:00";
  $("dnd-schedule-end").value = dndSchedule.endTime || "09:00";
  $("dnd-schedule-fields").style.display = dndSchedule.enabled ? "" : "none";
  const days = dndSchedule.days || [false, false, false, false, false, false, false];
  document.querySelectorAll("#dnd-schedule-days input[type='checkbox']").forEach((input) => {
    input.checked = !!days[parseInt(input.getAttribute("data-day"), 10)];
  });
  updateDndTimeline();

  updateCameraSelects();
  renderCustomCameras();
  if (mappingManager) {
    mappingManager.updateSensorMappingsList();
  }
}

const readInt = (id, fallback) => {
  const value = parseInt($(id)?.value, 10);
  return Number.isNaN(value) ? fallback : value;
};

// Legge le impostazioni dal form (senza i campi gestiti altrove: mappature, telecamere, DnD, avvio automatico)
function collectSettingsFromForm() {
  return {
    homeAssistantUrl: ($("ha-url").value || "").trim().replace(/\/+$/, ""),
    homeAssistantToken: ($("ha-token").value || "").trim(),
    dndSchedule: {
      enabled: $("dnd-schedule-enabled").checked,
      startTime: $("dnd-schedule-start").value || "18:00",
      endTime: $("dnd-schedule-end").value || "09:00",
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
      defaultDuration: readInt("pip-duration", 10),
      position: $("pip-position").value || "top-right",
      size: $("default-size").value || "medium",
      width: readInt("custom-width", 320),
      height: readInt("custom-height", 240),
      margins: {
        top: readInt("margin-top", 20),
        right: readInt("margin-right", 20),
        bottom: readInt("margin-bottom", 20),
        left: readInt("margin-left", 20),
      },
    },
    streamingSettings: {
      useHLS: $("use-hls").checked,
    },
    preWarmerSettings: {
      enabled: $("prewarmer-enabled").checked,
      intervalSeconds: readInt("prewarmer-interval", 30),
    },
    alarmSettings: {
      enabled: $("alarm-enabled").checked,
      sensorId: $("alarm-sensor").value || "",
      pinEnabled: $("alarm-pin-enabled").checked,
      pin: $("alarm-pin").value || "",
    },
    gateSettings: {
      intercomSensorId: $("intercom-sensor").value || "",
      gateLockId: $("gate-lock").value || "",
      intercomCameraId: $("intercom-camera").value || "",
    },
  };
}

// Sezione delle impostazioni in cui si trova ciascun gruppo di valori
const SETTINGS_SECTION_OF = {
  homeAssistantUrl: "connection",
  homeAssistantToken: "connection",
  streamingSettings: "connection",
  preWarmerSettings: "connection",
  pipSettings: "pip",
  alarmSettings: "alarm",
  gateSettings: "alarm",
  dndSchedule: "dnd",
};

function resetSettingsBaseline() {
  settingsBaseline = JSON.stringify(collectSettingsFromForm());
  updateSaveBar();
}

function updateSaveBar() {
  const dirty = settingsBaseline !== null && JSON.stringify(collectSettingsFromForm()) !== settingsBaseline;
  window.hasUnsavedChanges = dirty;
  const settingsVisible = $("settings").classList.contains("active");
  $("save-bar").classList.toggle("visible", dirty && settingsVisible);
  // Segnala le modifiche in sospeso anche sul tab e sulle sezioni coinvolte
  document.querySelector('.tab-btn[data-tab="settings"]').textContent = dirty ? "Impostazioni •" : "Impostazioni";
  const current = collectSettingsFromForm();
  const baseline = settingsBaseline ? JSON.parse(settingsBaseline) : current;
  const changedKeys = Object.keys(current).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(baseline[key]));
  document.querySelectorAll(".settings-nav-btn").forEach((btn) => {
    const section = btn.getAttribute("data-section");
    btn.classList.toggle("dirty", changedKeys.some((key) => SETTINGS_SECTION_OF[key] === section));
  });
}

function discardSettingsChanges() {
  updateUIFromSettings();
  resetSettingsBaseline();
  showNotification("Modifiche annullate", "info");
}

// Ritorna { message, section } del primo errore, oppure null
function validateSettings(settings) {
  const error = (message, section) => ({ message, section });
  if (settings.homeAssistantUrl && !/^https?:\/\/[^\s]+$/i.test(settings.homeAssistantUrl)) {
    return error("L'indirizzo di Home Assistant deve iniziare con http:// o https://", "connection");
  }
  const interval = settings.preWarmerSettings.intervalSeconds;
  if (interval < 10 || interval > 300) {
    return error("L'intervallo di pre-riscaldamento deve essere tra 10 e 300 secondi", "connection");
  }
  const pip = settings.pipSettings;
  if (pip.defaultDuration < 1 || pip.defaultDuration > 60) {
    return error("La durata predefinita deve essere tra 1 e 60 secondi", "pip");
  }
  if (pip.size === "custom" && (pip.width < 100 || pip.width > 1920 || pip.height < 100 || pip.height > 1080)) {
    return error("Dimensioni personalizzate non valide. Larghezza: 100-1920px, altezza: 100-1080px", "pip");
  }
  if (Object.values(pip.margins).some((m) => m < 0 || m > 200)) {
    return error("I margini devono essere tra 0 e 200 pixel", "pip");
  }
  if (settings.alarmSettings.enabled && !settings.alarmSettings.sensorId) {
    return error("Seleziona l'antifurto oppure disattiva l'allarme", "alarm");
  }
  if (settings.alarmSettings.pinEnabled && !/^\d{4,6}$/.test(settings.alarmSettings.pin)) {
    return error("Il PIN dell'allarme deve avere da 4 a 6 cifre", "alarm");
  }
  if (settings.dndSchedule.enabled && settings.dndSchedule.startTime === settings.dndSchedule.endTime) {
    return error("Scegli orari diversi per la pianificazione di Non disturbare", "dnd");
  }
  return null;
}

async function saveSettings() {
  const formSettings = collectSettingsFromForm();
  const validationError = validateSettings(formSettings);
  if (validationError) {
    switchSettingsSection(validationError.section);
    showNotification(validationError.message, "error");
    return;
  }

  const haChanged = formSettings.homeAssistantUrl !== appSettings.homeAssistantUrl ||
    formSettings.homeAssistantToken !== appSettings.homeAssistantToken;
  const newSettings = { ...appSettings, ...formSettings };

  try {
    await ipcRenderer.invoke("save-settings", newSettings);
    appSettings = newSettings;
    mappingManager.setAppSettings(appSettings);
    resetSettingsBaseline();
    updateDashboard();
    showNotification("Impostazioni salvate", "success");

    if (haChanged && isHomeAssistantConfigured()) {
      await loadHomeAssistantDevices();
    }
  } catch (error) {
    showNotification("Errore nel salvataggio delle impostazioni: " + error.message, "error");
  }
}

async function testConnection() {
  const url = ($("ha-url").value || "").trim().replace(/\/+$/, "");
  const token = ($("ha-token").value || "").trim();

  if (!url || !token) {
    showNotification("Inserisci URL e token di Home Assistant", "error");
    return;
  }

  const button = $("test-connection-btn");
  button.disabled = true;
  button.textContent = "Verifica in corso...";
  try {
    const response = await fetch(`${url}/api/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const hint = window.hasUnsavedChanges ? ": ora premi Salva" : "";
      showNotification(`Connessione riuscita${hint}`, "success");
    } else if (response.status === 401) {
      throw new Error("token non valido");
    } else {
      throw new Error(`risposta HTTP ${response.status}`);
    }
  } catch (error) {
    const message = error.name === "TimeoutError" ? "Home Assistant non risponde" : error.message;
    showNotification("Connessione fallita: " + message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Test connessione";
  }
}

function updateConnectionStatus(connected) {
  isConnected = !!connected;
  if (connectionStatus && connectionText) {
    connectionStatus.classList.toggle("online", isConnected);
    connectionStatus.classList.toggle("offline", !isConnected);
    connectionText.textContent = isConnected ? "Connesso" : (isHomeAssistantConfigured() ? "Connessione in corso..." : "Non configurato");
  }
  let host = "";
  try {
    host = appSettings.homeAssistantUrl ? new URL(appSettings.homeAssistantUrl).host : "";
  } catch (error) {
    host = appSettings.homeAssistantUrl;
  }
  $("connection-detail").textContent = host;
}

// Funzioni per i dispositivi Home Assistant
async function loadHomeAssistantDevices() {
  try {
    const devices = await ipcRenderer.invoke("get-home-assistant-devices");

    if (devices.error) {
      showNotification("Impossibile caricare i dispositivi: " + devices.error, "error");
      return;
    }

    const wasDirty = window.hasUnsavedChanges;
    homeAssistantDevices = devices;
    updateDeviceSelects();
    mappingManager.updateHomeAssistantDevices(homeAssistantDevices);
    // Le select ora contengono le opzioni reali: aggiorna il riferimento se l'utente non aveva modificato nulla
    if (!wasDirty) resetSettingsBaseline();
    updateDashboard();
  } catch (error) {
    showNotification("Impossibile caricare i dispositivi: " + error.message, "error");
  }
}

function fillSelect(select, placeholder, entities, keepValue) {
  if (!select) return;
  const value = keepValue !== undefined ? keepValue : select.value;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.appendChild(empty);
  entities.forEach((entity) => {
    const option = document.createElement("option");
    option.value = entity.entity_id;
    option.textContent = entity.attributes?.friendly_name || entity.entity_id;
    select.appendChild(option);
  });
  ensureSelectValue(select, value);
}

function updateDeviceSelects() {
  const sensors = homeAssistantDevices.sensors || [];
  fillSelect($("sensor-select"), "-- Seleziona un sensore --", sensors);
  fillSelect($("alarm-sensor"), "-- Seleziona un antifurto --",
    sensors.filter((s) => s.entity_id.startsWith("alarm_control_panel.")),
    appSettings.alarmSettings?.sensorId || $("alarm-sensor").value);
  fillSelect($("intercom-sensor"), "-- Seleziona un sensore --",
    sensors.filter((s) => s.entity_id.startsWith("binary_sensor.") || s.entity_id.startsWith("input_boolean.")),
    $("intercom-sensor").value || appSettings.gateSettings?.intercomSensorId);
  fillSelect($("gate-lock"), "-- Seleziona un'entità lock --", homeAssistantDevices.locks || [],
    $("gate-lock").value || appSettings.gateSettings?.gateLockId);
  fillSelect($("intercom-camera"), "-- Nessuna telecamera --", homeAssistantDevices.cameras || [],
    $("intercom-camera").value || appSettings.gateSettings?.intercomCameraId);
  updateCameraSelects();
}

// Select delle telecamere: quelle di Home Assistant più quelle personalizzate
function updateCameraSelects() {
  const groups = [
    { label: "Home Assistant", items: (homeAssistantDevices.cameras || []).map((c) => ({ value: c.entity_id, text: c.attributes?.friendly_name || c.entity_id })) },
    { label: "Personalizzate", items: (appSettings.customCameras || []).map((c) => ({ value: c.id, text: c.name || c.url })) },
  ];

  ["camera-select", "test-camera"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const value = select.value;
    select.innerHTML = '<option value="">-- Seleziona una telecamera --</option>';
    groups.forEach((group) => {
      if (group.items.length === 0) return;
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      group.items.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.text;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
    if (Array.from(select.options).some((o) => o.value === value)) {
      select.value = value;
    }
  });
}

function restoreGateValues() {
  const gate = appSettings.gateSettings || {};
  ensureSelectValue($("intercom-sensor"), gate.intercomSensorId);
  ensureSelectValue($("gate-lock"), gate.gateLockId);
  ensureSelectValue($("intercom-camera"), gate.intercomCameraId);
}

// Stato dei sensori
const SENSOR_STATE_LABELS = {
  on: { text: "Attivo", cls: "on" },
  off: { text: "Inattivo", cls: "off" },
  unavailable: { text: "Non disponibile", cls: "unknown" },
  unknown: { text: "Sconosciuto", cls: "unknown" },
};

async function updateSensorStatus() {
  try {
    const sensorStatus = await ipcRenderer.invoke("get-sensor-status");
    lastSensorStatus = sensorStatus || [];
    updateDashboard();

    const statusList = $("sensor-status-list");
    if (!statusList) return;

    if (lastSensorStatus.length === 0) {
      statusList.innerHTML = '<p class="empty-state">Nessun sensore monitorato</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    lastSensorStatus.forEach((status) => {
      const statusElement = document.createElement("div");
      statusElement.className = "sensor-status-item";

      const label = SENSOR_STATE_LABELS[status.status] || { text: status.status, cls: "unknown" };
      const nameEl = document.createElement("span");
      nameEl.className = "sensor-status-name";
      nameEl.textContent = getSensorName(status.sensorId);
      const valueEl = document.createElement("span");
      valueEl.className = `sensor-status-value ${label.cls}`;
      valueEl.textContent = label.text;
      statusElement.append(nameEl, valueEl);
      fragment.appendChild(statusElement);
    });

    statusList.replaceChildren(fragment);
  } catch (error) {
    console.error("Errore nell'aggiornamento dello stato dei sensori:", error);
  }
}

function getSensorName(sensorId) {
  const sensor = (homeAssistantDevices.sensors || []).find((s) => s.entity_id === sensorId);
  return sensor ? sensor.attributes.friendly_name || sensor.entity_id : sensorId;
}

// Dashboard
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function updateDashboard() {
  $("onboarding-card").style.display = isHomeAssistantConfigured() ? "none" : "block";
  updateConnectionStatus(isConnected);

  $("dashboard-alarm-card").style.display = appSettings.alarmSettings?.enabled ? "block" : "none";

  const schedule = appSettings.dndSchedule || {};
  let scheduleText = "";
  if (schedule.enabled) {
    const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => schedule.days?.[d]).map((d) => DAY_NAMES[d]);
    const daysText = days.length === 7 ? "tutti i giorni" : days.length === 0 ? "nessun giorno" : days.join(", ");
    scheduleText = `Pianificato ${schedule.startTime}–${schedule.endTime}, ${daysText}`;
  }
  $("dnd-schedule-summary").textContent = scheduleText;

  const mappings = appSettings.sensorCameraMappings || [];
  const activeCount = lastSensorStatus.filter((s) => s.status === "on").length;
  $("dashboard-sensor-count").textContent = mappings.length;
  $("dashboard-sensor-active").textContent = mappings.length === 0
    ? "Nessuna mappatura"
    : activeCount > 0 ? `${activeCount} attiv${activeCount === 1 ? "o" : "i"} ora` : "Tutti inattivi";

  $("quick-open-gate-btn").style.display = appSettings.gateSettings?.gateLockId ? "" : "none";
}

function updateDndDisplay(dndMode) {
  if (dndToggle) dndToggle.checked = dndMode;
  if (dndStatus) dndStatus.textContent = dndMode ? "Attivo: nessuna finestra PiP" : "Disattivato";
}

async function openGateFromDashboard() {
  if (!confirm("Aprire il cancello?")) return;
  const button = $("quick-open-gate-btn");
  button.disabled = true;
  try {
    const result = await ipcRenderer.invoke("open-gate");
    if (result?.success) {
      showNotification("Comando di apertura inviato", "success");
    } else {
      showNotification("Impossibile aprire il cancello: " + (result?.error || "errore sconosciuto"), "error");
    }
  } finally {
    button.disabled = false;
  }
}

// Ultimi eventi
const EVENT_ICONS = { sensor: "👁", intercom: "🔔", gate: "🔓", alarm: "🚨", connection: "📡" };

function formatEventTime(isoTime) {
  const date = new Date(isoTime);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60000) return "adesso";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} min fa`;
  const time = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? time : `${date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function renderEvents() {
  const list = $("event-list");
  if (!list) return;

  if (recentEvents.length === 0) {
    list.innerHTML = '<p class="empty-state">Nessun evento dall\'avvio dell\'app</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  recentEvents.slice(0, 15).forEach((event) => {
    const item = document.createElement("div");
    item.className = `event-item ${event.type}`;

    const icon = document.createElement("span");
    icon.className = "event-icon";
    icon.textContent = EVENT_ICONS[event.type] || "•";

    const body = document.createElement("div");
    body.className = "event-body";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = event.title;
    body.appendChild(title);
    if (event.detail) {
      const detail = document.createElement("div");
      detail.className = "event-detail";
      detail.textContent = event.detail;
      body.appendChild(detail);
    }

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatEventTime(event.time);
    time.title = new Date(event.time).toLocaleString("it-IT");

    item.append(icon, body, time);
    fragment.appendChild(item);
  });
  list.replaceChildren(fragment);
}

// Telecamere personalizzate
function renderCustomCameras() {
  const list = $("custom-camera-list");
  if (!list) return;
  const cameras = appSettings.customCameras || [];

  if (cameras.length === 0) {
    list.innerHTML = "<p>Nessuna telecamera personalizzata</p>";
    return;
  }

  const streamLabels = { auto: "Auto", mjpeg: "MJPEG", hls: "HLS", mp4: "MP4" };
  const fragment = document.createDocumentFragment();
  cameras.forEach((camera) => {
    const item = document.createElement("div");
    item.className = "custom-camera-item";

    const info = document.createElement("div");
    info.className = "custom-camera-info";
    const name = document.createElement("h4");
    name.textContent = `${camera.name} · ${streamLabels[camera.streamType] || "Auto"}`;
    const url = document.createElement("p");
    url.textContent = camera.url;
    url.title = camera.url;
    info.append(name, url);

    const actions = document.createElement("div");
    actions.className = "custom-camera-actions";
    const edit = document.createElement("button");
    edit.className = "btn-edit";
    edit.textContent = "Modifica";
    edit.addEventListener("click", () => openCustomCameraModal(camera.id));
    const remove = document.createElement("button");
    remove.className = "btn-remove";
    remove.textContent = "Rimuovi";
    remove.addEventListener("click", () => removeCustomCamera(camera.id));
    actions.append(edit, remove);

    item.append(info, actions);
    fragment.appendChild(item);
  });
  list.replaceChildren(fragment);
}

function openCustomCameraModal(cameraId = null) {
  editingCustomCameraId = cameraId;
  const camera = (appSettings.customCameras || []).find((c) => c.id === cameraId);
  $("custom-camera-modal-title").textContent = camera ? "Modifica telecamera" : "Aggiungi telecamera";
  $("custom-camera-name").value = camera?.name || "";
  $("custom-camera-url").value = camera?.url || "";
  $("custom-camera-stream-type").value = camera?.streamType || "auto";
  $("custom-camera-modal").classList.add("show");
  setTimeout(() => $("custom-camera-name").focus(), 50);
}

function closeCustomCameraModal() {
  $("custom-camera-modal").classList.remove("show");
  editingCustomCameraId = null;
}

async function persistCustomCameras(customCameras, sensorCameraMappings = appSettings.sensorCameraMappings) {
  const updated = { ...appSettings, customCameras, sensorCameraMappings };
  await ipcRenderer.invoke("save-settings", updated);
  appSettings = updated;
  mappingManager.setAppSettings(appSettings);
  renderCustomCameras();
  updateCameraSelects();
  updateDashboard();
}

async function saveCustomCamera() {
  const name = $("custom-camera-name").value.trim();
  const url = $("custom-camera-url").value.trim();
  const streamType = $("custom-camera-stream-type").value || "auto";

  if (!name) {
    showNotification("Inserisci un nome per la telecamera", "error");
    return;
  }
  if (!/^https?:\/\/\S+$/i.test(url)) {
    showNotification("Inserisci un URL valido (http:// o https://)", "error");
    return;
  }

  const cameras = [...(appSettings.customCameras || [])];
  if (editingCustomCameraId) {
    const index = cameras.findIndex((c) => c.id === editingCustomCameraId);
    if (index >= 0) cameras[index] = { ...cameras[index], name, url, streamType };
  } else {
    cameras.push({ id: `custom_${Date.now()}`, name, url, streamType });
  }

  try {
    const wasEditing = !!editingCustomCameraId;
    await persistCustomCameras(cameras);
    closeCustomCameraModal();
    showNotification(wasEditing ? "Telecamera aggiornata" : "Telecamera aggiunta", "success");
  } catch (error) {
    showNotification("Errore nel salvataggio della telecamera: " + error.message, "error");
  }
}

async function removeCustomCamera(cameraId) {
  const camera = (appSettings.customCameras || []).find((c) => c.id === cameraId);
  if (!camera) return;
  const usedBy = (appSettings.sensorCameraMappings || []).filter((m) => m.cameraId === cameraId);
  const warning = usedBy.length > 0
    ? `\n\nÈ usata da ${usedBy.length} mappatur${usedBy.length === 1 ? "a, che verrà rimossa" : "e, che verranno rimosse"}.`
    : "";
  if (!confirm(`Rimuovere la telecamera "${camera.name}"?${warning}`)) return;

  try {
    await persistCustomCameras(
      appSettings.customCameras.filter((c) => c.id !== cameraId),
      (appSettings.sensorCameraMappings || []).filter((m) => m.cameraId !== cameraId)
    );
    showNotification("Telecamera rimossa", "success");
  } catch (error) {
    showNotification("Errore nella rimozione della telecamera: " + error.message, "error");
  }
}

// Funzioni per il test
async function testPiP() {
  if (dndToggle && dndToggle.checked) {
    showNotification("Disattiva Non disturbare per provare una telecamera", "warning");
    return;
  }

  const cameraId = $("test-camera")?.value;
  const duration = readInt("test-duration", 10);
  const sizeSelect = $("test-size")?.value || "medium";

  if (!cameraId) {
    showNotification("Seleziona una telecamera", "error");
    return;
  }
  if (duration < 1 || duration > 60) {
    showNotification("La durata deve essere tra 1 e 60 secondi", "error");
    return;
  }

  const cameraSettings = { size: sizeSelect };
  if (sizeSelect === "custom") {
    const customWidth = readInt("test-custom-width", 320);
    const customHeight = readInt("test-custom-height", 240);
    if (customWidth < 100 || customWidth > 1920 || customHeight < 100 || customHeight > 1080) {
      showNotification("Dimensioni personalizzate non valide. Larghezza: 100-1920px, altezza: 100-1080px", "error");
      return;
    }
    cameraSettings.width = customWidth;
    cameraSettings.height = customHeight;
  }

  try {
    await ipcRenderer.invoke("test-camera", null, cameraSettings, cameraId, duration);
    showNotification("Prova avviata", "success");
  } catch (error) {
    showNotification("Errore nell'avvio della prova: " + error.message, "error");
  }
}

// Notifiche
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.setAttribute("role", type === "error" ? "alert" : "status");

  document.body.appendChild(notification);

  requestAnimationFrame(() => {
    notification.classList.add("show");
  });

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 250);
  }, type === "error" ? 5000 : 3000);
}

// Gestione delle impostazioni
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

async function applyReplacedSettings(settings, message) {
  appSettings = settings;
  mappingManager.setAppSettings(appSettings);
  updateUIFromSettings();
  resetSettingsBaseline();
  updateDashboard();
  showNotification(message, "success");
  if (isHomeAssistantConfigured()) {
    await loadHomeAssistantDevices();
  }
}

async function importSettings() {
  if (window.hasUnsavedChanges && !confirm("Le modifiche non salvate andranno perse. Continuare?")) return;
  try {
    const result = await ipcRenderer.invoke("import-settings");
    if (result.success) {
      await applyReplacedSettings(result.settings, "Impostazioni importate");
    } else if (!result.canceled) {
      showNotification(`Errore nell'importazione: ${result.error}`, "error");
    }
  } catch (error) {
    showNotification("Errore nell'importazione delle impostazioni: " + error.message, "error");
  }
}

async function resetSettings() {
  if (!confirm("Ripristinare tutte le impostazioni predefinite? Verranno rimosse anche le mappature e la connessione a Home Assistant. L'operazione non si può annullare.")) {
    return;
  }
  try {
    const result = await ipcRenderer.invoke("reset-settings");
    if (result.success) {
      await applyReplacedSettings(result.settings, "Impostazioni ripristinate");
    } else {
      showNotification(`Errore nel ripristino: ${result.error}`, "error");
    }
  } catch (error) {
    showNotification("Errore nel ripristino delle impostazioni: " + error.message, "error");
  }
}

ipcRenderer.on("open-settings", () => switchTab("settings"));

async function loadAutoStartStatus() {
  try {
    const result = await ipcRenderer.invoke("get-auto-start-status");
    if (result !== undefined) {
      $("auto-start-toggle").checked = result.enabled || false;
    }
  } catch (error) {
    console.error("Errore nel caricamento dello stato dell'avvio automatico:", error);
  }
}

async function loadAppVersion() {
  try {
    const { version } = await ipcRenderer.invoke("get-app-version");
    $("app-version").textContent = `v${version}`;
  } catch (error) {
    console.error("Errore nel caricamento della versione:", error);
  }
}

async function checkForUpdates() {
  const content = $("update-status-content");
  try {
    const result = await ipcRenderer.invoke("check-for-updates");
    if (!content) return;

    if (result.error) {
      content.innerHTML = `<span class="status-text" style="color: var(--text-tertiary)">Impossibile verificare gli aggiornamenti</span>`;
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
          <button id="open-downloads-btn" class="btn primary" style="margin-top: 0.5rem">Scarica aggiornamento</button>
        </div>`;

      $("open-downloads-btn")?.addEventListener("click", () => {
        ipcRenderer.invoke("open-release-page", "https://git.devmin.it/carmine/homesentinel-app/releases/");
      });
    } else {
      content.innerHTML = `<span class="status-text" style="color: var(--success)">L'app è aggiornata (v${result.currentVersion})</span>`;
    }
  } catch (error) {
    console.error("Errore nel check aggiornamenti:", error);
  }
}

ipcRenderer.on("dnd-mode-changed", (event, dndMode) => {
  appSettings.dndMode = dndMode;
  updateDndDisplay(dndMode);
});

ipcRenderer.on("connection-status-changed", (event, connected) => {
  updateConnectionStatus(connected);
});

ipcRenderer.on("alarm-state-changed", (event, state) => {
  updateAlarmStateDisplay(state);
});

ipcRenderer.on("event-logged", (event, entry) => {
  recentEvents.unshift(entry);
  recentEvents.length = Math.min(recentEvents.length, 50);
  renderEvents();
});

function setAlarmDot(dot, state) {
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

function updateAlarmStateDisplay(state) {
  const label = getAlarmStateLabel(state);
  [["alarm-state-text", "alarm-state-dot"], ["dashboard-alarm-text", "dashboard-alarm-dot"]].forEach(([textId, dotId]) => {
    const text = $(textId);
    const dot = $(dotId);
    if (!text || !dot) return;
    text.textContent = label;
    setAlarmDot(dot, state);
  });
}

async function refreshAlarmState() {
  const display = $("alarm-state-display");
  const alarmEnabled = $("alarm-enabled")?.checked;
  if (display) {
    display.style.display = alarmEnabled ? "" : "none";
  }
  if (!alarmEnabled && !appSettings.alarmSettings?.enabled) return;
  try {
    const result = await ipcRenderer.invoke("get-alarm-state");
    updateAlarmStateDisplay(result?.state);
  } catch (error) {
    console.error("Errore nel recupero dello stato antifurto:", error);
  }
}

// Aggiorna periodicamente lo stato dei sensori, solo quando la finestra è visibile
setInterval(() => {
  if (!document.hidden) updateSensorStatus();
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateSensorStatus();
});
