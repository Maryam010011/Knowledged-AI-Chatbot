import path from 'path';
import fs from 'fs';
import { extractTextFromPdfBuffer } from '@/lib/pdf';
import { chunkText } from '@/lib/chunking';
import { generateEmbedding } from '@/lib/embeddings';

export interface ChunkItem {
  content: string;
  metadata: Record<string, any>;
}

export interface DocumentJob {
  documentId: string;
  organizationId: string;
  title: string;
  totalPages: number;
  totalChunks: number;
  chunks: ChunkItem[];
}

export interface BatchProcessResult {
  done: boolean;
  totalChunks: number;
  processedChunks: number;
  status: 'processing' | 'ready' | 'failed';
  error?: string;
}

/**
 * Prepares the chunking job for a given document and persists the manifest
 * in Supabase Storage under _jobs/${documentId}.json.
 */
export async function prepareDocumentJob(documentId: string, adminClient: any): Promise<DocumentJob> {
  const { data: doc, error: docErr } = await adminClient
    .from('documents')
    .select('id, organization_id, title, storage_path, status')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) {
    throw new Error(`Document record not found: ${docErr?.message || documentId}`);
  }

  let pdfBuffer: Buffer | null = null;

  // 1. Try downloading from Supabase storage
  if (doc.storage_path) {
    const { data: downloadData, error: downloadError } = await adminClient.storage
      .from('coach-documents')
      .download(doc.storage_path);

    if (downloadData && !downloadError) {
      pdfBuffer = Buffer.from(await downloadData.arrayBuffer());
    }
  }

  // 2. Fallback to local data/ directory if seeded document
  if (!pdfBuffer || pdfBuffer.length === 0) {
    const localPath = path.join(process.cwd(), 'data', doc.title);
    if (fs.existsSync(localPath)) {
      pdfBuffer = fs.readFileSync(localPath);
    }
  }

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error(`Could not locate PDF file in storage or local directory for document: ${doc.title}`);
  }

  // Extract text and chunk
  const extracted = await extractTextFromPdfBuffer(pdfBuffer);
  if (!extracted.text || extracted.text.trim().length === 0) {
    throw new Error('No readable text found in PDF (file may contain only scanned images without OCR).');
  }

  const rawChunks = chunkText(extracted.text, 220, 40);
  if (rawChunks.length === 0) {
    throw new Error('Could not create chunks from extracted text.');
  }

  const jobData: DocumentJob = {
    documentId: doc.id,
    organizationId: doc.organization_id,
    title: doc.title,
    totalPages: extracted.numpages,
    totalChunks: rawChunks.length,
    chunks: rawChunks.map((c, index) => ({
      content: c.content,
      metadata: {
        ...c.metadata,
        chunkIndex: index,
        title: doc.title,
        totalPages: extracted.numpages,
      },
    })),
  };

  // Upload job manifest to storage
  const jobPath = `_jobs/${documentId}.json`;
  const { error: uploadError } = await adminClient.storage
    .from('coach-documents')
    .upload(jobPath, Buffer.from(JSON.stringify(jobData)), {
      contentType: 'application/json',
      upsert: true,
    });

  if (uploadError) {
    console.warn(`Warning saving job manifest to storage: ${uploadError.message}`);
  }

  return jobData;
}

/**
 * Retrieves the job manifest from storage, or creates it if not yet present.
 */
export async function getOrPrepareJob(documentId: string, adminClient: any): Promise<DocumentJob> {
  const jobPath = `_jobs/${documentId}.json`;
  const { data: jobDownload, error: jobErr } = await adminClient.storage
    .from('coach-documents')
    .download(jobPath);

  if (!jobErr && jobDownload) {
    try {
      const text = await jobDownload.text();
      const parsed = JSON.parse(text) as DocumentJob;
      if (parsed && Array.isArray(parsed.chunks) && parsed.totalChunks > 0) {
        return parsed;
      }
    } catch (parseErr) {
      console.warn(`Failed parsing cached job manifest for ${documentId}, regenerating:`, parseErr);
    }
  }

  return await prepareDocumentJob(documentId, adminClient);
}

/**
 * Processes a single batch of chunks (default 25) for a document.
 * Safe for serverless timeouts (~2 seconds per invocation).
 */
