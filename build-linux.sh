#!/bin/bash

# Script per compilare il progetto HA-CAM per Linux usando Docker
# Questo script usa l'immagine electronuserland/builder:wine per creare i pacchetti
# AppImage, rpm e deb per Linux

# Esegue il container Docker con le configurazioni necessarie
docker run --rm -it \
  -v "$PWD":/project \
  -v "$PWD/.cache/electron":/root/.cache/electron \
  -v "$PWD/.cache/electron-builder":/root/.cache/electron-builder \
  -w /project \
  electronuserland/builder:wine \
  bash -c "npm install && npm run build-linux"
