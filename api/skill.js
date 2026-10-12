/**
 * ============================================================
 * 카카오톡 채널 AI 챗봇 스킬 서버 (Vercel 버전)
 * ============================================================
 * 기능: AI 대화 (Gemini) + 날씨 (OpenWeatherMap)
 *
 * ⚠️ Vercel은 응답 후 백그라운드 작업을 보장하지 않아
 *    카카오 스킬 콜백 대신 "동기 응답" 방식으로 동작합니다.
 *    (Gemini 호출에 4.5초 타임아웃을 걸어 카카오 5초 제한 대비)
 *
 * 배포 방법:
 *  1. https://vercel.com 가입 (이메일 또는 GitHub, 카드 불필요)
 *  2. New Project → 이 폴더(vercel/)를 업로드 (또는 Git 저장소 연동)
 *  3. Project → Settings → Environment Variables 등록
 *
 * 필요한 환경 변수:
 *  - GEMINI_API_KEY  (필수) https://aistudio.google.com/apikey
 *  - OWM_API_KEY     (선택) https://home.openweathermap.org/api_keys
 *  - ALLOWED_BOT_ID  (선택) 오픈빌더 봇 ID로 요청 제한
 * ============================================================
 */

// ---- 설정 (필요시 수정) --------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `당신은 카카오톡 채널의 친절한 AI 어시스턴트입니다.
- 한국어로 자연스럽고 친근하게 답변하세요.
- 답변은 반드시 700자 이내로 간결하게 작성하세요 (카카오톡 메시지 길이 제한).
- 이모지를 적절히 사용해도 좋습니다.`;

const CITY_MAP = {
  "서울": "Seoul", "부산": "Busan", "인천": "Incheon", "대구": "Daegu",
  "대전": "Daejeon", "광주": "Gwangju", "울산": "Ulsan", "세종": "Sejong",
  "제주": "Jeju", "수원": "Suwon", "성남": "Seongnam", "고양": "Goyang",
  "용인": "Yongin", "창원": "Changwon", "청주": "Cheongju", "전주": "Jeonju",
  "천안": "Cheonan", "포항": "Pohang", "경주": "Gyeongju", "강릉": "Gangneung",
  "춘천": "Chuncheon", "원주": "Wonju", "여수": "Yeosu", "순천": "Suncheon",
  "목포": "Mokpo", "거제": "Geoje", "김해": "Gimhae", "평택": "Pyeongtaek",
  "안양": "Anyang", "안산": "Ansan", "파주": "Paju", "충주": "Chungju",
};

const HELP_TEXT = `🤖 사용 방법

• 아무 말이나 걸면 AI가 대답해요
• "서울 날씨" 처럼 지역+날씨를 물어보면 실시간 날씨를 알려줘요`;

// ---- Vercel 환경 변수 ----------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OWM_API_KEY = process.env.OWM_API_KEY || "";
const ALLOWED_BOT_ID = process.env.ALLOWED_BOT_ID || "";

// ---- 진입점 ---------------------------------------------------

module.exports = async function handler(req, res) {
  // 헬스 체크용 (브라우저로 접속하면 이 메시지가 보임)
  if (req.method === "GET") {
    return res.status(200).send("✅ 카카오톡 AI 챗봇 스킬 서버가 정상 작동 중입니다.");
  }
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const body = req.body; // Vercel이 JSON을 자동 파싱

  // (선택) 우리 봇에서 온 요청인지 확인
  if (ALLOWED_BOT_ID && body?.bot?.id !== ALLOWED_BOT_ID) {
    return res.status(403).send("Forbidden");
  }

  const utterance = body?.userRequest?.utterance ?? "";

  // 카카오 5초 제한 대비: Gemini 호출에 4.5초 타임아웃
  const reply = await withTimeout(
    generateReply(utterance),
    4500,
    "AI가 조금 느려지고 있어요 😥 잠시 후 다시 말씀해 주세요."
  );

  return res.status(200).json(kakaoText(reply, true));
};

// ---- 유틸 ------------------------------------------------------

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- 기능 라우팅 ----------------------------------------------

async function generateReply(utterance) {
  const text = (utterance || "").trim();

  if (!text) {
    return "텍스트 메시지로 말씀해 주시면 답변해 드릴게요! 😊";
  }

  // 도움말
  if (["도움말", "도움", "사용법", "/도움말"].includes(text)) {
    return HELP_TEXT;
  }

  // 날씨
  if (text.includes("날씨")) {
    return await getWeatherReply(text);
  }

  // 그 외 → AI 대화
  return await getGeminiReply(text);
}

// ---- 날씨 (OpenWeatherMap) -------------------------------------

async function getWeatherReply(utterance) {
  if (!OWM_API_KEY) {
    return "날씨 기능이 아직 설정되지 않았어요. (OWM_API_KEY 환경 변수 필요)";
  }

  const cityKo = Object.keys(CITY_MAP).find((c) => utterance.includes(c));
  if (!cityKo) {
    return "어느 지역 날씨가 궁금하세요? 🗺️\n예) 서울 날씨, 부산 날씨, 제주 날씨";
  }

  const url =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?q=${encodeURIComponent(CITY_MAP[cityKo])},KR` +
    `&appid=${OWM_API_KEY}&units=metric&lang=kr`;

  const resp = await fetch(url);
  if (!resp.ok) {
    return `${cityKo}의 날씨 정보를 가져오지 못했어요 😥`;
  }
  const d = await resp.json();

  const desc = d.weather?.[0]?.description ?? "정보 없음";
  const temp = Math.round(d.main?.temp);
  const feels = Math.round(d.main?.feels_like);
  const humidity = d.main?.humidity;

  return (
    `🌤️ ${cityKo} 현재 날씨\n\n` +
    `• 날씨: ${desc}\n` +
    `• 기온: ${temp}°C (체감 ${feels}°C)\n` +
    `• 습도: ${humidity}%`
  );
}

// ---- AI 대화 (Gemini) ------------------------------------------

async function getGeminiReply(utterance) {
  if (!GEMINI_API_KEY) {
    return "AI 기능이 아직 설정되지 않았어요. (GEMINI_API_KEY 환경 변수 필요)";
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: utterance }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 600 },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Gemini API 오류:", resp.status, errText);
    if (resp.status === 429) {
      return "지금 대화가 몰려서 잠시 쉬어야 해요 😥 1분 뒤에 다시 말 걸어주세요.";
    }
    return "AI 응답을 가져오지 못했어요 😥 잠시 후 다시 시도해 주세요.";
  }

  const data = await resp.json();
  const reply =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim() ||
    "응답을 생성하지 못했어요.";

  return reply;
}

// ---- 카카오 응답 포맷 -------------------------------------------

function kakaoText(text, withQuickReplies = false) {
  const res = {
    version: "2.0",
    template: {
      // simpleText는 최대 1000자 제한
      outputs: [{ simpleText: { text: text.slice(0, 1000) } }],
    },
  };
  if (withQuickReplies) {
    res.template.quickReplies = [
      { action: "message", label: "🌤️ 서울 날씨", messageText: "서울 날씨" },
      { action: "message", label: "❓ 도움말", messageText: "도움말" },
    ];
  }
  return res;
}
