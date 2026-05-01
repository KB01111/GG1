export type FileSystemItemKind = 'file' | 'folder';
export type ClassificationKind = 'safe_delete' | 'safe_offload' | 'review_manually' | 'protected_do_not_touch';
export type UploadJobStatus = 'queued' | 'uploading' | 'verifying' | 'verified' | 'failed';
export type LocalAction = 'none' | 'uploaded' | 'deleted' | 'quarantined' | 'restored';
export type VerificationStatus = 'pending' | 'verified' | 'failed';

export interface ScanOptions {
  dryRun: boolean;
  includeContentAnalysis: boolean;
  minCandidateBytes: number;
  oldFileDays: number;
  maxItems: number;
}

export interface ScanRequest {
  roots: string[];
  options: ScanOptions;
}

export interface FileSystemItem {
  id: string;
  path: string;
  name: string;
  kind: FileSystemItemKind;
  size: number;
  modifiedAt: string;
  accessedAt?: string;
  depth: number;
  extension?: string;
  childrenCount?: number;
  protected: boolean;
  reasons: string[];
}

export interface ScanProgress {
  scanId: string;
  currentPath?: string;
  scannedCount: number;
  skippedCount: number;
  protectedCount: number;
  totalBytes: number;
  status: 'started' | 'scanning' | 'done' | 'cancelled' | 'failed';
  message?: string;
}

export interface ScanSummary {
  scanId: string;
  roots: string[];
  items: FileSystemItem[];
  classifications: Classification[];
  totalBytes: number;
  scannedCount: number;
  skippedCount: number;
  protectedCount: number;
  startedAt: string;
  finishedAt: string;
}

export interface ClassificationOptions {
  oldFileDays: number;
  minCandidateBytes: number;
}

export interface Classification {
  itemId: string;
  kind: ClassificationKind;
  riskScore: number;
  reason: string;
  ruleIds: string[];
  aiExplanation?: string;
}

export interface AiClassificationInput {
  item: FileSystemItem;
  baseline: Classification;
}

export interface AiClassificationResult {
  itemId: string;
  kind: ClassificationKind;
  riskScore: number;
  explanation: string;
}

export interface AuthState {
  connected: boolean;
  email?: string;
  expiresAt?: string;
  needsClientConfig: boolean;
}

export interface UploadJob {
  id: string;
  item: FileSystemItem;
  destinationFolderId?: string;
  status: UploadJobStatus;
  progressBytes: number;
  totalBytes: number;
  error?: string;
}

export interface UploadProgress {
  jobId: string;
  status: UploadJobStatus;
  progressBytes: number;
  totalBytes: number;
  message?: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  sizeMatches: boolean;
  hashMatches?: boolean;
  localSha256?: string;
  driveMd5?: string;
  checkedAt?: string;
  error?: string;
}

export interface DriveUploadResult {
  jobId: string;
  driveFileId: string;
  driveName: string;
  size: number;
  verification: VerificationResult;
}

export interface ManifestEntry {
  id: string;
  originalPath: string;
  driveFileId: string;
  driveName: string;
  uploadedAt: string;
  fileSize: number;
  sha256?: string;
  actionTaken: LocalAction;
  verification: VerificationResult;
  localActionAt?: string;
  restorePath?: string;
}

export interface DeletionPlan {
  dryRun: boolean;
  entries: ManifestEntry[];
  refused: Array<{ entry: ManifestEntry; reason: string }>;
  approvalPhrase: string;
}

export interface DestructiveApproval {
  dryRun: boolean;
  approvedEntryIds: string[];
  phrase: string;
}

export interface LocalActionResult {
  entryId: string;
  action: LocalAction;
  path: string;
  success: boolean;
  message: string;
}

export interface RestoreResult {
  entryId: string;
  destinationPath: string;
  success: boolean;
  message: string;
}

export interface ProtectedPathMatch {
  protected: boolean;
  reason?: string;
}

export interface ScannerWorkerRequest {
  scanId: string;
  roots: string[];
  options: ScanOptions;
}

export interface ScannerWorkerDoneEvent {
  type: 'done';
  summary: Omit<ScanSummary, 'classifications'>;
}

export interface ScannerWorkerProgressEvent {
  type: 'progress';
  progress: ScanProgress;
}

export interface ScannerWorkerErrorEvent {
  type: 'error';
  message: string;
}

export type ScannerWorkerEvent = ScannerWorkerDoneEvent | ScannerWorkerProgressEvent | ScannerWorkerErrorEvent;

export interface StorageCleanerApi {
  selectFolders(): Promise<string[]>;
  startScan(request: ScanRequest): Promise<ScanSummary>;
  onScanProgress(callback: (progress: ScanProgress) => void): () => void;
  getDriveAuthState(): Promise<AuthState>;
  beginDriveOAuth(): Promise<AuthState>;
  uploadItems(items: FileSystemItem[]): Promise<ManifestEntry[]>;
  onUploadProgress(callback: (progress: UploadProgress) => void): () => void;
  listManifest(): Promise<ManifestEntry[]>;
  classifyWithAi(items: FileSystemItem[], baseline: Classification[]): Promise<Classification[]>;
  planDeletion(entryIds: string[]): Promise<DeletionPlan>;
  quarantine(entryIds: string[]): Promise<LocalActionResult[]>;
  deleteVerified(approval: DestructiveApproval): Promise<LocalActionResult[]>;
  restore(entryId: string, destinationPath: string): Promise<RestoreResult>;
}
