import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const envFile = path.join(rootDir, '.env.local');
const envContent = fs.readFileSync(envFile, 'utf-8');
const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
const anonKey = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim();
const serviceRole = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim();

const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

async function runAudit() {
  console.log('================================================================');
  console.log('       TESTING SINGLE-ADMIN RULE & PRIVILEGE ESCALATION         ');
  console.log('================================================================\n');

  // 1. Get Elite Academy
  const { data: eliteOrg } = await admin
    .from('organizations')
    .select('id, name')
    .eq('name', 'Elite Academy')
    .single();

  console.log(`[TARGET ACADEMY] Name: "${eliteOrg.name}", ID: ${eliteOrg.id}`);

  // Check current admin
  const { data: existingAdmins } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('organization_id', eliteOrg.id)
    .eq('role', 'admin');

  console.log(`[CURRENT ADMINS] Count: ${existingAdmins.length}, Existing Admin: "${existingAdmins[0]?.full_name}" (${existingAdmins[0]?.id})`);

  // 2. Create a REAL authenticated auth.users account for second admin attempt
  const testCoachEmail = `second_coach_${Date.now()}@example.com`;
  const { data: coachUser, error: coachUserErr } = await admin.auth.admin.createUser({
    email: testCoachEmail,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: 'Second Coach Candidate' }
  });

  if (coachUserErr || !coachUser?.user) {
    console.error('Failed to create auth user:', coachUserErr);
    return;
  }

  const newCoachId = coachUser.user.id;
  console.log(`[VALID AUTH USER CREATED] ID: ${newCoachId} (Email: ${testCoachEmail})`);

  // 3. Attempt SECOND admin insert into Elite Academy
  console.log('\n--- TEST A: Attempting to insert a SECOND admin into Elite Academy ---');
  const { data: insertResult, error: secondAdminErr } = await admin
    .from('profiles')
    .insert({
      id: newCoachId,
      organization_id: eliteOrg.id,
      role: 'admin',
      full_name: 'Second Coach Candidate'
    });

  if (secondAdminErr) {
    console.log(`PostgreSQL Error Code   : ${secondAdminErr.code}`);
    console.log(`PostgreSQL Error Message: ${secondAdminErr.message}`);
    console.log(`PostgreSQL Details      : ${secondAdminErr.details}`);
    if (secondAdminErr.code === '23505' || secondAdminErr.message.includes('idx_profiles_single_admin_per_org')) {
      console.log('>>> [PASS] SECOND ADMIN REJECTED SPECIFICALLY BY UNIQUE PARTIAL INDEX (idx_profiles_single_admin_per_org)!');
    } else {
      console.log(`>>> [FAIL] REJECTED BY OTHER ERROR: ${secondAdminErr.message}`);
    }
  } else {
    console.log('>>> [FAIL] Second admin was successfully inserted! (DB constraint idx_profiles_single_admin_per_org is NOT yet applied in PostgreSQL)');
    // Clean up
    await admin.from('profiles').delete().eq('id', newCoachId);
  }

  // 4. Create a REAL member and test client-side privilege escalation via Anon client
  console.log('\n--- TEST B: Member Role Escalation Test (Client-Side RLS) ---');
  const testMemberEmail = `member_escalation_${Date.now()}@example.com`;
  const { data: memberUser } = await admin.auth.admin.createUser({
    email: testMemberEmail,
    password: 'MemberPassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Member Escalation Probe' }
  });

  const memberId = memberUser?.user?.id;
  // Insert initial member profile
  await admin.from('profiles').insert({
    id: memberId,
    organization_id: eliteOrg.id,
    role: 'member',
    full_name: 'Regular Member'
  });

  // Sign in as member to get authenticated user session
  const memberClient = createClient(url, anonKey);
  const { data: memberSession, error: loginErr } = await memberClient.auth.signInWithPassword({
    email: testMemberEmail,
    password: 'MemberPassword123!'
  });

  if (loginErr) {
    console.error('Member login failed:', loginErr);
  } else {
    // Attempt to escalate role: 'member' -> 'admin'
    const { data: roleEscalateData, error: roleEscalateErr } = await memberClient
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', memberId)
      .select();

    console.log('Role escalation attempt result:', { roleEscalateData, error: roleEscalateErr?.message });

    // Check if role changed
    const { data: memberProfileAfter } = await admin.from('profiles').select('role, organization_id').eq('id', memberId).single();
    if (memberProfileAfter.role === 'admin') {
      console.log('>>> [FAIL] Member was able to escalate role to admin!');
    } else {
      console.log(`>>> [PASS] Member role remains "${memberProfileAfter.role}". Role escalation blocked!`);
    }

    // Attempt organization_id manipulation
    console.log('\n--- TEST C: Member Organization Manipulation Test (Client-Side RLS) ---');
    const fakeOrgId = '00000000-0000-0000-0000-000000000099';
    const { data: orgChangeData, error: orgChangeErr } = await memberClient
      .from('profiles')
      .update({ organization_id: fakeOrgId })
      .eq('id', memberId)
      .select();

    console.log('Org change attempt result:', { orgChangeData, error: orgChangeErr?.message });
    const { data: memberOrgAfter } = await admin.from('profiles').select('organization_id').eq('id', memberId).single();
    if (memberOrgAfter.organization_id === fakeOrgId) {
      console.log('>>> [FAIL] Member was able to alter organization_id!');
    } else {
      console.log(`>>> [PASS] Member organization remains "${memberOrgAfter.organization_id}". Org manipulation blocked!`);
    }
  }

  // 5. Multiple members test
  console.log('\n--- TEST D: Multiple Members for Same Academy ---');
  const testMember2Email = `member2_${Date.now()}@example.com`;
  const { data: member2User } = await admin.auth.admin.createUser({
    email: testMember2Email,
    password: 'MemberPassword123!',
    email_confirm: true
  });
  const { error: member2InsertErr } = await admin.from('profiles').insert({
    id: member2User.user.id,
    organization_id: eliteOrg.id,
    role: 'member',
    full_name: 'Second Valid Member'
  });
  if (!member2InsertErr) {
    console.log('>>> [PASS] Multiple members in the same academy are permitted and working properly.');
  } else {
    console.log('>>> [FAIL] Multiple members insert error:', member2InsertErr);
  }

  // Cleanup test users
  await admin.from('profiles').delete().eq('id', memberId);
  await admin.auth.admin.deleteUser(memberId);
  await admin.from('profiles').delete().eq('id', member2User.user.id);
  await admin.auth.admin.deleteUser(member2User.user.id);
  await admin.auth.admin.deleteUser(newCoachId);

  console.log('\n================================================================');
  console.log('                       AUDIT COMPLETE                           ');
  console.log('================================================================\n');
}

runAudit().catch(console.error);
