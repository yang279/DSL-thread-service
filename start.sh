#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$DIR/console.log"

cd "$DIR/node-dsl-pipeline"
node server.js >> "$LOG_FILE" 2>&1
