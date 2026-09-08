import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: request, error } = await admin
      .from('invite_requests')
      .select('status, organization_id, organizations(name)')
      .eq('email', email.trim().toLowerCase())
      .order('requested_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !request) {
      return NextResponse.json({ status: 'not_found' });
    }

    return NextResponse.json({
      status: request.status,
      academyName: (request.organizations as any)?.name || 'Cricket Academy',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
