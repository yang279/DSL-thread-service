#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/node-dsl-pipeline"
node server.js
