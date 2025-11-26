# Home Assistant PiP Monitor

Un'applicazione Electron per monitorare i sensori di Home Assistant e visualizzare flussi video delle telecamere in modalità Picture-in-Picture (PiP).

## Caratteristiche

- **Connessione WebSocket con Home Assistant**: Ascolta gli eventi dei sensori `binary_sensor` e `input_boolean`
- **Visualizzazione PiP**: Mostra flussi video delle telecamere in finestre ridimensionabili e trascinabili
- **Configurazione Flessibile**: Associa più sensori a diverse telecamere con impostazioni personalizzate
- **Gestione Multi-Eventi**: Scegli tra modalità cascata o sostituzione per più eventi simultanei
- **Tema Chiaro/Scuro**: Interfaccia minimalista con tema automatico o manuale
- **Modalità Non Disturbare**: Disattiva temporaneamente le notifiche video
- **Test Integrato**: Verifica il funzionamento delle telecamere direttamente dall'app
- **Stato Sensori**: Monitora in tempo reale lo stato dei sensori configurati

## Requisiti

- Node.js 16+
- Home Assistant con token di accesso a lunga durata
- Telecamere configurate in Home Assistant

## Installazione

1. Clona questo repository:

```bash
git clone <repository-url>
cd home-assistant-pip-monitor
```

2. Installa le dipendenze:

```bash
npm install
```

3. Avvia l'applicazione in modalità sviluppo:

```bash
npm start
```

## Configurazione

### 1. Impostazioni Home Assistant

1. Vai nella scheda "Impostazioni" dell'app
2. Inserisci l'URL di Home Assistant (es: `https://homeassistant.local:8123`)
3. Genera un token di accesso a lunga durata in Home Assistant:
   - Vai in Profilo utente > Token di accesso a lunga durata
   - Crea un nuovo token e copialo
4. Inserisci il token nell'app e salva le impostazioni

### 2. Configurazione Sensori-Telecamere

1. Vai nella scheda "Sensori"
2. Clicca su "Aggiungi Mappatura"
3. Seleziona un sensore (binary_sensor o input_boolean)
4. Seleziona una telecamera o inserisci un URL diretto
5. Configura durata, audio e dimensioni
6. Salva la mappatura

### 3. Impostazioni PiP

- **Durata predefinita**: Secondi di visualizzazione del video (default: 10s)
- **Posizione iniziale**: Dove appariranno le finestre PiP
- **Modalità multi-evento**:
  - _Cascata_: Mostra più finestre una sopra l'altra
  - _Sostituisci_: Chiude la finestra esistente e ne apre una nuova
- **Audio predefinito**: Abilita/disabilita l'audio di default
- **Dimensione predefinita**: Formato video (piccolo, medio, grande, quadrato, orizzontale, verticale)

## Utilizzo

### Funzionamento Automatico

1. L'app si connette a Home Assistant via WebSocket
2. Quando un sensore configurato passa a stato "on", appare automaticamente una finestra PiP con il video della telecamera associata
3. La finestra si chiude automaticamente dopo il tempo configurato

### Controlli Finestra PiP

- **Trascinamento**: Clicca e trascina l'header per spostare la finestra
- **Muto/Attiva audio**: Clicca sull'icona dell'altoparlante
- **Chiusura manuale**: Clicca sulla X per chiudere immediatamente
- **Timer**: La barra inferiore mostra il tempo rimanente

### Modalità Test

1. Vai nella scheda "Test"
2. Seleziona una telecamera o inserisci un URL
3. Configura le impostazioni desiderate
4. Clicca "Avvia Test PiP" per verificare il funzionamento

### Modalità Non Disturbare

1. Clicca con il tasto destro sull'icona nella tray
2. Seleziona "Non Disturbare" per disattivare temporaneamente le notifiche
3. Puoi anche attivarla dalla dashboard principale

## Struttura del Progetto

```
home-assistant-pip-monitor/
├── main.js              # Processo principale Electron
├── index.html           # Interfaccia principale
├── renderer.js          # Logica dell'interfaccia
├── styles.css           # Stili interfaccia principale
├── pip.html             # Finestra PiP
├── pip-styles.css       # Stili finestra PiP
├── package.json         # Dipendenze e script
├── assets/              # Icone e risorse
└── README.md            # Documentazione
```

## Risoluzione Problemi

### Connessione Fallita

- Verifica l'URL di Home Assistant
- Controlla che il token sia valido e non scaduto
- Assicurati che Home Assistant sia accessibile dalla rete

### Video Non Caricato

- Verifica che la telecamera sia configurata correttamente in Home Assistant
- Controlla che l'URL del flusso video sia corretto
- Prova con un URL diretto del flusso video

### Finestra PiP Non Appare

- Verifica che il sensore sia configurato correttamente
- Controlla che la modalità "Non Disturbare" sia disattivata
- Verifica lo stato del sensore nella dashboard

## Sviluppo

### Build per Produzione

Per Windows:

```bash
npm run build-win
```

Per Linux:

```bash
npm run build-linux
```

I file build verranno generati nella cartella `dist/`.

### Modifiche

Il progetto è strutturato per essere facilmente modificabile:

- `main.js`: Logica di backend, connessioni WebSocket, gestione finestre
- `renderer.js`: Logica dell'interfaccia utente, gestione eventi
- `styles.css` e `pip-styles.css`: Stili personalizzabili tramite variabili CSS

## Licenza

MIT License

## Supporto

Per problemi o richieste di funzionalità, apri una issue nel repository del progetto.
