const fs = require("fs");
const path = require("path");
const { defaultSettings } = require("../../config/default-settings");
const { encryptToken, decryptToken, isTokenEncrypted, isEncryptionAvailable } = require("../main/token-encryption");

// Unisce le impostazioni con i valori predefiniti, anche nei sotto-oggetti
// (es. pipSettings.margins), così le chiavi aggiunte in nuove versioni esistono sempre
function mergeWithDefaults(settings) {
  const merged = structuredClone(defaultSettings);
  for (const [key, value] of Object.entries(settings || {})) {
    const defaultValue = merged[key];
    const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
    merged[key] = isPlainObject(defaultValue) && isPlainObject(value)
      ? { ...defaultValue, ...value }
      : value;
  }
  return merged;
}

class SettingsManager {
  constructor(app) {
    this.app = app;
    this.settingsPath = null;
    this.currentSettings = structuredClone(defaultSettings);
    this.saveQueue = Promise.resolve();
    this.encryptedTokenCache = { plain: null, encrypted: null };
  }

  // Inizializza il percorso delle impostazioni
  initializeSettingsPath() {
    this.settingsPath = path.join(this.app.getPath("userData"), "settings.json");
  }

  // Carica le impostazioni dal file o usa quelle predefinite
  async loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = await fs.promises.readFile(this.settingsPath, "utf8");
        const settings = JSON.parse(data);
        console.log("Impostazioni caricate da:", this.settingsPath);
        this.currentSettings = mergeWithDefaults(settings);

        // Il token resta in chiaro solo in memoria: decifra quanto letto da disco
        const storedToken = this.currentSettings.homeAssistantToken;
        const { token, shouldReEncrypt } = await decryptToken(storedToken);
        this.currentSettings.homeAssistantToken = token;
        if (isTokenEncrypted(storedToken) && !shouldReEncrypt) {
          this.encryptedTokenCache = { plain: token, encrypted: storedToken };
        }

        // Migrazione: cifra su disco un token salvato in chiaro da una versione precedente
        const needsMigration = storedToken && !isTokenEncrypted(storedToken) && (await isEncryptionAvailable());
        if (needsMigration || shouldReEncrypt) {
          await this.saveSettingsToFile();
        }
        return this.currentSettings;
      }
    } catch (error) {
      console.error("Errore nel caricamento delle impostazioni:", error);
    }

    console.log("Utilizzo impostazioni predefinite");
    this.currentSettings = structuredClone(defaultSettings);
    return this.currentSettings;
  }

  async getEncryptedToken(token) {
    if (token && token === this.encryptedTokenCache.plain) {
      return this.encryptedTokenCache.encrypted;
    }
    const encrypted = await encryptToken(token);
    if (isTokenEncrypted(encrypted)) {
      this.encryptedTokenCache = { plain: token, encrypted };
    }
    return encrypted;
  }

  // Salva le impostazioni su file (il token viene cifrato prima della scrittura).
  // Le scritture sono serializzate e atomiche: un crash non lascia un file corrotto.
  saveSettingsToFile(settings = null) {
    const snapshot = { ...(settings || this.currentSettings) };
    const run = async () => {
      try {
        snapshot.homeAssistantToken = await this.getEncryptedToken(snapshot.homeAssistantToken);
        const tmpPath = `${this.settingsPath}.tmp`;
        await fs.promises.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf8");
        await fs.promises.rename(tmpPath, this.settingsPath);
        console.log("Impostazioni salvate in:", this.settingsPath);
        return true;
      } catch (error) {
        console.error("Errore nel salvataggio delle impostazioni:", error);
        return false;
      }
    };
    const result = this.saveQueue.then(run, run);
    this.saveQueue = result;
    return result;
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
    this.currentSettings = structuredClone(defaultSettings);
    return this.currentSettings;
  }

  // Esporta le impostazioni in un file specificato
  async exportSettings(filePath, { includeSecrets = false } = {}) {
    try {
      const exported = structuredClone(this.currentSettings);
      if (!includeSecrets) {
        exported.homeAssistantToken = "";
        if (exported.alarmSettings) exported.alarmSettings.pin = "";
      }
      await fs.promises.writeFile(filePath, JSON.stringify(exported, null, 2), "utf8");
      return { success: true, path: filePath };
    } catch (error) {
      console.error("Errore nell'esportazione delle impostazioni:", error);
      return { success: false, error: error.message };
    }
  }

  // Importa le impostazioni da un file specificato
  async importSettings(filePath) {
    try {
      const data = await fs.promises.readFile(filePath, "utf8");
      const importedSettings = JSON.parse(data);

      // Unisci con le impostazioni predefinite per garantire compatibilità
      const newSettings = mergeWithDefaults(importedSettings);
      // Il token importato può essere in chiaro (esportazione) o cifrato: normalizza in chiaro in memoria
      newSettings.homeAssistantToken = (await decryptToken(newSettings.homeAssistantToken)).token;
      // Un file esportato senza dati sensibili non deve cancellare token e PIN attuali
      if (!newSettings.homeAssistantToken) {
        newSettings.homeAssistantToken = this.currentSettings.homeAssistantToken;
      }
      if (newSettings.alarmSettings && !newSettings.alarmSettings.pin) {
        newSettings.alarmSettings.pin = this.currentSettings.alarmSettings?.pin || "";
      }
      this.currentSettings = newSettings;

      // Salva le nuove impostazioni (il token viene cifrato su disco)
      const saved = await this.saveSettingsToFile();
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
