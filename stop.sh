#!/bin/bash
curl -s -X POST http://localhost:3204/shutdown || pkill -f "node server.js"
