class DndScheduler {
  constructor(settingsManager, trayManager) {
    this.settingsManager = settingsManager;
    this.trayManager = trayManager;
    this.timer = null;
    this.lastInWindow = null;
  }

  setTrayManager(trayManager) {
    this.trayManager = trayManager;
  }

  start() {
    this.stop();
    const settings = this.settingsManager.getSettings();
    if (!settings.dndSchedule?.enabled) {
      return;
    }
    this.lastInWindow = this._isInWindow(new Date());
    // Se l'app parte (o la pianificazione viene salvata) dentro la fascia oraria, attiva subito il DnD
    if (this.lastInWindow && this.trayManager && !this.trayManager.getDndMode()) {
      this.trayManager.setDndMode(true);
    }
    this.timer = setInterval(() => this._tick(), 20000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastInWindow = null;
  }

  restart() {
    this.start();
  }

  _parseTime(value) {
    const [h, m] = (value || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
    return h * 60 + m;
  }

  _isInWindow(now) {
    const schedule = this.settingsManager.getSettings().dndSchedule;
    if (!schedule?.enabled) return false;

    const days = schedule.days || [];
    const start = this._parseTime(schedule.startTime);
    const end = this._parseTime(schedule.endTime);
    if (start === end) return false;

    const cur = now.getHours() * 60 + now.getMinutes();
    const day = now.getDay();

    if (start < end) {
      // Finestra nello stesso giorno
      return cur >= start && cur < end && !!days[day];
    }

    // Finestra attraversa la mezzanotte: attribuita al giorno di inizio
    if (cur >= start) {
      return !!days[day];
    }
    if (cur < end) {
      // Appartiene alla sessione iniziata il giorno precedente
      const prevDay = (day + 6) % 7;
      return !!days[prevDay];
    }
    return false;
  }

  _tick() {
    if (!this.trayManager) return;
    const inWindow = this._isInWindow(new Date());
    if (inWindow === this.lastInWindow) return;

    this.lastInWindow = inWindow;
    this.trayManager.setDndMode(inWindow);
  }
}

module.exports = DndScheduler;
