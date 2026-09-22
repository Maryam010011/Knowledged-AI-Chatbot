import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { prepareDocumentJob, processDocumentBatch, failDocument } from '@/lib/ingestion';

export const maxDuration = 60; // Allow sufficient time for PDF parsing & initial batch

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin' || !profile?.organization_id) {
      return NextResponse.json({ error: 'Forbidden: Admin coaching access required' }, { status: 403 });
    }

    const orgId = profile.organization_id;
    const admin = createAdminClient();

    const contentType = req.headers.get('content-type') || '';
    let pdfBuffer: Buffer | null = null;
    let fileName = '';
    let storagePath = '';

    if (contentType.includes('application/json')) {
      // Direct Storage Ingestion Path (bypasses Vercel 4.5MB payload limit up to 50MB)
      const body = await req.json();
      storagePath = body.storagePath;
      fileName = body.title || 'Coaching Document.pdf';

      if (!storagePath) {
        return NextResponse.json({ error: 'Missing document storage path' }, { status: 400 });
      }

      // Security check: Enforce organization path prefix to prevent cross-tenant access
      if (!storagePath.startsWith(`${orgId}/`)) {
        return NextResponse.json(
          { error: 'Security Violation: Storage path does not belong to your academy organization.' },
          { status: 403 }
        );
      }

      // Download file buffer securely using service-role admin client
      const { data: downloadData, error: downloadError } = await admin.storage
        .from('coach-documents')
        .download(storagePath);

      if (downloadError || !downloadData) {
        return NextResponse.json(
          { error: `Failed to retrieve document from storage: ${downloadError?.message}` },
          { status: 400 }
        );
      }

      pdfBuffer = Buffer.from(await downloadData.arrayBuffer());
    } else {
      // Legacy FormData Upload Path (For files under 4.5MB)
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
      }

      if (!file.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ error: 'Only PDF documents are supported' }, { status: 400 });
      }

      const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // 4.5 MB
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: 'File size exceeds 4.5MB for direct upload. Larger files will be uploaded directly to storage.' },
          { status: 413 }
        );
      }

      fileName = file.name;
      pdfBuffer = Buffer.from(await file.arrayBuffer());
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      storagePath = `${orgId}/${Date.now()}_${sanitizedName}`;

      // Upload to Supabase Storage
      const { error: storageError } = await admin.storage
        .from('coach-documents')
        .upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (storageError) {
        console.warn('Storage upload warning:', storageError.message);
      }
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return NextResponse.json({ error: 'Empty or invalid PDF file buffer' }, { status: 400 });
    }

    // 1. Insert document record with 'processing'
    const { data: docRecord, error: docError } = await admin
      .from('documents')
      .insert({
        organization_id: orgId,
        title: fileName,
        storage_path: storagePath,
        uploaded_by: user.id,
        status: 'processing',
      })
      .select()
      .single();

    if (docError || !docRecord) {
      return NextResponse.json({ error: `Failed to create document record: ${docError?.message}` }, { status: 500 });
    }

    // 2. Prepare chunking job and process initial batch (e.g. 25 chunks)
    try {
      const job = await prepareDocumentJob(docRecord.id, admin);
      const batchResult = await processDocumentBatch(docRecord.id, 25, admin);

      return NextResponse.json({
        success: true,
        documentId: docRecord.id,
        title: docRecord.title,
        totalChunks: job.totalChunks,
        processedChunks: batchResult.processedChunks,
        done: batchResult.done,
        status: batchResult.status,
      });
    } catch (ingestError: any) {
      await failDocument(docRecord.id, ingestError, admin);

      return NextResponse.json({
        error: ingestError.message || 'Error processing document content',
        documentId: docRecord.id,
        status: 'failed',
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Upload route error:', error);
    return NextResponse.json({ error: error.message || 'Server upload failure' }, { status: 500 });
  }
}
