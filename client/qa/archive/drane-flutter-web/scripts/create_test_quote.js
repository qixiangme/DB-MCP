// Creates a test job_request from the client account to the review operator
// Run once to seed data so 내견적 and 받은요청 pages show real content

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';

const CLIENT_EMAIL = 'review-client@modedrone.kr';
const CLIENT_PASSWORD = 'Review2026!';

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  // 1. Sign in as client
  console.log('1. 클라이언트 로그인...');
  const auth = await supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: CLIENT_EMAIL, password: CLIENT_PASSWORD }),
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!auth.access_token) {
    console.error('로그인 실패:', JSON.stringify(auth));
    return;
  }
  const clientToken = auth.access_token;
  const clientId = auth.user.id;
  console.log(`   OK – user id: ${clientId}`);

  const authHeader = { 'Authorization': `Bearer ${clientToken}` };

  // 2. Get a service category id (항공촬영)
  console.log('2. 카테고리 조회...');
  const cats = await supabaseFetch(
    '/rest/v1/service_categories?label=eq.항공촬영&select=id&limit=1',
    { headers: authHeader },
  );
  const categoryId = Array.isArray(cats) && cats[0] ? cats[0].id : null;
  console.log(`   category id: ${categoryId}`);

  // 3. Get a region id (서울)
  console.log('3. 지역 조회...');
  const regions = await supabaseFetch(
    '/rest/v1/regions?name=eq.서울&select=id&limit=1',
    { headers: authHeader },
  );
  const regionId = Array.isArray(regions) && regions[0] ? regions[0].id : null;
  console.log(`   region id: ${regionId}`);

  // 4. Get the review operator's operator_profile id
  console.log('4. 운용자 프로필 조회...');
  const ops = await supabaseFetch(
    '/rest/v1/operator_profiles?select=id,user_id&limit=5',
    { headers: authHeader },
  );
  console.log('   operators:', JSON.stringify(ops).slice(0, 300));

  if (!Array.isArray(ops) || ops.length === 0) {
    console.error('운용자 없음 – RLS로 막힐 수 있음');
    return;
  }
  const operatorId = ops[0].id;
  console.log(`   using operator id: ${operatorId}`);

  // 5. Insert job_request
  console.log('5. 견적 요청 생성...');
  const job = await supabaseFetch('/rest/v1/job_requests', {
    method: 'POST',
    headers: {
      ...authHeader,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      client_id: clientId,
      category_id: categoryId,
      preferred_operator_id: operatorId,
      region_id: regionId,
      status: 'open',
      title: '서울 항공촬영 요청',
      detail: '건물 외관 항공 촬영이 필요합니다. 4K 해상도, 반일 작업 예정입니다.',
      location_label: '서울',
      budget_min: 300000,
      budget_max: 500000,
      contact_window: '평일 오전 10시~오후 6시',
      client_display_name: 'review-client',
      preferred_start_at: '2026-06-20T01:00:00Z',
    }),
  });
  console.log('   결과:', JSON.stringify(job).slice(0, 400));

  if (Array.isArray(job) && job[0]?.id) {
    console.log(`\n✅ 견적 생성 완료 – job_request id: ${job[0].id}`);
  } else {
    console.log('\n⚠️  응답 확인 필요:', JSON.stringify(job));
  }
}

main().catch(console.error);
