#!/bin/sh

set -e

## Setup your environment
export REQUEST_TRACE_ID="123"
export KAWA_PRINCIPAL_ID=1
export KAWA_API_KEY="kawa-*****"
export KAWA_SERVER_URL="http://127.0.0.1:8080"
export KAWA_WORKSPACE_ID="136"
export KAWA_SHEET_ID="4830"
export KAWA_LAYOUT_ID="67636"
export KAWA_VIEWPORT_WIDTH=1000
export KAWA_VIEWPORT_HEIGHT=1000
export KAWA_VIEWPORT_SCALE=1


node /Users/emmanuel/dev/kawa-print-screen/chart-export.js