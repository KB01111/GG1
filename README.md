# Drive Offloader

AI-powered Windows Storage Cleaner + Google Drive Offloader MVP.

## Goal

Drive Offloader scans selected local folders, identifies large/old/safe-to-offload files and folders, uploads approved items to Google Drive, verifies upload metadata, records a local manifest, then offers dry-run deletion, quarantine, or explicitly approved local deletion.

## Core safety principles

- AI never directly deletes files.
- Destructive actions require explicit user approval.
- Default workflow is dry-run first.
- Deterministic rules run before any AI explanation.
- File contents are not scanned or uploaded for analysis; classification uses metadata: path, size, extension, timestamps, and folder depth.
- Protected paths are refused by scanner/upload/delete flows.

## Protected paths

Initial protected paths include `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, browser profiles, credential stores, active app config folders, system folders, and anything matching sensitive/admin-style locations.

## Good first scan targets

Downloads, Videos, Documents/Archives, Projects, AppData/Local/Temp, old build folders, `node_modules`, `dist`, `build`, `out`, `.cache`, logs, and old `zip`/`rar`/`7z` archives.

## Project structure

```text
src/main/       Electron main process, scanner workers, Drive integration, manifest, safe actions
src/renderer/   Svelte dashboard and shadcn-style UI primitives
src/shared/     TypeScript interfaces, classification rules, protected path policy, format helpers
test/           Electron smoke tests
```

## Create/build commands

This repo has already been remade with Electron + Vite + Svelte + TypeScript. The equivalent setup commands are:

```bash
npm install --save electron-squirrel-startup googleapis gaxios svelte lucide-svelte clsx tailwind-merge
npm install --save-dev @sveltejs/vite-plugin-svelte @types/node @typescript-eslint/eslint-plugin @typescript-eslint/parser chai cross-env electron electron-builder eslint eslint-plugin-svelte mocha puppeteer-core tsx typescript vite wait-for-throwable
```

## Development

```bash
npm install
npm run build
npm test
npm run package
```

For Google Drive uploads, create an OAuth desktop/web client and set:

```bash
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
```

The TypeScript setup uses stable TypeScript for CI compatibility. If `tsgo` is installed locally, `npm run typecheck:tsgo` runs the same projects with it.

## MVP roadmap

1. MVP: metadata scanner, deterministic classification, Google Drive OAuth/resumable uploads, upload verification, manifest, quarantine/delete approval, restore from manifest.
2. Next: Windows shell integration, scheduled scans, richer folder tree visualization, ONNX/Windows ML local model, OpenAI/OpenRouter settings UI.
3. Later: duplicate detection, policy presets, enterprise admin policy, encrypted manifest backup, Google Drive reconciliation.
