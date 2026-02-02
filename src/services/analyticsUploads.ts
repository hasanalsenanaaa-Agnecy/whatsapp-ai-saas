import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

export type ParsedUpload = {
  rowCount: number;
  columns: string[];
  sampleRows: Record<string, any>[];
  summary: Record<string, any>;
};

const s3Client = config.uploads.s3Bucket
  ? new S3Client({ region: config.uploads.s3Region || 'us-east-1' })
  : null;

export async function storeUploadFile(buffer: Buffer, filename: string): Promise<string> {
  const key = `analytics/${Date.now()}-${crypto.randomUUID()}-${filename}`;

  if (s3Client && config.uploads.s3Bucket) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.uploads.s3Bucket,
        Key: key,
        Body: buffer
      })
    );
    return key;
  }

  const uploadsDir = path.resolve(config.uploads.dir, 'analytics');
  await fs.mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, key.replace(/\//g, '_'));
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export function parseUpload(buffer: Buffer, mimeType: string): ParsedUpload {
  if (mimeType.includes('csv') || mimeType.includes('text/plain')) {
    const records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, any>[];

    return buildSummary(records);
  }

  if (mimeType.includes('json')) {
    const raw = JSON.parse(buffer.toString('utf-8'));
    const records = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.rows)
      ? raw.rows
      : Array.isArray(raw?.data)
      ? raw.data
      : [];

    if (!Array.isArray(records)) {
      throw new Error('Invalid JSON format');
    }

    return buildSummary(records as Record<string, any>[]);
  }

  throw new Error('Unsupported file type');
}

function buildSummary(records: Record<string, any>[]): ParsedUpload {
  const rowCount = records.length;
  const firstRecord = records[0];
  const columns = firstRecord ? Object.keys(firstRecord as Record<string, any>) : [];
  const sampleRows = records.slice(0, 25);

  const columnStats: Record<string, { nonEmpty: number; topValues: Array<{ value: string; count: number }> }> = {};

  for (const column of columns) {
    const counts = new Map<string, number>();
    let nonEmpty = 0;

    for (const row of records) {
      const value = row?.[column];
      if (value === null || value === undefined || value === '') {
        continue;
      }
      nonEmpty += 1;
      const normalized = String(value).slice(0, 80);
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    const topValues = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    columnStats[column] = { nonEmpty, topValues };
  }

  return {
    rowCount,
    columns,
    sampleRows,
    summary: {
      rowCount,
      columns,
      columnStats
    }
  };
}
