#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
  fi
fi
if ! command -v npm >/dev/null 2>&1; then
  print 'Node/npm could not be found. Use a terminal with Node 24 activated.'
  read '?Press Enter to close.'
  exit 1
fi
print 'Starting Expo and the simulator. Scan the QR code in Expo Go; Ctrl+C stops both.'
npm start
