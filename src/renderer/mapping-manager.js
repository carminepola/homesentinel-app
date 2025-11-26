const appConfig = require("../shared/app-config");

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
      input.style.width = "100%";
      input.style.padding = "0.75rem";
      input.style.border = "1px solid var(--border)";
      input.style.borderRadius = "4px";
      input.style.backgroundColor = "var(--bg-primary)";
      input.style.color = "var(--text-primary)";
      input.style.fontSize = "1rem";

      // Create dropdown list
      const dropdown = document.createElement("div");
      dropdown.id = "sensor-dropdown";
      dropdown.style.position = "absolute";
      dropdown.style.top = "100%";
      dropdown.style.left = "0";
      dropdown.style.right = "0";
      dropdown.style.backgroundColor = "var(--card-bg)";
      dropdown.style.border = "1px solid var(--border)";
      dropdown.style.borderRadius = "4px";
      dropdown.style.maxHeight = "200px";
      dropdown.style.overflowY = "auto";
      dropdown.style.zIndex = "1000";
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
          item.style.padding = "0.75rem";
          item.style.cursor = "pointer";
          item.style.borderBottom = "1px solid var(--border)";

          const displayName = sensor.attributes.friendly_name || sensor.entity_id;
          item.innerHTML = `
            <div style="font-weight: 500;">${displayName}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">${sensor.entity_id}</div>
          `;

          item.addEventListener("click", () => {
            input.value = displayName;
            selectedSensorId = sensor.entity_id;
            self.sensorSelect.value = sensor.entity_id;
            dropdown.style.display = "none";
          });

          item.addEventListener("mouseenter", () => {
            item.style.backgroundColor = "var(--bg-secondary)";
          });

          item.addEventListener("mouseleave", () => {
            item.style.backgroundColor = "transparent";
          });

          dropdown.appendChild(item);
        });

        dropdown.style.display = "block";
      });

      // Close dropdown when clicking outside
      document.addEventListener("click", (e) => {
        if (!autocompleteContainer.contains(e.target)) {
          dropdown.style.display = "none";
        }
      });
    }
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
        document.querySelector("#mapping-modal .modal-header h3").textContent = "Modifica Mappatura Sensore-Telecamera";
      }
    } else {
      // Modalità aggiunta
      this.resetModalForm();
      document.querySelector("#mapping-modal .modal-header h3").textContent = "Aggiungi Mappatura Sensore-Telecamera";
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
    document.querySelector("#mapping-modal .modal-header h3").textContent = "Aggiungi Mappatura Sensore-Telecamera";
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
    document.getElementById("camera-url").value = mapping.cameraId ? "" : mapping.cameraUrl;
    document.getElementById("mapping-duration").value = mapping.duration;
    
    // Gestisci le dimensioni personalizzate
    const sizeSelect = document.getElementById("mapping-size");
    const customSizeContainer = document.getElementById("mapping-custom-size-container");
    
    if (mapping.cameraSettings.width && mapping.cameraSettings.height) {
      // Se ci sono dimensioni personalizzate, seleziona "custom" e mostra i campi
      sizeSelect.value = "custom";
      customSizeContainer.style.display = "block";
      document.getElementById("mapping-custom-width").value = mapping.cameraSettings.width;
      document.getElementById("mapping-custom-height").value = mapping.cameraSettings.height;
    } else {
      // Altrimenti usa la dimensione predefinita
      sizeSelect.value = mapping.cameraSettings.size || "medium";
      customSizeContainer.style.display = "none";
    }
  }

  // Resetta il form del modale
  resetModalForm() {
    this.sensorSelect.value = "";
    this.cameraSelect.value = "";
    document.getElementById("camera-url").value = "";
    document.getElementById("mapping-duration").value = "10";
    document.getElementById("mapping-size").value = "medium";
  }

  // Salva la mappatura sensore-telecamera
  async saveSensorMapping() {
    const cameraUrl = document.getElementById("camera-url").value;
    const cameraId = this.cameraSelect.value;
    const duration = parseInt(document.getElementById("mapping-duration").value);
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

    // Non salviamo più l'URL completo con il token, ma solo l'ID della camera
    // L'URL con il token verrà generato dinamicamente quando necessario
    if (!cameraUrl && !cameraId) {
      this.showNotification("Seleziona una telecamera o inserisci un URL", "error");
      return;
    }

    let cameraSettings = {
      size: sizeSelect,
    };

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
      cameraUrl: cameraUrl, // Salviamo solo l'URL personalizzato (senza token)
      duration,
      cameraSettings,
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
      this.sensorList.innerHTML = "<p>Nessuna mappatura configurata</p>";
      return;
    }

    this.sensorList.innerHTML = "";

    this.appSettings.sensorCameraMappings.forEach((mapping) => {
      const mappingElement = document.createElement("div");
      mappingElement.className = "sensor-mapping";

      const sensorName = this.getSensorName(mapping.sensorId);
      const cameraName = this.getCameraName(mapping.cameraId) || "URL personalizzato";

      mappingElement.innerHTML = `
        <div class="sensor-mapping-info">
          <h4>${sensorName}</h4>
          <p>Telecamera: ${cameraName} | Durata: ${mapping.duration}s | Dimensione: ${this.getSizeName(mapping.cameraSettings.size)}</p>
        </div>
        <div class="sensor-mapping-actions">
          <button class="btn-edit" data-id="${mapping.id}">Modifica</button>
          <button class="btn-remove" data-id="${mapping.id}">Rimuovi</button>
        </div>
      `;

      this.sensorList.appendChild(mappingElement);
    });

    // Add event listeners to edit buttons
    document.querySelectorAll(".btn-edit").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-id");
        this.openMappingModal(id);
      });
    });

    // Add event listeners to remove buttons
    document.querySelectorAll(".btn-remove").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-id");
        this.appSettings.sensorCameraMappings = this.appSettings.sensorCameraMappings.filter((m) => m.id !== id);

        try {
          const { ipcRenderer } = require("electron");
          await ipcRenderer.invoke("save-settings", this.appSettings);
          this.updateSensorMappingsList();
          this.showNotification("Mappatura rimossa", "success");
        } catch (error) {
          this.showNotification("Errore nella rimozione della mappatura: " + error.message, "error");
        }
      });
    });
  }

  // Ottiene il nome del sensore
  getSensorName(sensorId) {
    const sensor = this.homeAssistantDevices.sensors.find((s) => s.entity_id === sensorId);
    return sensor ? sensor.attributes.friendly_name || sensor.entity_id : sensorId;
  }

  // Ottiene il nome della telecamera
  getCameraName(cameraId) {
    if (!cameraId) return null;
    const camera = this.homeAssistantDevices.cameras.find((c) => c.entity_id === cameraId);
    return camera ? camera.attributes.friendly_name || camera.entity_id : null;
  }

  // Ottiene il nome della dimensione
  getSizeName(size) {
    const sizes = {
      small: "Piccolo",
      medium: "Medio",
      large: "Grande",
      square: "Quadrato",
      horizontal: "Orizzontale",
      vertical: "Verticale",
    };
    return sizes[size] || size;
  }

  // Mostra una notifica
  showNotification(message, type = "info") {
    // Create notification element
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.textContent = message;

    // Style the notification
    Object.assign(notification.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      padding: "12px 20px",
      borderRadius: "4px",
      color: "white",
      fontWeight: "500",
      zIndex: "9999",
      opacity: "0",
      transform: "translateY(-20px)",
      transition: "all 0.3s ease",
    });

    // Set background color based on type
    const colors = {
      success: "#4caf50",
      error: "#f44336",
      warning: "#ff9800",
      info: "#2196f3",
    };

    notification.style.backgroundColor = colors[type] || colors.info;

    // Add to DOM
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.opacity = "1";
      notification.style.transform = "translateY(0)";
    }, 10);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateY(-20px)";
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

module.exports = MappingManager;
