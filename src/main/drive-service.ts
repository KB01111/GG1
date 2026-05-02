import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { shell } from 'electron';
import { request as gaxiosRequest } from 'gaxios';
import { google } from 'googleapis';
import { createStableId } from '../shared/manifest.js';
import type { AuthState, DriveUploadResult, ManifestEntry, UploadJob, UploadProgress, VerificationResult } from '../shared/types.js';

interface StoredToken {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
}

interface ClientConfig {
  clientId: string;
  clientSecret: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export class DriveService {
  private readonly tokenPath: string;
  private oauthClient = new google.auth.OAuth2();

  constructor(userDataPath: string) {
    this.tokenPath = path.join(userDataPath, 'google-drive-token.json');
  }

  async getAuthState(): Promise<AuthState> {
    const config = this.getClientConfig();
    if (!config) {
      return { connected: false, needsClientConfig: true };
    }

    const token = await this.readToken();
    if (!token?.access_token && !token?.refresh_token) {
      return { connected: false, needsClientConfig: false };
    }

    this.configureClient(config, 'http://127.0.0.1');
    this.oauthClient.setCredentials(token);
    return {
      connected: true,
      expiresAt: token.expiry_date ? new Date(token.expiry_date).toISOString() : undefined,
      needsClientConfig: false
    };
  }

  async beginOAuth(): Promise<AuthState> {
    const config = this.getClientConfig();
    if (!config) {
      return { connected: false, needsClientConfig: true };
    }

    const server = http.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Unable to allocate OAuth callback port');
    }

    const nonce = randomBytes(32).toString('hex');
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
    this.configureClient(config, redirectUri);
    const authUrl = this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE],
      state: nonce
    });

    const callbackPromise = new Promise<AuthState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('OAuth flow timed out after 15 minutes'));
      }, 15 * 60 * 1000);

      server.on('request', async (request, response) => {
        try {
          if (!request.url) {
            throw new Error('Missing OAuth callback URL');
          }
          const callbackUrl = new URL(request.url, redirectUri);
          const receivedState = callbackUrl.searchParams.get('state');
          if (receivedState !== nonce) {
            throw new Error('OAuth state parameter mismatch');
          }
          const code = callbackUrl.searchParams.get('code');
          if (!code) {
            throw new Error(callbackUrl.searchParams.get('error') ?? 'OAuth callback missing code');
          }
          const { tokens } = await this.oauthClient.getToken(code);
          await this.saveToken(tokens as StoredToken);
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end('<h1>Drive Offloader connected</h1><p>You can return to the app.</p>');
          clearTimeout(timeout);
          resolve(await this.getAuthState());
        } catch (error) {
          response.writeHead(500, { 'content-type': 'text/plain' });
          response.end(error instanceof Error ? error.message : 'OAuth failed');
          clearTimeout(timeout);
          reject(error);
        } finally {
          server.close();
        }
      });
    });

    await shell.openExternal(authUrl);
    return callbackPromise;
  }

  async uploadFile(job: UploadJob, onProgress: (progress: UploadProgress) => void): Promise<DriveUploadResult> {
    const config = this.getClientConfig();
    if (!config) {
      throw new Error('Google OAuth client config is missing. Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET.');
    }

    const token = await this.readToken();
    if (!token) {
      throw new Error('Connect Google Drive before uploading.');
    }

    this.configureClient(config, 'http://127.0.0.1');
    this.oauthClient.setCredentials(token);
    const drive = google.drive({ version: 'v3', auth: this.oauthClient });
    const stats = await fs.stat(job.item.path);
    const localSha256 = await this.sha256(job.item.path);

    onProgress({ jobId: job.id, status: 'uploading', progressBytes: 0, totalBytes: stats.size, message: 'Creating Drive upload session' });
    const created = await drive.files.create({
      requestBody: {
        name: job.item.name,
        parents: job.destinationFolderId ? [job.destinationFolderId] : undefined
      },
      media: {
        mimeType: 'application/octet-stream',
        body: createReadStream(job.item.path)
      },
      fields: 'id,name,size,md5Checksum',
      uploadType: 'resumable'
    }, {
      onUploadProgress: (event) => {
        onProgress({
          jobId: job.id,
          status: 'uploading',
          progressBytes: Number(event.bytesRead ?? 0),
          totalBytes: stats.size
        });
      }
    });

    const driveFile = created.data;
    if (!driveFile.id) {
      throw new Error('Drive upload did not return a file ID');
    }

    onProgress({ jobId: job.id, status: 'verifying', progressBytes: stats.size, totalBytes: stats.size, message: 'Verifying upload metadata' });
    const localMd5 = this.md5FromShaPlaceholder(localSha256);
    const verification: VerificationResult = {
      status: Number(driveFile.size ?? 0) === stats.size ? 'verified' : 'failed',
      sizeMatches: Number(driveFile.size ?? 0) === stats.size,
      hashMatches: localMd5 ? driveFile.md5Checksum === localMd5 : undefined,
      localSha256,
      driveMd5: driveFile.md5Checksum ?? undefined,
      checkedAt: new Date().toISOString()
    };

    return {
      jobId: job.id,
      driveFileId: driveFile.id,
      driveName: driveFile.name ?? job.item.name,
      size: stats.size,
      verification
    };
  }

  async downloadFile(entry: ManifestEntry, destinationPath: string, onProgress: (progress: UploadProgress) => void): Promise<void> {
    const config = this.getClientConfig();
    const token = await this.readToken();
    if (!config || !token) {
      throw new Error('Connect Google Drive before restoring.');
    }

    this.configureClient(config, 'http://127.0.0.1');
    this.oauthClient.setCredentials(token);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });

    const tempPath = `${destinationPath}.tmp-${entry.id}-${Date.now()}`;

    try {
      const response = await gaxiosRequest<NodeJS.ReadableStream>({
        url: `https://www.googleapis.com/drive/v3/files/${entry.driveFileId}?alt=media`,
        method: 'GET',
        responseType: 'stream',
        headers: { Authorization: `Bearer ${(await this.oauthClient.getAccessToken()).token}` }
      });

      let bytes = 0;
      response.data.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        onProgress({ jobId: entry.id, status: 'uploading', progressBytes: bytes, totalBytes: entry.fileSize });
      });

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(tempPath);
        response.data.pipe(output);
        output.on('finish', () => resolve());
        output.on('error', reject);
        response.data.on('error', reject);
      });

      if (bytes !== entry.fileSize) {
        await fs.unlink(tempPath).catch(() => undefined);
        throw new Error(`Downloaded ${bytes} bytes but expected ${entry.fileSize} bytes`);
      }

      await fs.rename(tempPath, destinationPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private getClientConfig(): ClientConfig | undefined {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return undefined;
    }
    return { clientId, clientSecret };
  }

  private configureClient(config: ClientConfig, redirectUri: string): void {
    this.oauthClient = new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri);
  }

  private async readToken(): Promise<StoredToken | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.tokenPath, 'utf8')) as StoredToken;
    } catch {
      return undefined;
    }
  }

  private async saveToken(token: StoredToken): Promise<void> {
    await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
    await fs.writeFile(this.tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
  }

  private async sha256(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    return hash.digest('hex');
  }

  private md5FromShaPlaceholder(_sha256: string): string | undefined {
    return undefined;
  }

  createManifestEntry(itemPath: string, result: DriveUploadResult): ManifestEntry {
    return {
      id: createStableId(`${itemPath}:${result.driveFileId}`),
      originalPath: itemPath,
      driveFileId: result.driveFileId,
      driveName: result.driveName,
      uploadedAt: new Date().toISOString(),
      fileSize: result.size,
      sha256: result.verification.localSha256,
      actionTaken: 'uploaded',
      verification: result.verification
    };
  }
}
