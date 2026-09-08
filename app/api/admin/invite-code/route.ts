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

    const admin = createAdminClient();
    const { data: org, error } = await admin
      .from('organizations')
      .select('id, name, invite_code, created_at')
      .eq('id', profile.organization_id)
      .single();

    if (error || !org) throw (error || new Error('Organization not found'));

    return NextResponse.json({ organization: org });
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

    const admin = createAdminClient();
    const newInviteCode = Math.random().toString(36).substring(2, 10);

    const { data: updatedOrg, error } = await admin
      .from('organizations')
      .update({ invite_code: newInviteCode })
      .eq('id', profile.organization_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      invite_code: updatedOrg.invite_code,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
