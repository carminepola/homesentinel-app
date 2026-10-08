const { safeStorage } = require("electron");

const ENCRYPTED_PREFIX = "enc:v1:";

function isEncryptionAvailable() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch (error) {
    return false;
  }
}

// Cifra il token per la persistenza su disco.
// Ritorna il token invariato se gia' cifrato o se la cifratura non e' disponibile.
function encryptToken(token) {
  if (!token || typeof token !== "string") return token;
  if (token.startsWith(ENCRYPTED_PREFIX)) return token;
  if (!isEncryptionAvailable()) return token;
  try {
    return ENCRYPTED_PREFIX + safeStorage.encryptString(token).toString("base64");
  } catch (error) {
    console.error("Errore nella cifratura del token:", error.message);
    return token;
  }
}

// Decifra il token letto da disco.
// I token in chiaro (legacy) tornano invariati; in caso di errore ritorna stringa vuota.
function decryptToken(token) {
  if (!token || typeof token !== "string") return token;
  if (!token.startsWith(ENCRYPTED_PREFIX)) return token;
  if (!isEncryptionAvailable()) {
    console.error("Impossibile decifrare il token: cifratura non disponibile su questo sistema");
    return "";
  }
  try {
    return safeStorage.decryptString(Buffer.from(token.slice(ENCRYPTED_PREFIX.length), "base64"));
  } catch (error) {
    console.error("Errore nella decifratura del token:", error.message);
    return "";
  }
}

function isTokenEncrypted(token) {
  return typeof token === "string" && token.startsWith(ENCRYPTED_PREFIX);
}

module.exports = { encryptToken, decryptToken, isTokenEncrypted, isEncryptionAvailable, ENCRYPTED_PREFIX };
