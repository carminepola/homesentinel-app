const WebSocket = require("ws");
const appConfig = require("../shared/app-config");

const ACTIVE_INTERCOM_STATES = ["on", "true", "1"];
const OPEN_LOCK_STATES = ["unlocked", "open", "on"];

class WebSocketManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.wsConnection = null;
    this.isAuthenticated = false;
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
    this.lastCloseReason = null;
    this.heartbeatInterval = null;
    this.sensorStates = new Map();
    this.subscriptionIds = new Map();
    this.pendingRequests = new Map();
    this.subscriptionCounter = 1;

    this.onSensorEvent = null;
    this.onConnectionStatusChange = null;
    this.onAlarmEvent = null;
    this.onAlarmStateChange = null;
    this.onIntercomEvent = null;
    this.onGateLockOpened = null;
  }

  setEventCallbacks(callbacks) {
    this.onSensorEvent = callbacks.onSensorEvent;
    this.onConnectionStatusChange = callbacks.onConnectionStatusChange;
    this.onAlarmEvent = callbacks.onAlarmEvent || null;
    this.onAlarmStateChange = callbacks.onAlarmStateChange || null;
    this.onIntercomEvent = callbacks.onIntercomEvent || null;
    this.onGateLockOpened = callbacks.onGateLockOpened || null;
  }

  // URL base di Home Assistant senza slash finale
  getBaseUrl(url = null) {
    const source = url || this.settingsManager.getSettings().homeAssistantUrl || "";
    return source.trim().replace(/\/+$/, "");
  }

  isConnected() {
    return !!(this.isAuthenticated && this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN);
  }

  connectToHomeAssistant() {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      console.log("Home Assistant non configurato");
      return;
    }

    if (this.wsConnection &&
        (this.wsConnection.readyState === WebSocket.OPEN || this.wsConnection.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.clearReconnectTimeout();
    this.disposeSocket();

    const wsUrl = this.getBaseUrl().replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/api/websocket";

    let ws;
    try {
      ws = new WebSocket(wsUrl, {
        handshakeTimeout: appConfig.websocket.handshakeTimeout,
        perMessageDeflate: false,
      });
    } catch (error) {
      console.error("Errore di connessione:", error.message);
      this.scheduleReconnect();
      return;
    }

    this.wsConnection = ws;
    this.isAuthenticated = false;

    // Gli handler ignorano gli eventi di socket non più correnti (es. dopo un force reconnect)
    ws.on("open", () => {
      if (ws !== this.wsConnection) return;
      console.log(`[${new Date().toISOString()}] WS open: invio auth`);
      ws.send(JSON.stringify({
        type: "auth",
        access_token: this.settingsManager.getSettings().homeAssistantToken,
      }));
    });

    ws.on("message", (data) => {
      if (ws !== this.wsConnection) return;
      this.handleMessage(data);
    });

    ws.on("close", (code) => {
      if (ws !== this.wsConnection) return;
      console.log(`[${new Date().toISOString()}] WS close: code=${code}`);
      this.handleConnectionClose();
    });

    ws.on("error", (error) => {
      console.error(`[${new Date().toISOString()}] WS error: ${error.message}`);
    });
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.error("Errore nel parsing del messaggio:", error);
      return;
    }

    // Home Assistant può raggruppare più messaggi in un array (coalesce_messages)
    const messages = Array.isArray(message) ? message : [message];
    for (const msg of messages) {
      try {
        this.dispatchMessage(msg);
      } catch (error) {
        console.error("Errore nella gestione del messaggio:", error);
      }
    }
  }

  dispatchMessage(message) {
    switch (message.type) {
      case "auth_required":
        break;
      case "auth_ok":
        this.handleAuthOk();
        break;
      case "auth_invalid":
        console.error("Autenticazione fallita: token non valido");
        this.lastCloseReason = "auth_invalid";
        this.wsConnection.close();
        break;
      case "event":
        this.handleSensorEvent(message);
        break;
      case "result":
      case "pong":
        this.resolvePendingRequest(message);
        break;
    }
  }

  handleAuthOk() {
    this.isAuthenticated = true;
    this.reconnectAttempts = 0;
    this.lastCloseReason = null;
    this.startHeartbeat();

    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange(true);
    }

    this.subscribeToStateChanges();
    this.fetchInitialAlarmState();
  }

  // Invia una richiesta e attende il messaggio di risposta con lo stesso id
  sendRequest(payload, timeoutMs = appConfig.websocket.requestTimeout) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error("WebSocket non connesso"));
        return;
      }

      const id = this.getNextSubscriptionId();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("timeout"));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.wsConnection.send(JSON.stringify({ ...payload, id }));
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  resolvePendingRequest(message) {
    if (message.type === "result" && this.subscriptionIds.has(message.id) && !message.success) {
      console.error("Sottoscrizione rifiutata:", message.error?.message);
      this.subscriptionIds.delete(message.id);
    }

    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(message.id);
    pending.resolve(message);
  }

  rejectAllPendingRequests(reason) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  needsStateSubscription() {
    const settings = this.settingsManager.getSettings();
    const hasMappings = settings.sensorCameraMappings && settings.sensorCameraMappings.length > 0;
    const alarmEnabled = settings.alarmSettings?.enabled && settings.alarmSettings?.sensorId;
    const hasGate = !!(settings.gateSettings?.intercomSensorId || settings.gateSettings?.gateLockId);
    return !!(hasMappings || alarmEnabled || hasGate);
  }

  getStateSubscriptionId() {
    for (const [id, type] of this.subscriptionIds.entries()) {
      if (type === "state_changed") return id;
    }
    return null;
  }

  subscribeToStateChanges() {
    if (!this.isConnected() || !this.needsStateSubscription() || this.getStateSubscriptionId() !== null) {
      return;
    }

    const subscriptionId = this.getNextSubscriptionId();
    this.subscriptionIds.set(subscriptionId, "state_changed");
    this.wsConnection.send(JSON.stringify({
      id: subscriptionId,
      type: "subscribe_events",
      event_type: "state_changed",
    }));
  }

  handleSensorEvent(message) {
    const { event } = message;
    if (!event || event.event_type !== "state_changed" || !event.data) {
      return;
    }

    const { entity_id, old_state, new_state } = event.data;
    if (!entity_id) {
      return;
    }

    const settings = this.settingsManager.getSettings();
    const mapping = settings.sensorCameraMappings?.find((m) => m.sensorId === entity_id);
    const alarmSettings = settings.alarmSettings || {};
    const gateSettings = settings.gateSettings || {};
    const isAlarmEntity = alarmSettings.enabled && alarmSettings.sensorId === entity_id;
    const isIntercom = gateSettings.intercomSensorId && entity_id === gateSettings.intercomSensorId;
    const isGateLock = gateSettings.gateLockId && entity_id === gateSettings.gateLockId;

    // La sottoscrizione riceve tutte le entità: scarta subito quelle non rilevanti
    if (!mapping && !isAlarmEntity && !isIntercom && !isGateLock) {
      return;
    }

    const sensorState = new_state?.state || "unknown";
    const previousState = old_state?.state || "unknown";
    const friendlyName = new_state?.attributes?.friendly_name || old_state?.attributes?.friendly_name || entity_id;
    this.sensorStates.set(entity_id, sensorState);

    if (isAlarmEntity) {
      const alarmData = { entity_id, sensorState, previousState, sensorName: friendlyName };

      if (this.onAlarmStateChange) {
        this.onAlarmStateChange(alarmData);
      }

      if (sensorState.toLowerCase() === "triggered") {
        if (this.onAlarmEvent) this.onAlarmEvent(alarmData);
      } else if (this.onAlarmEvent && previousState.toLowerCase() === "triggered") {
        this.onAlarmEvent({ ...alarmData, dismissed: true });
      }
    }

    // Rilevamento citofono: notifica quando il sensore associato passa a "on"
    if (isIntercom) {
      const isOn = ACTIVE_INTERCOM_STATES.includes(sensorState.toLowerCase());
      const wasOn = ACTIVE_INTERCOM_STATES.includes(previousState.toLowerCase());
      if (isOn && !wasOn && this.onIntercomEvent) {
        this.onIntercomEvent({ entity_id, sensorState, friendlyName });
      }
    }

    // Rilevamento apertura cancello: il lucchetto passa a "unlocked"
    if (isGateLock) {
      const isOpen = OPEN_LOCK_STATES.includes(sensorState.toLowerCase());
      const wasOpen = OPEN_LOCK_STATES.includes(previousState.toLowerCase());
      if (isOpen && !wasOpen && this.onGateLockOpened) {
        this.onGateLockOpened({ entity_id, sensorState, previousState, friendlyName });
      }
    }

    if (mapping && this.onSensorEvent) {
      this.onSensorEvent({
        entity_id,
        sensorState,
        previousState,
        friendlyName,
        mapping,
      });
    }
  }

  handleConnectionClose() {
    const wasAuthenticated = this.isAuthenticated;
    this.isAuthenticated = false;
    this.subscriptionIds.clear();
    this.stopHeartbeat();
    this.rejectAllPendingRequests("WebSocket chiusa");
    this.wsConnection = null;

    if (wasAuthenticated && this.onConnectionStatusChange) {
      this.onConnectionStatusChange(false);
    }

    this.scheduleReconnect();
  }

  // Backoff esponenziale con jitter: evita di martellare Home Assistant quando è giù
  getReconnectDelay() {
    const { reconnectDelay, maxReconnectDelay, authFailedReconnectDelay } = appConfig.websocket;
    if (this.lastCloseReason === "auth_invalid") {
      return authFailedReconnectDelay;
    }
    const exponential = Math.min(maxReconnectDelay, reconnectDelay * Math.pow(2, this.reconnectAttempts));
    const jitter = Math.random() * 0.3 * exponential;
    return Math.round(exponential + jitter);
  }

  scheduleReconnect() {
    this.clearReconnectTimeout();

    const delay = this.getReconnectDelay();
    this.reconnectAttempts++;
    console.log(`WS: nuovo tentativo di connessione tra ${Math.round(delay / 1000)}s (tentativo ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectToHomeAssistant();
    }, delay);
  }

  forceReconnect() {
    const wasAuthenticated = this.isAuthenticated;
    this.clearReconnectTimeout();
    this.disposeSocket();
    this.reconnectAttempts = 0;
    this.lastCloseReason = null;

    if (wasAuthenticated && this.onConnectionStatusChange) {
      this.onConnectionStatusChange(false);
    }

    this.connectToHomeAssistant();
  }

  // Verifica che la connessione sia ancora viva (es. dopo sospensione/sblocco):
  // se risponde al ping viene mantenuta, altrimenti viene ricreata subito
  async checkConnection() {
    if (!this.isConnected()) {
      this.forceReconnect();
      return;
    }
    try {
      await this.sendRequest({ type: "ping" }, appConfig.websocket.wakeCheckTimeout);
    } catch (error) {
      console.warn(`WS: connessione non valida dopo il risveglio (${error.message}), riconnessione`);
      this.forceReconnect();
    }
  }

  // Chiude la socket corrente senza innescare la logica di riconnessione
  disposeSocket() {
    this.stopHeartbeat();
    this.isAuthenticated = false;
    this.subscriptionIds.clear();
    this.rejectAllPendingRequests("WebSocket chiusa");

    const ws = this.wsConnection;
    this.wsConnection = null;
    if (!ws) return;

    try {
      ws.removeAllListeners();
      // Evita eccezioni non gestite da errori emessi dopo la rimozione dei listener
      ws.on("error", () => {});
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000);
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    } catch (error) {
      console.error("Errore durante la chiusura della WebSocket:", error.message);
    }
  }

  // Heartbeat applicativo: se Home Assistant non risponde al ping la connessione
  // è considerata morta (es. cambio rete, Wi-Fi caduto) e viene ricreata subito
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected()) return;
      const ws = this.wsConnection;
      this.sendRequest({ type: "ping" }, appConfig.websocket.pongTimeout).catch((error) => {
        if (ws !== this.wsConnection || error.message !== "timeout") return;
        console.warn(`[${new Date().toISOString()}] WS: pong non ricevuto, connessione considerata persa`);
        ws.terminate();
      });
    }, appConfig.websocket.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  updateSubscriptions() {
    if (!this.isConnected()) {
      return;
    }

    const needsSubscription = this.needsStateSubscription();
    const stateChangedSubscriptionId = this.getStateSubscriptionId();

    if (needsSubscription && stateChangedSubscriptionId === null) {
      this.subscribeToStateChanges();
    } else if (!needsSubscription && stateChangedSubscriptionId !== null) {
      this.subscriptionIds.delete(stateChangedSubscriptionId);
      this.sendRequest({ type: "unsubscribe_events", subscription: stateChangedSubscriptionId }).catch((error) => {
        console.warn("Errore nell'annullamento della sottoscrizione:", error.message);
      });
    }
  }

  getSensorStates() {
    return this.sensorStates;
  }

  getAlarmState() {
    const settings = this.settingsManager.getSettings();
    const sensorId = settings.alarmSettings?.sensorId;
    if (!sensorId) return null;
    return this.sensorStates.get(sensorId) || null;
  }

  async fetchState(entityId, baseUrl, token) {
    const response = await fetch(`${baseUrl}/api/states/${entityId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(appConfig.websocket.httpTimeout),
    });
    if (!response.ok) return null;
    return response.json();
  }

  async fetchInitialAlarmState() {
    const settings = this.settingsManager.getSettings();
    const sensorId = settings.alarmSettings?.sensorId;
    if (!settings.homeAssistantUrl || !settings.homeAssistantToken || !sensorId) {
      return;
    }
    try {
      const stateObj = await this.fetchState(sensorId, this.getBaseUrl(), settings.homeAssistantToken);
      if (!stateObj) return;
      const state = stateObj.state || "unknown";
      this.sensorStates.set(sensorId, state);
      if (this.onAlarmStateChange) {
        this.onAlarmStateChange({
          entity_id: sensorId,
          sensorState: state,
          previousState: state,
          sensorName: stateObj.attributes?.friendly_name || sensorId,
        });
      }
    } catch (error) {
      console.error("Errore nel recupero dello stato iniziale dell'antifurto:", error.message);
    }
  }

  async getCameraUrlWithToken(cameraId, homeAssistantUrl, homeAssistantToken, useHLS = false) {
    if (!cameraId || !homeAssistantUrl || !homeAssistantToken) {
      return null;
    }

    const baseUrl = this.getBaseUrl(homeAssistantUrl);

    // La richiesta HLS parte in parallelo alla lettura dello stato per ridurre la latenza
    const hlsPromise = useHLS
      ? this.getHlsStreamUrl(cameraId, baseUrl).catch((hlsError) => {
          console.warn(`HLS non disponibile per ${cameraId} (${hlsError.message}), fallback a MJPEG`);
          return null;
        })
      : null;

    try {
      const cameraState = await this.fetchState(cameraId, baseUrl, homeAssistantToken);
      if (!cameraState) {
        return null;
      }

      const friendlyName = cameraState.attributes?.friendly_name || cameraId;

      let mjpegUrl;
      if (cameraState.attributes?.entity_picture) {
        mjpegUrl = `${baseUrl}${cameraState.attributes.entity_picture}`;
      } else if (cameraState.attributes?.access_token) {
        mjpegUrl = `${baseUrl}/api/camera_proxy_stream/${cameraId}?token=${cameraState.attributes.access_token}`;
      } else {
        mjpegUrl = `${baseUrl}/api/camera_proxy_stream/${cameraId}?token=${homeAssistantToken}`;
      }

      if (hlsPromise) {
        const hlsUrl = await hlsPromise;
        if (hlsUrl) {
          return { url: hlsUrl, friendlyName, streamType: "hls", mjpegUrl };
        }
      }

      return { url: mjpegUrl, friendlyName, streamType: "mjpeg" };
    } catch (error) {
      console.error(`Errore nell'ottenere l'URL della camera ${cameraId}:`, error.message);
      return null;
    }
  }

  async getHlsStreamUrl(cameraId, homeAssistantUrl) {
    const message = await this.sendRequest({ type: "camera/stream", entity_id: cameraId }, appConfig.hls.timeout);
    if (message.success && message.result && message.result.url) {
      return `${this.getBaseUrl(homeAssistantUrl)}${message.result.url}`;
    }
    throw new Error(message.error?.message || "HLS non supportato");
  }

  closeConnection() {
    this.clearReconnectTimeout();
    this.disposeSocket();
    this.sensorStates.clear();
    this.reconnectAttempts = 0;
    this.lastCloseReason = null;
  }

  getNextSubscriptionId() {
    return this.subscriptionCounter++;
  }

  async callService(domain, service, serviceData = {}) {
    if (!this.isConnected()) {
      console.error("callService: WebSocket non connesso");
      return { success: false, error: "WebSocket non connesso" };
    }

    try {
      const msg = await this.sendRequest({
        type: "call_service",
        domain,
        service,
        service_data: serviceData,
      });
      if (!msg.success) {
        return { success: false, error: msg.error?.message || "errore sconosciuto", result: msg };
      }
      return { success: true, result: msg };
    } catch (error) {
      console.error(`callService ${domain}.${service} fallito: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = WebSocketManager;
