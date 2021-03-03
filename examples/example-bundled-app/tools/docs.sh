#!/bin/bash
SRC=$1
DEST=$2
ASSET_DIR=$3
OK="\e[32m OK\e[39m"

npx redoc-cli bundle $SRC -o $DEST/index.html
cp -R $ASSET_DIR $DEST