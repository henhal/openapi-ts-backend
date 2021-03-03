#!/bin/bash
OK="\e[32m OK\e[39m"

echo -ne "Compiling..." && \
npx tsc && echo -e $OK && \
echo -ne "Copying data files..." && \
rsync -a --exclude '*.ts' --exclude '*.js' src/ build/ && echo -e $OK

