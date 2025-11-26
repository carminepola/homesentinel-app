class ThemeManager {
  constructor() {
    this.currentTheme = "light";
    this.themeIcon = null;
    this.themeToggleBtn = null;

    this.init();
  }

  // Inizializza il gestore del tema
  init() {
    this.themeToggleBtn = document.getElementById("theme-toggle-btn");
    this.themeIcon = document.getElementById("theme-icon");

    // Carica il tema salvato
    this.loadTheme();

    // Imposta l'event listener per il toggle
    if (this.themeToggleBtn) {
      this.themeToggleBtn.addEventListener("click", () => this.toggleTheme());
    }

    // Ascolta i cambiamenti del tema di sistema
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        // Aggiorna solo se non è stato impostato un tema manuale
        if (!localStorage.getItem("theme")) {
          this.updateSystemTheme();
        }
      });
    }
  }

  // Carica il tema salvato o quello di sistema
  loadTheme() {
    const savedTheme = localStorage.getItem("theme");

    if (savedTheme) {
      this.currentTheme = savedTheme;
    } else {
      this.updateSystemTheme();
    }

    this.applyTheme();
  }

  // Aggiorna il tema in base alle preferenze di sistema
  updateSystemTheme() {
    const isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    this.currentTheme = isDarkMode ? "dark" : "light";
  }

  // Applica il tema corrente
  applyTheme() {
    document.documentElement.setAttribute("data-theme", this.currentTheme);
    this.updateThemeIcon();
  }

  // Cambia il tema tra chiaro e scuro
  toggleTheme() {
    this.currentTheme = this.currentTheme === "light" ? "dark" : "light";
    localStorage.setItem("theme", this.currentTheme);
    this.applyTheme();
  }

  // Imposta un tema specifico
  setTheme(theme) {
    if (theme === "light" || theme === "dark") {
      this.currentTheme = theme;
      localStorage.setItem("theme", theme);
      this.applyTheme();
    }
  }

  // Ottiene il tema corrente
  getCurrentTheme() {
    return this.currentTheme;
  }

  // Aggiorna l'icona del tema
  updateThemeIcon() {
    if (!this.themeIcon) return;

    if (this.currentTheme === "dark") {
      this.themeIcon.innerHTML = `
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      `;
    } else {
      this.themeIcon.innerHTML = `
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      `;
    }
  }
}

module.exports = ThemeManager;
