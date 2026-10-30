import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunPodJobResult<T> {
  id: string;
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'IN_QUEUE';
  output?: T;
  error?: string;
  executionTimeSec: number;
}

@Injectable()
export class RunPodService {
  private readonly logger = new Logger(RunPodService.name);
  private cachedApiKey: string | null = null;

  public getApiKey(): string {
    if (this.cachedApiKey) return this.cachedApiKey;

    const envKey = process.env['RUNPOD_API_KEY'];
    if (envKey && envKey.trim().length > 0) {
      this.cachedApiKey = envKey.trim();
      return this.cachedApiKey;
    }

    const envPath = join(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('RUNPOD_API_KEY=')) {
          const val = trimmed.slice('RUNPOD_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
          if (val) {
            this.cachedApiKey = val;
            return this.cachedApiKey;
          }
        }
      }
    }

    throw new Error('RUNPOD_API_KEY not configured in environment or .env');
  }

  public getEndpointId(envKeyName: string, defaultId?: string): string {
    const envVal = process.env[envKeyName];
    if (envVal && envVal.trim().length > 0) {
      return envVal.trim();
    }
    if (defaultId) return defaultId.trim();
    throw new Error(`RunPod serverless endpoint ID '${envKeyName}' is missing.`);
  }

  public async execute<TInput extends Record<string, unknown>, TOutput>(
    endpointId: string,
    input: TInput,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<RunPodJobResult<TOutput>> {
    const apiKey = this.getApiKey();
    const cleanEndpoint = endpointId.trim();
    const runUrl = `https://api.runpod.ai/v2/${cleanEndpoint}/run`;
    const pollInterval = options?.pollIntervalMs ?? 2000;
    const timeout = options?.timeoutMs ?? 180000;

    const startTime = Date.now();
    this.logger.log(`Submitting job to RunPod endpoint ${cleanEndpoint}...`);

    const initialResponse = await fetch(runUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input }),
    });

    if (!initialResponse.ok) {
      const errText = await initialResponse.text().catch(() => 'Unknown network error');
      throw new Error(`RunPod error (${initialResponse.status}): ${errText}`);
    }

    const initialData = (await initialResponse.json()) as { id: string; status: string; output?: TOutput; error?: string };

    if (initialData.status === 'COMPLETED' && initialData.output !== undefined) {
      const duration = Math.round(((Date.now() - startTime) / 1000) * 100) / 100;
      return {
        id: initialData.id,
        status: 'COMPLETED',
        output: initialData.output,
        executionTimeSec: duration,
      };
    }

    const jobId = initialData.id;
    this.logger.log(`Job ${jobId} queued (status: ${initialData.status}). Polling...`);

    const statusUrl = `https://api.runpod.ai/v2/${cleanEndpoint}/status/${jobId}`;

    while (Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const pollRes = await fetch(statusUrl, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!pollRes.ok) {
        continue;
      }

      const pollData = (await pollRes.json()) as { status: string; output?: TOutput; error?: string };

      if (pollData.status === 'COMPLETED') {
        const duration = Math.round(((Date.now() - startTime) / 1000) * 100) / 100;
        return {
          id: jobId,
          status: 'COMPLETED',
          output: pollData.output,
          executionTimeSec: duration,
        };
      }

      if (pollData.status === 'FAILED') {
        throw new Error(`RunPod job ${jobId} failed: ${pollData.error || 'Unknown worker error'}`);
      }
    }

    throw new Error(`RunPod job ${jobId} timed out after ${timeout / 1000}s`);
  }
}
