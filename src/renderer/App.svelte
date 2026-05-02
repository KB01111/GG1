<script lang="ts">
  import { AlertTriangle, Brain, CheckCircle2, Database, FolderSearch, HardDrive, RotateCcw, ShieldCheck, Trash2, UploadCloud } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import type { AuthState, ClassificationKind, FileSystemItem, ManifestEntry, ScanProgress, ScanSummary, UploadProgress } from '../shared/types';
  import { formatBytes, formatDate } from '../shared/format';
  import Badge from './components/ui/Badge.svelte';
  import Button from './components/ui/Button.svelte';
  import Card from './components/ui/Card.svelte';
  import Progress from './components/ui/Progress.svelte';

  const defaultOptions = {
    dryRun: true,
    includeContentAnalysis: false,
    minCandidateBytes: 25 * 1024 * 1024,
    oldFileDays: 90,
    maxItems: 400
  };

  let selectedRoots: string[] = [];
  let scanSummary: ScanSummary | undefined;
  let scanProgress: ScanProgress | undefined;
  let authState: AuthState = { connected: false, needsClientConfig: false };
  let manifest: ManifestEntry[] = [];
  let selectedIds = new Set<string>();
  let selectedManifestIds = new Set<string>();
  let uploadProgress: UploadProgress | undefined;
  let busy = false;
  let message = '';
  let destructivePhrase = '';

  $: items = scanSummary?.items ?? [];
  $: classifications = scanSummary?.classifications ?? [];
  $: classificationById = new Map(classifications.map((classification) => [classification.itemId, classification]));
  $: selectedItems = items.filter((item) => selectedIds.has(item.id));
  $: selectedManifestEntries = manifest.filter((entry) => selectedManifestIds.has(entry.id));
  $: safeDeleteCount = classifications.filter((classification) => classification.kind === 'safe_delete').length;
  $: safeOffloadCount = classifications.filter((classification) => classification.kind === 'safe_offload').length;
  $: protectedCount = classifications.filter((classification) => classification.kind === 'protected_do_not_touch').length;

  onMount(() => {
    const removeScanListener = window.storageCleaner.onScanProgress((progress) => {
      scanProgress = progress;
    });
    const removeUploadListener = window.storageCleaner.onUploadProgress((progress) => {
      uploadProgress = progress;
    });
    refreshManifest().catch(showError);
    window.storageCleaner.getDriveAuthState().then((state) => authState = state).catch(showError);
    return () => {
      removeScanListener();
      removeUploadListener();
    };
  });

  function showError(error: unknown): void {
    message = error instanceof Error ? error.message : String(error);
  }

  function classificationTone(kind: ClassificationKind): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
    if (kind === 'safe_delete') return 'red';
    if (kind === 'safe_offload') return 'green';
    if (kind === 'protected_do_not_touch') return 'blue';
    return 'yellow';
  }

  function classificationLabel(kind: ClassificationKind): string {
    return kind.replaceAll('_', ' ');
  }

  async function selectFolders(): Promise<void> {
    selectedRoots = await window.storageCleaner.selectFolders();
  }

  async function startScan(): Promise<void> {
    if (selectedRoots.length === 0) {
      message = 'Select at least one folder first.';
      return;
    }
    busy = true;
    message = '';
    selectedIds = new Set<string>();
    try {
      scanSummary = await window.storageCleaner.startScan({ roots: selectedRoots, options: defaultOptions });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function classifyWithAi(): Promise<void> {
    if (!scanSummary) return;
    busy = true;
    try {
      const nextClassifications = await window.storageCleaner.classifyWithAi(scanSummary.items, scanSummary.classifications);
      scanSummary = { ...scanSummary, classifications: nextClassifications };
      message = 'AI explanations refreshed. No actions were taken.';
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  function toggleItem(item: FileSystemItem): void {
    const classification = classificationById.get(item.id);
    if (item.protected || classification?.kind === 'protected_do_not_touch') {
      message = 'Protected items cannot be selected.';
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    selectedIds = next;
  }

  function selectOffloadCandidates(): void {
    selectedIds = new Set(items.filter((item) => classificationById.get(item.id)?.kind === 'safe_offload').map((item) => item.id));
  }

  async function connectDrive(): Promise<void> {
    busy = true;
    try {
      authState = await window.storageCleaner.beginDriveOAuth();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function uploadSelected(): Promise<void> {
    if (selectedItems.length === 0) {
      message = 'Select offload candidates first.';
      return;
    }
    busy = true;
    try {
      const uploaded = await window.storageCleaner.uploadItems(selectedItems);
      message = `Uploaded and verified ${uploaded.length} file(s).`;
      await refreshManifest();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function refreshManifest(): Promise<void> {
    manifest = await window.storageCleaner.listManifest();
  }

  function toggleManifest(entry: ManifestEntry): void {
    const next = new Set(selectedManifestIds);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    selectedManifestIds = next;
  }

  async function quarantineSelected(): Promise<void> {
    busy = true;
    try {
      const results = await window.storageCleaner.quarantine([...selectedManifestIds]);
      message = results.map((result) => result.message).join(' ');
      await refreshManifest();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function dryRunDeleteSelected(): Promise<void> {
    busy = true;
    try {
      const results = await window.storageCleaner.deleteVerified({ dryRun: true, approvedEntryIds: [...selectedManifestIds], phrase: '' });
      message = results.map((result) => result.message).join(' ');
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function deleteSelected(): Promise<void> {
    busy = true;
    try {
      const results = await window.storageCleaner.deleteVerified({ dryRun: false, approvedEntryIds: [...selectedManifestIds], phrase: destructivePhrase });
      message = results.map((result) => result.message).join(' ');
      destructivePhrase = '';
      await refreshManifest();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function restoreEntry(entry: ManifestEntry): Promise<void> {
    try {
      const result = await window.storageCleaner.restore(entry.driveFileId, entry.originalPath);
      message = result.message;
      if (result.success) {
        await refreshManifest();
      }
    } catch (error) {
      console.error('Restore failed:', error);
      showError(error);
    }
  }
</script>

<main class="shell">
  <section class="hero">
    <div>
      <p class="eyebrow"><ShieldCheck size={16} /> Dry-run first Windows storage cleanup</p>
      <h1>AI Storage Cleaner + Google Drive Offloader</h1>
      <p class="hero-copy">Scan metadata, classify safe candidates, offload to Google Drive, verify uploads, then approve quarantine or deletion explicitly.</p>
    </div>
    <div class="hero-card">
      <HardDrive size={34} />
      <strong>{formatBytes(scanSummary?.totalBytes ?? 0)}</strong>
      <span>Scanned bytes</span>
    </div>
  </section>

  {#if message}
    <div class="notice"><AlertTriangle size={18} /> {message}</div>
  {/if}

  <section class="grid metrics" data-testid="dashboard-metrics">
    <Card title="Safe offload" description="Large user files and old archives"><div class="metric">{safeOffloadCount}</div></Card>
    <Card title="Safe delete" description="Generated caches/logs only"><div class="metric danger">{safeDeleteCount}</div></Card>
    <Card title="Protected" description="System, browser, credentials"><div class="metric protected">{protectedCount}</div></Card>
    <Card title="Manifest" description="Verified Drive records"><div class="metric">{manifest.length}</div></Card>
  </section>

  <div class="layout">
    <Card title="1. Scan selected folders" description="Metadata-first analysis: path, size, extension, timestamps, depth. Contents are never read unless explicitly enabled later.">
      <div class="actions">
        <Button variant="secondary" on:click={selectFolders} disabled={busy}><FolderSearch size={16} /> Select folders</Button>
        <Button on:click={startScan} disabled={busy || selectedRoots.length === 0}>Start scan</Button>
        <Button variant="ghost" on:click={classifyWithAi} disabled={busy || !scanSummary}><Brain size={16} /> AI explain risk</Button>
      </div>
      <ul class="roots">
        {#each selectedRoots as root}
          <li>{root}</li>
        {:else}
          <li>Good first targets: Downloads, Videos, Documents/Archives, Projects, Temp, old build folders, node_modules, dist, build, out, .cache, logs.</li>
        {/each}
      </ul>
      {#if scanProgress}
        <Progress value={scanProgress.scannedCount} max={Math.max(scanProgress.scannedCount + scanProgress.skippedCount, 1)} />
        <p class="muted">{scanProgress.status}: {scanProgress.currentPath}</p>
      {/if}
    </Card>

    <Card title="2. Google Drive" description="OAuth tokens stay local. Uploads require selection and use resumable Drive uploads.">
      <div class="actions">
        <Badge tone={authState.connected ? 'green' : authState.needsClientConfig ? 'yellow' : 'slate'}>{authState.connected ? 'connected' : authState.needsClientConfig ? 'client config needed' : 'not connected'}</Badge>
        <Button variant="secondary" on:click={connectDrive} disabled={busy || authState.needsClientConfig}>Connect Drive</Button>
        <Button on:click={uploadSelected} disabled={busy || selectedItems.length === 0}><UploadCloud size={16} /> Upload selected</Button>
      </div>
      {#if authState.needsClientConfig}
        <p class="muted">Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET before Drive uploads.</p>
      {/if}
      {#if uploadProgress}
        <Progress value={uploadProgress.progressBytes} max={uploadProgress.totalBytes} />
        <p class="muted">{uploadProgress.status}: {formatBytes(uploadProgress.progressBytes)} / {formatBytes(uploadProgress.totalBytes)}</p>
      {/if}
    </Card>
  </div>

  <Card title="Top folders/files by size" description="Review classifications before selecting anything for upload or cleanup.">
    <div class="table-actions">
      <Button variant="secondary" on:click={selectOffloadCandidates} disabled={!scanSummary}>Select safe offload</Button>
      <span class="muted">{selectedItems.length} selected</span>
    </div>
    <div class="table">
      <div class="row header"><span></span><span>Name</span><span>Class</span><span>Size</span><span>Modified</span><span>Reason</span></div>
      {#each items as item}
        {@const classification = classificationById.get(item.id)}
        <label class="row" class:disabled={item.protected || classification?.kind === 'protected_do_not_touch'}>
          <input type="checkbox" checked={selectedIds.has(item.id)} disabled={item.protected || classification?.kind === 'protected_do_not_touch'} on:change={() => toggleItem(item)} />
          <span title={item.path}>{item.name}</span>
          <span><Badge tone={classificationTone(classification?.kind ?? 'review_manually')}>{classificationLabel(classification?.kind ?? 'review_manually')}</Badge></span>
          <span>{formatBytes(item.size)}</span>
          <span>{formatDate(item.modifiedAt)}</span>
          <span class="reason">{classification?.aiExplanation ?? classification?.reason ?? item.reasons.join(', ')}</span>
        </label>
      {:else}
        <div class="empty">No scan results yet.</div>
      {/each}
    </div>
  </Card>

  <Card title="Verified manifest + restore" description="Local deletion is offered only after upload verification. Default action below is dry run.">
    <div class="actions">
      <Button variant="secondary" on:click={refreshManifest}><Database size={16} /> Refresh</Button>
      <Button variant="secondary" on:click={dryRunDeleteSelected} disabled={selectedManifestEntries.length === 0}><Trash2 size={16} /> Dry-run delete</Button>
      <Button variant="secondary" on:click={quarantineSelected} disabled={selectedManifestEntries.length === 0}>Quarantine</Button>
    </div>
    <div class="danger-zone">
      <p><strong>Permanent delete requires verified uploads and exact approval phrase:</strong> DELETE VERIFIED LOCAL COPIES</p>
      <input bind:value={destructivePhrase} placeholder="Type approval phrase" />
      <Button variant="destructive" on:click={deleteSelected} disabled={selectedManifestEntries.length === 0 || destructivePhrase !== 'DELETE VERIFIED LOCAL COPIES'}>Delete verified local copies</Button>
    </div>
    <div class="table manifest-table">
      <div class="row header"><span></span><span>Original path</span><span>Drive ID</span><span>Uploaded</span><span>Status</span><span>Restore</span></div>
      {#each manifest as entry}
        <label class="row">
          <input type="checkbox" checked={selectedManifestIds.has(entry.id)} on:change={() => toggleManifest(entry)} />
          <span title={entry.originalPath}>{entry.originalPath}</span>
          <span>{entry.driveFileId}</span>
          <span>{formatDate(entry.uploadedAt)}</span>
          <span><Badge tone={entry.verification.status === 'verified' ? 'green' : 'yellow'}>{entry.actionTaken}</Badge></span>
          <span on:click={() => restoreEntry(entry)} style="cursor: pointer;"><RotateCcw size={14} /> restore via manifest</span>
        </label>
      {:else}
        <div class="empty">No verified uploads in the local manifest.</div>
      {/each}
    </div>
  </Card>

  <Card title="MVP roadmap" description="Fast, safe first version; richer automation later.">
    <ol class="roadmap">
      <li><CheckCircle2 size={16} /> Metadata scanner, deterministic classification, Drive upload verification, manifest, quarantine/delete approval.</li>
      <li>Windows shell integration, scheduled scans, richer folder tree visualization, ONNX/Windows ML local model, cloud AI settings.</li>
      <li>Duplicate detection, policy presets, enterprise controls, encrypted manifest backup, Drive reconciliation.</li>
    </ol>
  </Card>
</main>
