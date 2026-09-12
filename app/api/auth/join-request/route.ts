import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidEmail } from '@/lib/email-validator';

export async function POST(req: Request) {
  try {
    const { inviteCode, email, fullName, password } = await req.json();

    if (!inviteCode || !email) {
      return NextResponse.json(
        { error: 'Invite code and email are required.' },
        { status: 400 }
      );
    }

    // Email format and disposable domain rejection
    const validation = isValidEmail(email);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Verify organization exists for invite_code
    const { data: org, error: orgError } = await adminClient
      .from('organizations')
      .select('id, name')
      .eq('invite_code', inviteCode.trim())
      .single();

    if (orgError || !org) {
      return NextResponse.json(
        { error: 'Invalid or expired invite link. Please check with your coach.' },
        { status: 404 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();

    // 2. Check if an invite request already exists for this email and org
    const { data: existingRequest } = await adminClient
      .from('invite_requests')
      .select('id, status')
      .eq('organization_id', org.id)
      .eq('email', trimmedEmail)
      .order('requested_at', { ascending: false })
      .limit(1)
      .single();

    if (existingRequest) {
      if (existingRequest.status === 'accepted') {
        return NextResponse.json({
          status: 'accepted',
          message: 'Your request was already approved! Please sign in.',
        });
      }
      if (existingRequest.status === 'pending') {
        return NextResponse.json({
          status: 'pending',
          message: 'Your join request is already pending review by the coach.',
        });
      }
    }

    // 3. Create or register user
    // If password provided, register user directly
    if (password) {
      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: trimmedEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName || '',
          organization_id: org.id,
        }
      });

      if (authError && !authError.message.includes('already registered')) {
        return NextResponse.json({ error: authError.message }, { status: 400 });
      }

      const userId = authData?.user?.id;
      if (userId) {
        // Create initial profile: role is strictly 'member', organization_id is NULL until coach approves invite
        await adminClient.from('profiles').upsert({
          id: userId,
          organization_id: null,
          role: 'member',
          full_name: fullName || '',
        });
      }
    }

    // 4. Create pending invite_requests row
    const { data: newRequest, error: insertError } = await adminClient
      .from('invite_requests')
      .insert({
        organization_id: org.id,
        email: trimmedEmail,
        full_name: fullName || null,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to record join request: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'pending',
      organizationName: org.name,
      requestId: newRequest.id,
    });
  } catch (error: any) {
    console.error('Join request error:', error);
    return NextResponse.json(
      { error: error?.message || 'Server error processing join request' },
      { status: 500 }
    );
  }
}
