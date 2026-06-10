# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

End-to-end transformation pipeline (统一 DSL 处理流程) that converts node-dsl JSON schemas into Pixso hex design files. Built as an npm workspaces monorepo with 4 specialized microservices orchestrated by a pipeline server.

## Commands

```bash
# Install all workspace dependencies
npm install

# Run all services (IPC mode — default for production)
npm start

# Run individual services (HTTP mode — useful for debugging)
npm run start:icon        # icon-agent on port 3103
npm run start:component   # component-service on port 3102
npm run start:hex         # dsl-to-hex on port 3101

# Run tests
npm run test                                          # all packages
npm run test --workspace=@unified/icon-agent          # single package

# Health check
npm run health

# Clean all node_modules and lock files
npm run clean
```

## Environment Setup

Copy `.env.example` to `.env` and set:
- `DEEPSEEK_API_KEY` — LLM for icon description parsing
- `DASHSCOPE_API_KEY` — Alibaba Cloud LLM for component matching
- `HF_ENDPOINT` — HuggingFace endpoint for BGE embeddings

## Architecture

### Services

| Package | Port | Role |
|---|---|---|
| `@unified/pipeline-server` | 3104 | HTTP API entry point + IPC orchestrator |
| `@unified/icon-agent` | 3103 | Icon recognition via vector search + SVG generation |
| `@unified/component-service` | 3102 | Component library semantic matching |
| `@unified/dsl-to-hex` | 3101 | DSL → hex via WebAssembly |

### Pipeline Flow (`POST /pipeline`)

Upload a node-dsl JSON file → parallel icon/component enrichment → design-dsl transformation → WASM hex conversion → zip response.

All intermediate outputs are saved to `output-artifacts/{request_id}/` (7+ files per request) for debugging.

### Dual Communication Mode

Services support two modes, abstracted by `ServiceClient` in `packages/pipeline-server/lib/client.js`:

- **IPC mode** (default): `child_process.fork()` — parent sends `{type: 'request', id, method, data}`, worker replies `{type: 'response'|'error', id, data|error}` with 60s timeout
- **HTTP mode**: standalone services on separate ports, useful during development

The IPC manager lives in `packages/pipeline-server/lib/ipc-manager.js`.

### Key Library Files (pipeline-server)

- `lib/enrich.js` — parallel icon + component enrichment
- `lib/design-dsl.js` — converts node-dsl attributes to design-system spec (color/gradient/stroke/shadow/typography)
- `lib/export-hex.js` — triggers dsl-to-hex conversion and packages output
- `lib/client.js` — `ServiceClient` abstraction (IPC ↔ HTTP)

### Non-Obvious Constraints

- **File-only API**: all endpoints (`/pipeline`, `/enrich`, `/convert`) accept `multipart/form-data` only — no JSON body
- **WASM singleton**: `dsl_to_hex.wasm` (`packages/dsl-to-hex/bin/`) is loaded once per process lifecycle
- **Lazy model init**: HuggingFace transformer embeddings and LLM clients initialize on first request — expect slow cold starts
- **Shared library dir**: `LIB_OUT_DIR`/`HEX_LIB_DIR` is a common directory shared between component-service and dsl-to-hex; changing it affects both
- **HNSW index**: the icon vector index (`packages/icon-agent/`) is a pre-built binary — not regenerated at runtime
- **Color format**: design-dsl transformation outputs ARGB hex (not standard RGB); see `lib/design-dsl.js` for CSS → ARGB conversion logic
