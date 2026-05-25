const WebSocket = require("ws");
const appConfig = require("../shared/app-config");

class WebSocketManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.wsConnection = null;
    this.isReconnecting = false;
    this.reconnectTimeout = null;
    this.heartbeatInterval = null;
    this.sensorStates = new Map();
    this.subscriptionIds = new Map();
    this.subscriptionCounter = Date.now();

    this.onSensorEvent = null;
    this.onConnectionStatusChange = null;
    this.onAlarmEvent = null;
  }

  setEventCallbacks(callbacks) {
    this.onSensorEvent = callbacks.onSensorEvent;
    this.onConnectionStatusChange = callbacks.onConnectionStatusChange;
    this.onAlarmEvent = callbacks.onAlarmEvent || null;
  }

  connectToHomeAssistant() {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      console.log("Home Assistant non configurato");
      return;
    }

    if (this.isReconnecting || (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN)) {
      return;
    }

    const baseUrl = settings.homeAssistantUrl.replace(/\/$/, "");
    const wsUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/api/websocket";

    try {
      if (this.wsConnection) {
        this.wsConnection.close();
      }

      this.isReconnecting = true;
      this.wsConnection = new WebSocket(wsUrl);

      this.wsConnection.on("open", () => {
        this.isReconnecting = false;
        this.clearReconnectTimeout();
        this.wsConnection.send(JSON.stringify({
          type: "auth",
          access_token: settings.homeAssistantToken,
        }));
      });

      this.wsConnection.on("message", (data) => {
        this.handleMessage(data);
      });

      this.wsConnection.on("close", (code) => {
        this.handleConnectionClose(code);
      });

      this.wsConnection.on("error", (error) => {
        console.error("Errore WebSocket:", error);
        this.isReconnecting = false;
      });
    } catch (error) {
      console.error("Errore di connessione:", error);
      this.isReconnecting = false;
    }
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "auth_ok":
          this.subscribeToStateChanges();
          break;
        case "event":
          this.handleSensorEvent(message);
          break;
        case "auth_invalid":
          console.error("Autenticazione fallita");
          this.wsConnection.close();
          break;
        case "result":
          this.handleResultMessage(message);
          break;
        case "pong":
          // Pong received, connection is stable
          break;
      }
    } catch (error) {
      console.error("Errore nel parsing del messaggio:", error);
    }
  }

  subscribeToStateChanges() {
    const settings = this.settingsManager.getSettings();

    if (settings.sensorCameraMappings && settings.sensorCameraMappings.length > 0 ||
        (settings.alarmSettings?.enabled && settings.alarmSettings?.sensorId)) {
      setTimeout(() => {
        const subscriptionId = this.getNextSubscriptionId();
        const message = {
          id: subscriptionId,
          type: "subscribe_events",
          event_type: "state_changed",
        };

        this.wsConnection.send(JSON.stringify(message));
        this.subscriptionIds.set(subscriptionId, "state_changed");
      }, 100);
    }
  }

  handleResultMessage(message) {
    if (message.success && this.subscriptionIds.has(message.id)) {
      const subscriptionType = this.subscriptionIds.get(message.id);
      if (subscriptionType === "state_changed") {
        this.startHeartbeat();
        if (this.onConnectionStatusChange) {
          this.onConnectionStatusChange(true);
        }
      }
    }
  }

  handleSensorEvent(message) {
    const { event } = message;
    if (!event || event.event_type !== "state_changed") {
      return;
    }

    const { entity_id, old_state, new_state } = event.data;
    if (!entity_id) {
      return;
    }

    const settings = this.settingsManager.getSettings();
    const sensorState = new_state?.state || "unknown";
    const previousState = old_state?.state || "unknown";
    this.sensorStates.set(entity_id, sensorState);

    if (entity_id.startsWith("alarm_control_panel.")) {
      const alarmSettings = settings.alarmSettings || {};
      if (alarmSettings.enabled && alarmSettings.sensorId === entity_id) {
        const friendlyName = new_state?.attributes?.friendly_name || entity_id;

        if (sensorState.toLowerCase() === "triggered") {
          if (this.onAlarmEvent) {
            this.onAlarmEvent({
              entity_id,
              sensorState,
              previousState,
              sensorName: friendlyName,
            });
          }
        } else if (this.onAlarmEvent && previousState?.toLowerCase() === "triggered") {
          this.onAlarmEvent({
            entity_id,
            sensorState,
            previousState,
            sensorName: friendlyName,
            dismissed: true,
          });
        }
      }
    }

    const mapping = settings.sensorCameraMappings?.find((m) => m.sensorId === entity_id);
    if (!mapping) {
      return;
    }

    if (this.onSensorEvent) {
      this.onSensorEvent({
        entity_id,
        sensorState,
        previousState,
        mapping,
      });
    }
  }

  handleConnectionClose(code) {
    this.subscriptionIds.clear();
    this.stopHeartbeat();

    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange(false);
    }

    if (!this.isReconnecting) {
      this.reconnectTimeout = setTimeout(() => {
        this.isReconnecting = false;
        this.connectToHomeAssistant();
      }, appConfig.websocket.reconnectDelay);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
        this.wsConnection.send(JSON.stringify({
          id: this.getNextSubscriptionId(),
          type: "ping"
        }));
      }
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
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      return;
    }

    const settings = this.settingsManager.getSettings();
    const hasMappings = settings.sensorCameraMappings && settings.sensorCameraMappings.length > 0;
    const alarmEnabled = settings.alarmSettings?.enabled && settings.alarmSettings?.sensorId;
    const needsSubscription = hasMappings || alarmEnabled;
    const isSubscribed = Array.from(this.subscriptionIds.values()).includes("state_changed");

    if (needsSubscription && !isSubscribed) {
      const subscriptionId = this.getNextSubscriptionId();
      const message = {
        id: subscriptionId,
        type: "subscribe_events",
        event_type: "state_changed",
      };

      this.wsConnection.send(JSON.stringify(message));
      this.subscriptionIds.set(subscriptionId, "state_changed");
    } else if (!needsSubscription && isSubscribed) {
      const stateChangedSubscriptionId = Array.from(this.subscriptionIds.entries())
        .find(([id, type]) => type === "state_changed")?.[0];
      
      if (stateChangedSubscriptionId) {
        const message = {
          id: this.getNextSubscriptionId(),
          type: "unsubscribe_events",
        };

        this.wsConnection.send(JSON.stringify(message));
        this.subscriptionIds.delete(stateChangedSubscriptionId);
      }
    }
  }

  getSensorStates() {
    return this.sensorStates;
  }

  async getCameraUrlWithToken(cameraId, homeAssistantUrl, homeAssistantToken, useHLS = false) {
    if (!cameraId || !homeAssistantUrl || !homeAssistantToken) {
      return null;
    }

    try {
      const response = await fetch(`${homeAssistantUrl}/api/states/${cameraId}`, {
        headers: {
          Authorization: `Bearer ${homeAssistantToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const cameraState = await response.json();
      const friendlyName = cameraState.attributes?.friendly_name || cameraId;

      // Se HLS è abilitato, prova prima l'API WebSocket per ottenere l'URL HLS
      // Se fallisce, fallback a MJPEG
      let mjpegUrl;
      if (cameraState.attributes?.entity_picture) {
        mjpegUrl = `${homeAssistantUrl}${cameraState.attributes.entity_picture}`;
      } else if (cameraState.attributes?.access_token) {
        mjpegUrl = `${homeAssistantUrl}/api/camera_proxy_stream/${cameraId}?token=${cameraState.attributes.access_token}`;
      } else {
        mjpegUrl = `${homeAssistantUrl}/api/camera_proxy_stream/${cameraId}?token=${homeAssistantToken}`;
      }

      if (useHLS) {
        try {
          const hlsUrl = await this.getHlsStreamUrl(cameraId, homeAssistantUrl);
          if (hlsUrl) {
            return { url: hlsUrl, friendlyName, streamType: "hls", mjpegUrl };
          }
          
          console.log(`HLS non disponibile per ${cameraId}, fallback a MJPEG`);
        } catch (hlsError) {
          console.warn(`Errore nell'ottenere l'URL HLS per ${cameraId}:`, hlsError.message);
          console.log(`Fallback a MJPEG per ${cameraId}`);
        }
      }

      return { url: mjpegUrl, friendlyName, streamType: "mjpeg" };
    } catch (error) {
      console.error(`Errore nell'ottenere l'URL della camera ${cameraId}:`, error);
      return null;
    }
  }

  async getHlsStreamUrl(cameraId, homeAssistantUrl) {
    return new Promise((resolve, reject) => {
      if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket non connesso"));
        return;
      }

      const requestId = this.getNextSubscriptionId();
      const timeout = setTimeout(() => {
        reject(new Error("Timeout nella richiesta HLS"));
      }, appConfig.hls.timeout);

      // Listener per la risposta
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data);

          if (message.id === requestId && message.type === "result") {
            clearTimeout(timeout);
            this.wsConnection.removeListener("message", messageHandler);

            if (message.success && message.result && message.result.url) {
              // Costruisci l'URL completo
              const hlsUrl = `${homeAssistantUrl}${message.result.url}`;
              console.log(`URL HLS ottenuto: ${hlsUrl}`);
              resolve(hlsUrl);
            } else {
              // HLS non supportato per questa camera
              console.warn(`HLS non supportato per camera ${cameraId}`);
              reject(new Error("HLS non supportato"));
            }
          }
        } catch (error) {
          console.error("Errore nel parsing della risposta HLS:", error);
          reject(error);
        }
      };

      this.wsConnection.on("message", messageHandler);

      // Invia la richiesta per ottenere l'URL HLS
      const request = {
        id: requestId,
        type: "camera/stream",
        entity_id: cameraId,
      };

      console.log(`Invio richiesta HLS per camera ${cameraId}:`, request);
      this.wsConnection.send(JSON.stringify(request));
    });
  }

  closeConnection() {
    this.clearReconnectTimeout();
    this.stopHeartbeat();

    if (this.wsConnection) {
      try {
        this.wsConnection.removeAllListeners();
        if (this.wsConnection.readyState === WebSocket.OPEN || this.wsConnection.readyState === WebSocket.CONNECTING) {
          this.wsConnection.close(1000, "Applicazione in chiusura");
        }
      } catch (error) {
        console.error("Errore durante la chiusura della WebSocket:", error);
      } finally {
        this.wsConnection = null;
      }
    }

    this.sensorStates.clear();
    this.subscriptionIds.clear();
    this.isReconnecting = false;
  }

  getNextSubscriptionId() {
    return this.subscriptionCounter++;
  }
}

module.exports = WebSocketManager;
