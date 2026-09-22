import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processDocumentBatch, failDocument } from '@/lib/ingestion';

export const maxDuration = 30;

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
    const { documentId, batchSize = 25 } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId parameter' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify document belongs to this admin's organization
    const { data: doc, error: docErr } = await admin
      .from('documents')
      .select('id, organization_id')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (doc.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: 'Security Violation: Cross-tenant document access denied' }, { status: 403 });
    }

    const result = await processDocumentBatch(documentId, batchSize, admin);

    if (result.status === 'failed') {
      return NextResponse.json({
        error: result.error || 'Failed to process document batch',
        ...result,
      }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Batch process route unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server failure' }, { status: 500 });
  }
}
