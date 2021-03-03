#!/bin/bash
SRC=$1
DEST=$2
OK="\e[32m OK\e[39m"

echo -ne "Packaging spec..." && \
mkdir -p $DEST && \
npx yimp -i $SRC -o $DEST/$(basename $SRC) && echo -e $OK