import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin' || !profile?.organization_id) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('status'); // 'pending' | 'all' | 'reviewed'

    const admin = createAdminClient();
    let query = admin
      .from('invite_requests')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('requested_at', { ascending: false });

    if (filter === 'pending') {
      query = query.eq('status', 'pending');
    } else if (filter === 'history') {
      query = query.neq('status', 'pending');
    }

    const { data: requests, error } = await query;
    if (error) throw error;

    return NextResponse.json({ requests: requests || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin' || !profile?.organization_id) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { requestId, action } = await req.json(); // action: 'accept' | 'reject'
    if (!requestId || !['accept', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Valid requestId and action required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Fetch invite request
    const { data: inviteReq, error: fetchErr } = await admin
      .from('invite_requests')
      .select('*')
      .eq('id', requestId)
      .eq('organization_id', profile.organization_id)
      .single();

    if (fetchErr || !inviteReq) {
      return NextResponse.json({ error: 'Invite request not found' }, { status: 404 });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    // 2. Update invite request status
    const { error: updateErr } = await admin
      .from('invite_requests')
      .update({
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', requestId);

    if (updateErr) throw updateErr;

    // 3. If accepted, ensure user profile is linked to org with 'member' role
    if (action === 'accept') {
      // Find auth user by email
      const { data: usersData } = await admin.auth.admin.listUsers();
      const matchedUser = usersData.users.find(u => u.email?.toLowerCase() === inviteReq.email.toLowerCase());

      if (matchedUser) {
        await admin.from('profiles').upsert({
          id: matchedUser.id,
          organization_id: profile.organization_id,
          role: 'member',
          full_name: inviteReq.full_name || matchedUser.user_metadata?.full_name || null,
        });
      }
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      requestId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
