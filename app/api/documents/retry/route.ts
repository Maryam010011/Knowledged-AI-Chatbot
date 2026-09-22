import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { retryDocument, failDocument } from '@/lib/ingestion';

export const maxDuration = 60;

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

    const body = await req.json();
    const { documentId } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId parameter' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify document belongs to admin's organization
    const { data: doc, error: docErr } = await admin
      .from('documents')
      .select('id, organization_id, title')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (doc.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: 'Security Violation: Cross-tenant document access denied' }, { status: 403 });
    }

    try {
      const job = await retryDocument(documentId, admin);

      return NextResponse.json({
        success: true,
        documentId: job.documentId,
        title: job.title,
        totalChunks: job.totalChunks,
        processedChunks: 0,
        status: 'processing',
      });
    } catch (retryErr: any) {
      await failDocument(documentId, retryErr, admin);
      return NextResponse.json({
        error: retryErr.message || 'Failed to re-initialize document for ingestion',
        documentId,
        status: 'failed',
      }, { status: 500 });
    }
  } catch (err: any) {
    console.error('Retry route unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server failure' }, { status: 500 });
  }
}
