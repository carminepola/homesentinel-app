const { safeStorage } = require("electron");

const ENCRYPTED_PREFIX = "enc:v1:";

async function isEncryptionAvailable() {
  try {
    return !!safeStorage && (await safeStorage.isAsyncEncryptionAvailable());
  } catch (error) {
    return false;
  }
}

// Cifra il token per la persistenza su disco.
// Ritorna il token invariato se gia' cifrato o se la cifratura non e' disponibile.
async function encryptToken(token) {
  if (!token || typeof token !== "string") return token;
  if (token.startsWith(ENCRYPTED_PREFIX)) return token;
  if (!(await isEncryptionAvailable())) return token;
  try {
    const encrypted = await safeStorage.encryptStringAsync(token);
    return ENCRYPTED_PREFIX + encrypted.toString("base64");
  } catch (error) {
    console.error("Errore nella cifratura del token:", error.message);
    return token;
  }
}

// Decifra il token letto da disco.
// I token in chiaro (legacy) tornano invariati; in caso di errore ritorna stringa vuota.
// shouldReEncrypt indica che la chiave e' stata ruotata e il token va salvato di nuovo.
async function decryptToken(token) {
  if (!token || typeof token !== "string") return { token, shouldReEncrypt: false };
  if (!token.startsWith(ENCRYPTED_PREFIX)) return { token, shouldReEncrypt: false };
  if (!(await isEncryptionAvailable())) {
    console.error("Impossibile decifrare il token: cifratura non disponibile su questo sistema");
    return { token: "", shouldReEncrypt: false };
  }
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
      Buffer.from(token.slice(ENCRYPTED_PREFIX.length), "base64")
    );
    return { token: result, shouldReEncrypt: !!shouldReEncrypt };
  } catch (error) {
    console.error("Errore nella decifratura del token:", error.message);
    return { token: "", shouldReEncrypt: false };
  }
}

function isTokenEncrypted(token) {
  return typeof token === "string" && token.startsWith(ENCRYPTED_PREFIX);
}

module.exports = { encryptToken, decryptToken, isTokenEncrypted, isEncryptionAvailable, ENCRYPTED_PREFIX };
