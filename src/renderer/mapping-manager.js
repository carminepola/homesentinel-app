const appConfig = require("../shared/app-config");
const { ALARM_STATES } = require("../shared/alarm-states");

class MappingManager {
  constructor(appSettings, homeAssistantDevices) {
    this.appSettings = appSettings;
    this.homeAssistantDevices = homeAssistantDevices;
    this.editingMappingId = null;

    // Elementi DOM
    this.modal = document.getElementById("mapping-modal");
    this.sensorList = document.getElementById("sensor-list");
    this.sensorSelect = document.getElementById("sensor-select");
    this.cameraSelect = document.getElementById("camera-select");
    this.sensorInput = null;
    this.sensorDropdown = null;

    this.init();
  }

  // Inizializza il gestore delle mappature
  init() {
    this.setupEventListeners();
    this.initializeSensorAutocomplete();
    this.buildAlarmStateChecks();
  }

  buildAlarmStateChecks() {
    const container = document.getElementById("mapping-alarm-states");
    if (!container || container.childElementCount > 0) return;
    ALARM_STATES.forEach((s) => {
      const label = document.createElement("label");
      label.className = "state-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = s.value;
      input.checked = true;
      const span = document.createElement("span");
      span.textContent = s.label;
      label.appendChild(input);
      label.appendChild(span);
      container.appendChild(label);
    });
  }

  getSelectedAlarmStates() {
    const states = [];
    document.querySelectorAll("#mapping-alarm-states input[type='checkbox']").forEach((input) => {
      if (input.checked) states.push(input.value);
    });
    return states;
  }

  setAlarmStateChecks(visibleStates) {
    const selected = Array.isArray(visibleStates) && visibleStates.length > 0
      ? visibleStates
      : ALARM_STATES.map((s) => s.value);
    document.querySelectorAll("#mapping-alarm-states input[type='checkbox']").forEach((input) => {
      input.checked = selected.includes(input.value);
    });
  }

