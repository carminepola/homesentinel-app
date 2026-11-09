#!/usr/bin/env bash
# Rende installabile/pubblicabile il pacchetto pacman prodotto da electron-builder (fpm).
#
# fpm non scrive "pkgbase" in .PKGINFO, ma il registry Arch di Forgejo lo richiede
# ("invalid package base"). Lo script estrae il pacchetto, aggiunge pkgbase (= pkgname),
# rigenera .MTREE come fa makepkg e ricrea il pacchetto con il nome standard Arch:
#   <pkgname>-<pkgver>-<arch>.pkg.tar.zst
#
# Uso: scripts/fix-pacman-pkg.sh dist/HomeSentinel-1.2.3.pacman [cartella-output]
# Richiede: bsdtar (libarchive-tools), zstd. Va eseguito come root (o con fakeroot)
# per conservare proprietario e permessi dei file.
set -euo pipefail

INPUT="$1"
OUT_DIR="${2:-$(dirname "$INPUT")}"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

bsdtar -xpf "$INPUT" -C "$WORK"
PKGINFO="$WORK/.PKGINFO"

field() { sed -n "s/^$1 = //p" "$PKGINFO" | head -1; }
PKGNAME="$(field pkgname)"
PKGVER="$(field pkgver)"
ARCH="$(field arch)"

if [ -z "$PKGNAME" ] || [ -z "$PKGVER" ] || [ -z "$ARCH" ]; then
  echo "fix-pacman-pkg: .PKGINFO incompleto (pkgname/pkgver/arch)" >&2
  exit 1
fi

if ! grep -q '^pkgbase = ' "$PKGINFO"; then
  sed -i "s/^pkgname = .*/&\npkgbase = ${PKGNAME}/" "$PKGINFO"
fi

cd "$WORK"
META=(.PKGINFO)
[ -f .INSTALL ] && META+=(.INSTALL)
rm -f .MTREE .BUILDINFO

# Stesse opzioni di makepkg: .MTREE elenca file, permessi e checksum del contenuto
LANG=C bsdtar -czf .MTREE --format=mtree \
  --options='!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link' \
  "${META[@]}" *

OUTPUT="${OUT_DIR}/${PKGNAME}-${PKGVER}-${ARCH}.pkg.tar.zst"
LANG=C bsdtar -cf - .MTREE "${META[@]}" * | zstd -c -T0 -q > "$OUTPUT"

echo "$OUTPUT"
