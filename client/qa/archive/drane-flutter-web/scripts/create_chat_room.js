// Creates a chat room between client and review-operator so 채팅목록 shows real data
const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';

const CLIENT_EMAIL    = 'review-client@modedrone.kr';
const OPERATOR_EMAIL  = 'review-operator@modedrone.kr';
const PASSWORD        = 'Review2026!';

const CLIENT_USER_ID   = '4c58bfa3-ece9-4782-873e-47e1b34543c4';
const OPERATOR_USER_ID = '8e209738-89ff-4559-84c2-3beba19081e8';

async function fetch_(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

async function login(email) {
  const r = await fetch_('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.body.access_token) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.access_token;
}

async function main() {
  const clientToken = await login(CLIENT_EMAIL);
  console.log('Logged in as client');

  // 1. List existing chat_rooms to understand schema
  console.log('\n1. Checking chat_rooms table...');
  const existing = await fetch_('/rest/v1/chat_rooms?limit=5', {
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  console.log('Status:', existing.status);
  console.log('Existing rooms:', JSON.stringify(existing.body).slice(0, 500));

  // 2. Check columns by listing with select=*
  const schema = await fetch_('/rest/v1/chat_rooms?select=*&limit=1', {
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  console.log('\nSchema sample:', JSON.stringify(schema.body).slice(0, 500));

  // 3. Try to create a chat room
  console.log('\n2. Creating chat room...');
  const createResult = await fetch_('/rest/v1/chat_rooms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      client_id: CLIENT_USER_ID,
      operator_id: OPERATOR_USER_ID,
    }),
  });
  console.log('Create status:', createResult.status);
  console.log('Create result:', JSON.stringify(createResult.body).slice(0, 500));

  if (createResult.status >= 400) {
    // Try different column names
    console.log('\nTrying with user_id1/user_id2...');
    const r2 = await fetch_('/rest/v1/chat_rooms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}`, Prefer: 'return=representation' },
      body: JSON.stringify({ user_id1: CLIENT_USER_ID, user_id2: OPERATOR_USER_ID }),
    });
    console.log('Status:', r2.status, JSON.stringify(r2.body).slice(0, 300));

    console.log('\nTrying with participant_ids...');
    const r3 = await fetch_('/rest/v1/chat_rooms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}`, Prefer: 'return=representation' },
      body: JSON.stringify({ participant_ids: [CLIENT_USER_ID, OPERATOR_USER_ID] }),
    });
    console.log('Status:', r3.status, JSON.stringify(r3.body).slice(0, 300));
  } else {
    const roomId = createResult.body[0]?.id || createResult.body?.id;
    if (roomId) {
      console.log(`\n✅ Chat room created: ${roomId}`);
      // Send a message in the room
      console.log('3. Sending initial message...');
      const msgResult = await fetch_('/rest/v1/chat_messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientToken}`, Prefer: 'return=representation' },
        body: JSON.stringify({
          room_id: roomId,
          sender_id: CLIENT_USER_ID,
          content: '안녕하세요! 항공촬영 견적 관련해서 문의드립니다.',
        }),
      });
      console.log('Message result:', JSON.stringify(msgResult.body).slice(0, 300));
    }
  }
}

main().catch(console.error);
