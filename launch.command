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
print 'Starting the simulator. Open the URL printed below; Ctrl+C stops it.'
npm start
