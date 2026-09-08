import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
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
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: documents, error: docsError } = await admin
      .from('documents')
      .select(`
        id,
        title,
        status,
        storage_path,
        created_at,
        document_chunks(count)
      `)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false });

    if (docsError) {
      return NextResponse.json({ error: docsError.message }, { status: 500 });
    }

    const formatted = (documents || []).map((doc: any) => ({
      id: doc.id,
      title: doc.title,
      status: doc.status,
      storage_path: doc.storage_path,
      created_at: doc.created_at,
      chunkCount: doc.document_chunks?.[0]?.count || 0,
    }));

    return NextResponse.json({ documents: formatted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('id');

    if (!documentId) {
      return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin' || !profile?.organization_id) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const admin = createAdminClient();

    // Get document storage path to remove from storage bucket
    const { data: doc } = await admin
      .from('documents')
      .select('storage_path')
      .eq('id', documentId)
      .eq('organization_id', profile.organization_id)
      .single();

    if (doc?.storage_path) {
      await admin.storage.from('coach-documents').remove([doc.storage_path]);
    }

    // Delete document (document_chunks cascade on delete)
    const { error: deleteError } = await admin
      .from('documents')
      .delete()
      .eq('id', documentId)
      .eq('organization_id', profile.organization_id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