  // Imposta gli event listener
  setupEventListeners() {
    const addMappingBtn = document.getElementById("add-mapping-btn");
    const closeModalBtn = document.getElementById("close-modal");
    const saveMappingBtn = document.getElementById("save-mapping-btn");
    const cancelMappingBtn = document.getElementById("cancel-mapping-btn");

    if (addMappingBtn) {
      addMappingBtn.addEventListener("click", () => {
        this.openMappingModal();
      });
    }

    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", () => {
        this.closeMappingModal();
      });
    }

    if (cancelMappingBtn) {
      cancelMappingBtn.addEventListener("click", () => {
        this.closeMappingModal();
      });
    }

    if (saveMappingBtn) {
      saveMappingBtn.addEventListener("click", async () => {
        await this.saveSensorMapping();
      });
    }

    // Event listener per il cambio delle dimensioni di mappatura
    const mappingSizeSelect = document.getElementById("mapping-size");
    if (mappingSizeSelect) {
      mappingSizeSelect.addEventListener("change", () => {
        this.toggleCustomSizeFields("mapping-size", "mapping-custom-size-container");
      });
    }
  }

  // Funzione per mostrare/nascondere i campi personalizzati
  toggleCustomSizeFields(selectId, containerId) {
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

  // Inizializza l'autocomplete per i sensori
  initializeSensorAutocomplete() {
    if (!this.sensorSelect) return;

    console.log("Inizializzazione autocomplete sensori");
    console.log("Sensori disponibili:", this.homeAssistantDevices.sensors);

    // Convert select to autocomplete if not already done
    if (!this.sensorSelect.dataset.autocomplete) {
      this.sensorSelect.dataset.autocomplete = "true";

      // Create autocomplete container
      const autocompleteContainer = document.createElement("div");
      autocompleteContainer.className = "autocomplete-container";
      autocompleteContainer.style.position = "relative";

      // Create input field
      const input = document.createElement("input");
      input.type = "text";
      input.id = "sensor-input";
      input.placeholder = "Cerca sensore per nome...";
      input.className = "sensor-search-input";

      const dropdown = document.createElement("div");
      dropdown.id = "sensor-dropdown";
      dropdown.style.display = "none";

      // Replace select with autocomplete
      this.sensorSelect.parentNode.insertBefore(autocompleteContainer, this.sensorSelect);
      autocompleteContainer.appendChild(input);
      autocompleteContainer.appendChild(dropdown);
      this.sensorSelect.style.display = "none";

      this.sensorInput = input;
      this.sensorDropdown = dropdown;

      let selectedSensorId = "";

      // Input event handlers
      const self = this; // Salva il riferimento a this
      input.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        dropdown.innerHTML = "";

        console.log("Input event - Query:", query);
        console.log("Input event - Sensori disponibili:", self.homeAssistantDevices.sensors);

        if (query.length < 2) {
          dropdown.style.display = "none";
          return;
        }

        const filteredSensors = self.homeAssistantDevices.sensors.filter((sensor) => {
          const name = (sensor.attributes.friendly_name || sensor.entity_id).toLowerCase();
          return name.includes(query) || sensor.entity_id.toLowerCase().includes(query);
        });

        console.log("Input event - Sensori filtrati:", filteredSensors);

        if (filteredSensors.length === 0) {
          dropdown.style.display = "none";
          return;
        }

        filteredSensors.forEach((sensor) => {
          const item = document.createElement("div");
          item.className = "sensor-dropdown-item";

          const displayName = sensor.attributes.friendly_name || sensor.entity_id;
          item.innerHTML = `
            <div class="sensor-dropdown-name">${displayName}</div>
            <div class="sensor-dropdown-id">${sensor.entity_id}</div>
          `;

          item.addEventListener("click", () => {
            input.value = displayName;
            selectedSensorId = sensor.entity_id;
            self.sensorSelect.value = sensor.entity_id;
            dropdown.style.display = "none";
          });

          item.addEventListener("mouseenter", () => {
            item.classList.add("hovered");
          });

          item.addEventListener("mouseleave", () => {
            item.classList.remove("hovered");
          });

          dropdown.appendChild(item);
        });

        dropdown.style.display = "block";
      });

      // Close dropdown when clicking outside (un solo listener anche dopo una reinizializzazione)
      if (this.outsideClickHandler) {
        document.removeEventListener("click", this.outsideClickHandler);
      }
      this.outsideClickHandler = (e) => {
        if (!autocompleteContainer.contains(e.target)) {
          dropdown.style.display = "none";
        }
      };
      document.addEventListener("click", this.outsideClickHandler);
    }
  }

  // Aggiorna il riferimento alle impostazioni (dopo salvataggio, import o reset)
  setAppSettings(appSettings) {
    this.appSettings = appSettings;
    this.updateSensorMappingsList();
  }

  // Aggiorna i dispositivi Home Assistant
  updateHomeAssistantDevices(homeAssistantDevices) {
    this.homeAssistantDevices = homeAssistantDevices;
    console.log("Dispositivi Home Assistant aggiornati nel MappingManager:", homeAssistantDevices);

    // Migrazione automatica: aggiorna le mappature esistenti da camera_proxy a camera_proxy_stream
    this.migrateLegacyCameraUrls();

    // Reinizializza l'autocomplete se già esiste
    if (this.sensorInput && this.sensorDropdown) {
      console.log("Reinizializzazione autocomplete con nuovi dispositivi");
      // Resetta l'autocomplete per forzare la reinizializzazione
      this.sensorSelect.dataset.autocomplete = "";
      this.sensorSelect.style.display = "block";

      // Rimuovi l'input e il dropdown esistenti
      if (this.sensorInput.parentNode) {
        this.sensorInput.parentNode.remove();
      }

      this.sensorInput = null;
      this.sensorDropdown = null;

      // Reinizializza l'autocomplete
      this.initializeSensorAutocomplete();
    }

    // Aggiorna la lista per riflettere i nomi risolti dei dispositivi
    this.updateSensorMappingsList();
  }

  // Migra gli URL legacy da camera_proxy a camera_proxy_stream
  migrateLegacyCameraUrls() {
    if (!this.appSettings.sensorCameraMappings) return;

    let migratedCount = 0;
    this.appSettings.sensorCameraMappings.forEach((mapping) => {
      if (mapping.cameraUrl && mapping.cameraUrl.includes('/api/camera_proxy/')) {
        // Sostituisci camera_proxy con camera_proxy_stream
        const oldUrl = mapping.cameraUrl;
        mapping.cameraUrl = mapping.cameraUrl.replace('/api/camera_proxy/', '/api/camera_proxy_stream/');
        console.log(`Migrato URL camera: ${oldUrl} -> ${mapping.cameraUrl}`);
        migratedCount++;
      }
    });

    if (migratedCount > 0) {
      console.log(`Migrate ${migratedCount} URL camera da camera_proxy a camera_proxy_stream`);
      // Salva automaticamente le impostazioni migrate
      const { ipcRenderer } = require("electron");
      ipcRenderer.invoke("save-settings", this.appSettings).then(() => {
        console.log("Impostazioni migrate salvate con successo");
      }).catch((error) => {
        console.error("Errore nel salvare le impostazioni migrate:", error);
      });
    }
  }

  // Apre il modale per le mappature
  openMappingModal(mappingId = null) {
    console.log("Apertura modale mappatura. Sensori disponibili:", this.homeAssistantDevices.sensors);
    this.editingMappingId = mappingId;

    if (mappingId) {
      // Modalità modifica
      const mapping = this.appSettings.sensorCameraMappings.find((m) => m.id === mappingId);
      if (mapping) {
        this.loadMappingIntoModal(mapping);
        document.querySelector("#mapping-modal .modal-header h3").textContent = "Modifica mappatura";
      }
    } else {
      // Modalità aggiunta
      this.resetModalForm();
      document.querySelector("#mapping-modal .modal-header h3").textContent = "Aggiungi mappatura";
    }

    this.modal.classList.add("show");

    // Reset autocomplete input if it exists
    if (this.sensorInput) {
      if (!mappingId) {
        this.sensorInput.value = "";
      }
      if (this.sensorDropdown) {
        this.sensorDropdown.style.display = "none";
      }
    }

    // Assicurati che l'autocomplete sia inizializzato con i dati corretti
    if (!this.sensorInput && this.homeAssistantDevices.sensors.length > 0) {
      console.log("Reinizializzo autocomplete perché mancante");
      this.initializeSensorAutocomplete();
    }
  }

  // Chiude il modale delle mappature
  closeMappingModal() {
    this.modal.classList.remove("show");
    this.editingMappingId = null;
    this.resetModalForm();

    // Reset autocomplete input if it exists
    if (this.sensorInput) {
      this.sensorInput.value = "";
      if (this.sensorDropdown) {
        this.sensorDropdown.style.display = "none";
      }
    }

    // Ripristina il titolo del modale
    document.querySelector("#mapping-modal .modal-header h3").textContent = "Aggiungi mappatura";
  }

  // Carica i dati della mappatura nel modale
  loadMappingIntoModal(mapping) {
    // Carica i dati della mappatura nel modale
    this.sensorSelect.value = mapping.sensorId;

    // Carica il nome del sensore nell'autocomplete se esiste
    if (this.sensorInput) {
      const sensor = this.homeAssistantDevices.sensors.find((s) => s.entity_id === mapping.sensorId);
      if (sensor) {
        this.sensorInput.value = sensor.attributes.friendly_name || sensor.entity_id;
      }
    }

    this.cameraSelect.value = mapping.cameraId || "";
    document.getElementById("mapping-duration").value = mapping.duration || "";
    document.getElementById("mapping-stream-type").value = mapping.streamType || "auto";
    
    // Gestisci le dimensioni personalizzate
    const sizeSelect = document.getElementById("mapping-size");
    const customSizeContainer = document.getElementById("mapping-custom-size-container");
    
    const cameraSettings = mapping.cameraSettings || {};
    if (cameraSettings.width && cameraSettings.height) {
      // Se ci sono dimensioni personalizzate, seleziona "custom" e mostra i campi
      sizeSelect.value = "custom";
      customSizeContainer.style.display = "block";
      document.getElementById("mapping-custom-width").value = cameraSettings.width;
      document.getElementById("mapping-custom-height").value = cameraSettings.height;
    } else {
      // Altrimenti usa la dimensione scelta ("" = predefinita delle impostazioni)
      sizeSelect.value = cameraSettings.size || "";
      customSizeContainer.style.display = "none";
    }

    this.setAlarmStateChecks(mapping.visibleStates);
  }

  // Resetta il form del modale
  resetModalForm() {
    this.sensorSelect.value = "";
    this.cameraSelect.value = "";
    document.getElementById("mapping-duration").value = "";
    document.getElementById("mapping-size").value = "";
    document.getElementById("mapping-custom-size-container").style.display = "none";
    document.getElementById("mapping-stream-type").value = "auto";
    this.setAlarmStateChecks(null);
  }

  // Salva la mappatura sensore-telecamera
  async saveSensorMapping() {
    const cameraId = this.cameraSelect.value;
    const durationValue = document.getElementById("mapping-duration").value;
    // Vuoto = durata predefinita delle impostazioni
    const duration = durationValue === "" ? null : parseInt(durationValue, 10);
    const sizeSelect = document.getElementById("mapping-size").value;

    let sensorId = this.sensorSelect.value;

    // If using autocomplete, get the selected sensor ID
    if (!sensorId && this.sensorInput) {
      const selectedText = this.sensorInput.value.toLowerCase();
      const matchedSensor = this.homeAssistantDevices.sensors.find((sensor) => {
        const name = (sensor.attributes.friendly_name || sensor.entity_id).toLowerCase();
        return name === selectedText || sensor.entity_id.toLowerCase() === selectedText;
      });
      if (matchedSensor) {
        sensorId = matchedSensor.entity_id;
      }
    }

    if (!sensorId) {
      this.showNotification("Seleziona un sensore", "error");
      return;
    }

    // È necessario selezionare una telecamera
    if (!cameraId) {
      this.showNotification("Seleziona una telecamera", "error");
      return;
    }

    if (duration !== null && (Number.isNaN(duration) || duration < 1 || duration > 60)) {
      this.showNotification("La durata deve essere tra 1 e 60 secondi", "error");
      return;
    }

    const cameraSettings = sizeSelect ? { size: sizeSelect } : {};

    // Se è selezionata la dimensione personalizzata, aggiungi width e height
    if (sizeSelect === "custom") {
      const customWidth = parseInt(document.getElementById("mapping-custom-width")?.value || 320);
      const customHeight = parseInt(document.getElementById("mapping-custom-height")?.value || 240);
      
      // Valida le dimensioni personalizzate
      if (customWidth < 100 || customWidth > 1920 || customHeight < 100 || customHeight > 1080) {
        this.showNotification("Dimensioni personalizzate non valide. Larghezza: 100-1920px, Altezza: 100-1080px", "error");
        return;
      }
      
      cameraSettings.width = customWidth;
      cameraSettings.height = customHeight;
    }

    const mapping = {
      id: this.editingMappingId || Date.now().toString(),
      sensorId,
      cameraId,
      streamType: document.getElementById("mapping-stream-type")?.value || "auto",
      duration,
      cameraSettings,
      visibleStates: this.getSelectedAlarmStates(),
    };

    console.log("Salvataggio mappatura:", mapping);

    if (this.editingMappingId) {
      // Modalità modifica: aggiorna la mappatura esistente
      const existingIndex = this.appSettings.sensorCameraMappings.findIndex((m) => m.id === this.editingMappingId);
      if (existingIndex >= 0) {
        this.appSettings.sensorCameraMappings[existingIndex] = mapping;
        console.log("Mappatura modificata con successo");
      }
    } else {
      // Modalità aggiunta: controlla se il sensore è già mappato
      const existingIndex = this.appSettings.sensorCameraMappings.findIndex((m) => m.sensorId === sensorId);
      if (existingIndex >= 0) {
        this.appSettings.sensorCameraMappings[existingIndex] = mapping;
        console.log("Mappatura esistente aggiornata");
      } else {
        this.appSettings.sensorCameraMappings.push(mapping);
        console.log("Nuova mappatura aggiunta");
      }
    }

    // Save settings
    try {
      const { ipcRenderer } = require("electron");
      await ipcRenderer.invoke("save-settings", this.appSettings);

      // Update UI
      this.updateSensorMappingsList();
      this.closeMappingModal();

      const message = this.editingMappingId ? "Mappatura modificata con successo" : "Mappatura salvata con successo";
      this.showNotification(message, "success");
    } catch (error) {
      this.showNotification("Errore nel salvataggio della mappatura: " + error.message, "error");
    }
  }

  // Aggiorna la lista delle mappature sensori
  updateSensorMappingsList() {
    if (!this.sensorList) return;

    if (!this.appSettings.sensorCameraMappings || this.appSettings.sensorCameraMappings.length === 0) {
      this.sensorList.innerHTML = '<p class="empty-state">Nessuna mappatura: aggiungine una per vedere la telecamera quando un sensore si attiva</p>';
      return;
    }

    this.sensorList.innerHTML = "";

    const pipSettings = this.appSettings.pipSettings || {};
    const fragment = document.createDocumentFragment();

    this.appSettings.sensorCameraMappings.forEach((mapping) => {
      const mappingElement = document.createElement("div");
      mappingElement.className = "sensor-mapping";

      const cameraSettings = mapping.cameraSettings || {};
      const sensorName = this.getSensorName(mapping.sensorId);
      const cameraName = this.getCameraName(mapping.cameraId) || mapping.cameraId || "Telecamera";
      const streamTypeLabels = { auto: "Auto", hls: "HLS", mjpeg: "MJPEG" };
      const streamTypeLabel = streamTypeLabels[mapping.streamType] || "Auto";
      const durationLabel = mapping.duration ? `${mapping.duration}s` : `predefinita (${pipSettings.defaultDuration || 10}s)`;
      let sizeLabel;
      if (cameraSettings.width && cameraSettings.height) {
        sizeLabel = `${cameraSettings.width}×${cameraSettings.height}`;
      } else if (cameraSettings.size) {
        sizeLabel = this.getSizeName(cameraSettings.size);
      } else {
        sizeLabel = `predefinita (${this.getSizeName(pipSettings.size || "medium")})`;
      }
      const statesLabel = this.getVisibleStatesLabel(mapping.visibleStates);

      mappingElement.innerHTML = `
        <div class="mapping-main">
          <h4 class="mapping-title"></h4>
          <span class="mapping-subtitle"></span>
          <div class="mapping-meta">
            <span class="meta-chip">Stream: ${streamTypeLabel}</span>
            <span class="meta-chip"></span>
            <span class="meta-chip"></span>
          </div>
          <span class="mapping-states"></span>
        </div>
        <div class="sensor-mapping-actions">
          <button class="btn-edit">Modifica</button>
          <button class="btn-remove">Rimuovi</button>
        </div>
      `;
      // I nomi arrivano da Home Assistant: inseriti come testo, non come HTML
      mappingElement.querySelector(".mapping-title").textContent = cameraName;
      mappingElement.querySelector(".mapping-subtitle").textContent = `Sensore: ${sensorName}`;
      const chips = mappingElement.querySelectorAll(".meta-chip");
      chips[1].textContent = `Durata: ${durationLabel}`;
      chips[2].textContent = `Dimensione: ${sizeLabel}`;
      mappingElement.querySelector(".mapping-states").textContent = `Visibile in: ${statesLabel}`;

      mappingElement.querySelector(".btn-edit").addEventListener("click", () => {
        this.openMappingModal(mapping.id);
      });
      mappingElement.querySelector(".btn-remove").addEventListener("click", () => {
        this.removeMapping(mapping.id, `${sensorName} → ${cameraName}`);
      });

      fragment.appendChild(mappingElement);
    });

    this.sensorList.replaceChildren(fragment);
  }

  async removeMapping(id, label) {
    if (!confirm(`Rimuovere la mappatura "${label}"?`)) return;

    this.appSettings.sensorCameraMappings = this.appSettings.sensorCameraMappings.filter((m) => m.id !== id);
    try {
      const { ipcRenderer } = require("electron");
      await ipcRenderer.invoke("save-settings", this.appSettings);
      this.updateSensorMappingsList();
      this.showNotification("Mappatura rimossa", "success");
    } catch (error) {
      this.showNotification("Errore nella rimozione della mappatura: " + error.message, "error");
    }
  }

  // Ottiene il nome del sensore
  getSensorName(sensorId) {
    const sensor = this.homeAssistantDevices.sensors.find((s) => s.entity_id === sensorId);
    return sensor ? sensor.attributes.friendly_name || sensor.entity_id : sensorId;
  }

  // Ottiene il nome della telecamera
  getCameraName(cameraId) {
    if (!cameraId) return null;

    if (cameraId.startsWith("custom_")) {
      const customCamera = (this.appSettings.customCameras || []).find(c => c.id === cameraId);
      return customCamera ? customCamera.name : cameraId;
    }

    const camera = this.homeAssistantDevices.cameras.find((c) => c.entity_id === cameraId);
    return camera ? camera.attributes.friendly_name || camera.entity_id : null;
  }

  // Ottiene il nome della dimensione
  getSizeName(size) {
    const sizes = {
      small: "Piccola",
      medium: "Media",
      large: "Grande",
      square: "Quadrata",
      horizontal: "Orizzontale",
      vertical: "Verticale",
      custom: "Personalizzata",
    };
    return sizes[size] || size;
  }

  // Ottiene l'etichetta degli stati in cui la camera e' visibile
  getVisibleStatesLabel(visibleStates) {
    if (!Array.isArray(visibleStates) || visibleStates.length === 0) {
      return "Tutti gli stati";
    }
    const labels = ALARM_STATES.filter((s) => visibleStates.includes(s.value)).map((s) => s.label);
    return labels.length > 0 ? labels.join(", ") : "Tutti gli stati";
  }

  showNotification(message, type = "info") {
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
}

module.exports = MappingManager;