export async function processDocumentBatch(
  documentId: string,
  batchSize: number = 25,
  adminClient: any
): Promise<BatchProcessResult> {
  try {
    const { data: doc, error: docErr } = await adminClient
      .from('documents')
      .select('id, organization_id, title, status')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    const job = await getOrPrepareJob(documentId, adminClient);

    // Count how many chunks have already been inserted for this document
    const { count, error: countErr } = await adminClient
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', documentId);

    if (countErr) {
      throw new Error(`Failed to query existing chunks count: ${countErr.message}`);
    }

    const offset = count || 0;

    // Already complete?
    if (offset >= job.totalChunks) {
      await adminClient
        .from('documents')
        .update({ status: 'ready' })
        .eq('id', documentId);

      // Clean up job manifest
      await adminClient.storage.from('coach-documents').remove([`_jobs/${documentId}.json`]);

      return {
        done: true,
        totalChunks: job.totalChunks,
        processedChunks: job.totalChunks,
        status: 'ready',
      };
    }

    // Take next batch slice
    const slice = job.chunks.slice(offset, offset + batchSize);
    if (slice.length === 0) {
      await adminClient
        .from('documents')
        .update({ status: 'ready' })
        .eq('id', documentId);

      await adminClient.storage.from('coach-documents').remove([`_jobs/${documentId}.json`]);

      return {
        done: true,
        totalChunks: job.totalChunks,
        processedChunks: job.totalChunks,
        status: 'ready',
      };
    }

    // Generate embeddings for slice
    const chunkRows = [];
    for (const chunk of slice) {
      const embedding = await generateEmbedding(chunk.content);
      chunkRows.push({
        document_id: documentId,
        organization_id: job.organizationId,
        content: chunk.content,
        embedding: embedding,
        metadata: chunk.metadata,
      });
    }

    // Insert batch of chunks
    const { error: insertErr } = await adminClient
      .from('document_chunks')
      .insert(chunkRows);

    if (insertErr) {
      throw new Error(`Failed to insert document chunks batch: ${insertErr.message}`);
    }

    const newProcessed = offset + slice.length;
    const isDone = newProcessed >= job.totalChunks;

    if (isDone) {
      await adminClient
        .from('documents')
        .update({ status: 'ready' })
        .eq('id', documentId);

      await adminClient.storage.from('coach-documents').remove([`_jobs/${documentId}.json`]);

      return {
        done: true,
        totalChunks: job.totalChunks,
        processedChunks: job.totalChunks,
        status: 'ready',
      };
    }

    return {
      done: false,
      totalChunks: job.totalChunks,
      processedChunks: newProcessed,
      status: 'processing',
    };
  } catch (err: any) {
    await failDocument(documentId, err, adminClient);
    return {
      done: false,
      totalChunks: 0,
      processedChunks: 0,
      status: 'failed',
      error: err.message || 'Error processing document batch',
    };
  }
}

/**
 * Handles error reporting and marks the document as failed.
 */
export async function failDocument(documentId: string, error: any, adminClient: any): Promise<void> {
  console.error(`[Document Ingestion Error] Document ${documentId} failed:`, {
    message: error?.message || error,
    stack: error?.stack,
  });

  try {
    await adminClient
      .from('documents')
      .update({ status: 'failed' })
      .eq('id', documentId);
  } catch (updateErr) {
    console.error(`Failed to update status to failed for document ${documentId}:`, updateErr);
  }
}

/**
 * Resets a failed or stuck document to 'processing' and clears existing chunks
 * so ingestion can be cleanly re-run from scratch.
 */
export async function retryDocument(documentId: string, adminClient: any): Promise<DocumentJob> {
  // 1. Delete any existing chunks for this document
  const { error: delChunksErr } = await adminClient
    .from('document_chunks')
    .delete()
    .eq('document_id', documentId);

  if (delChunksErr) {
    console.warn(`Warning deleting old chunks for ${documentId}:`, delChunksErr.message);
  }

  // 2. Remove any cached job manifest to force fresh extraction
  await adminClient.storage.from('coach-documents').remove([`_jobs/${documentId}.json`]);

  // 3. Mark document back to 'processing'
  const { error: statusErr } = await adminClient
    .from('documents')
    .update({ status: 'processing' })
    .eq('id', documentId);

  if (statusErr) {
    throw new Error(`Failed to reset document status: ${statusErr.message}`);
  }

  // 4. Prepare fresh job
  return await prepareDocumentJob(documentId, adminClient);
}
