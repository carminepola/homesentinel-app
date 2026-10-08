const fs = require("fs");
const path = require("path");
const { defaultSettings } = require("../../config/default-settings");
const { encryptToken, decryptToken, isTokenEncrypted, isEncryptionAvailable } = require("../main/token-encryption");

class SettingsManager {
  constructor(app) {
    this.app = app;
    this.settingsPath = null;
    this.currentSettings = { ...defaultSettings };
  }

  // Inizializza il percorso delle impostazioni
  initializeSettingsPath() {
    this.settingsPath = path.join(this.app.getPath("userData"), "settings.json");
  }

  // Carica le impostazioni dal file o usa quelle predefinite
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, "utf8");
        const settings = JSON.parse(data);
        console.log("Impostazioni caricate da:", this.settingsPath);
        // Unisci con le impostazioni predefinite per garantire che tutti i campi esistano
        this.currentSettings = { ...defaultSettings, ...settings };
        // Il token resta in chiaro solo in memoria: decifra quanto letto da disco
        this.currentSettings.homeAssistantToken = decryptToken(this.currentSettings.homeAssistantToken);
        // Migrazione: cifra su disco un token salvato in chiaro da una versione precedente
        if (
          this.currentSettings.homeAssistantToken &&
          !isTokenEncrypted(this.currentSettings.homeAssistantToken) &&
          isEncryptionAvailable()
        ) {
          this.saveSettingsToFile();
        }
        return this.currentSettings;
      }
    } catch (error) {
      console.error("Errore nel caricamento delle impostazioni:", error);
    }

    console.log("Utilizzo impostazioni predefinite");
    this.currentSettings = { ...defaultSettings };
    return this.currentSettings;
  }

  // Salva le impostazioni su file (il token viene cifrato prima della scrittura)
  saveSettingsToFile(settings = null) {
    try {
      const settingsToSave = { ...(settings || this.currentSettings) };
      settingsToSave.homeAssistantToken = encryptToken(settingsToSave.homeAssistantToken);
      fs.writeFileSync(this.settingsPath, JSON.stringify(settingsToSave, null, 2), "utf8");
      console.log("Impostazioni salvate in:", this.settingsPath);
      return true;
    } catch (error) {
      console.error("Errore nel salvataggio delle impostazioni:", error);
      return false;
    }
  }

  // Aggiorna le impostazioni correnti
  updateSettings(newSettings) {
    this.currentSettings = { ...this.currentSettings, ...newSettings };
    return this.currentSettings;
  }

  // Ottiene le impostazioni correnti
  getSettings() {
    return this.currentSettings;
  }

  // Reimposta le impostazioni ai valori predefiniti
  resetSettings() {
    this.currentSettings = { ...defaultSettings };
    return this.currentSettings;
  }

  // Esporta le impostazioni in un file specificato
  async exportSettings(filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.currentSettings, null, 2), "utf8");
      return { success: true, path: filePath };
    } catch (error) {
      console.error("Errore nell'esportazione delle impostazioni:", error);
      return { success: false, error: error.message };
    }
  }

  // Importa le impostazioni da un file specificato
  async importSettings(filePath) {
    try {
      const data = fs.readFileSync(filePath, "utf8");
      const importedSettings = JSON.parse(data);

      // Unisci con le impostazioni predefinite per garantire compatibilità
      this.currentSettings = { ...defaultSettings, ...importedSettings };
      // Il token importato può essere in chiaro (esportazione) o cifrato: normalizza in chiaro in memoria
      this.currentSettings.homeAssistantToken = decryptToken(this.currentSettings.homeAssistantToken);

      // Salva le nuove impostazioni (il token viene cifrato su disco)
      const saved = this.saveSettingsToFile();
      if (!saved) {
        throw new Error("Impossibile salvare le impostazioni importate");
      }

      return { success: true, settings: this.currentSettings };
    } catch (error) {
      console.error("Errore nell'importazione delle impostazioni:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SettingsManager;
