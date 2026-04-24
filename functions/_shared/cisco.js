const TOKEN_MARGIN_SECONDS = 60;
const AUTH_URL = "https://id.cisco.com/oauth2/default/v1/token";

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

export async function getAccessToken(env) {
  const now = Date.now() / 1000;
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = String(env.CLIENT_ID ?? "").trim();
  const clientSecret = String(env.CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Cloudflare Pages 환경 변수 CLIENT_ID 또는 CLIENT_SECRET 이 설정되지 않았습니다.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (response.status === 400 || response.status === 401) {
    throw new Error("인증 실패: CLIENT_ID/CLIENT_SECRET 또는 앱 권한을 확인하세요.");
  }
  if (response.status === 403) {
    throw new Error("권한 없음: Cisco Support API 접근 권한을 확인하세요.");
  }
  if (!response.ok) {
    throw new Error(`토큰 발급 HTTP 오류: ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("토큰 응답 JSON 파싱 실패");
  }

  const accessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in ?? 3600);
  if (!accessToken) {
    throw new Error("토큰 응답에 access_token 필드가 없습니다.");
  }

  tokenCache = {
    accessToken,
    expiresAt: now + Math.max(expiresIn - TOKEN_MARGIN_SECONDS, 0),
  };
  return accessToken;
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

