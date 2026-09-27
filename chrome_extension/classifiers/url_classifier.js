/**
 * 12-Category Classifier for Web Domains with Fallback & Productivity Mapping
 */
const DOMAIN_CATEGORIES = {
  // 1. DEVELOPMENT (Productive)
  "github.com": "DEVELOPMENT",
  "gitlab.com": "DEVELOPMENT",
  "stackoverflow.com": "DEVELOPMENT",
  "developer.mozilla.org": "DEVELOPMENT",
  "npmjs.com": "DEVELOPMENT",
  "pypi.org": "DEVELOPMENT",
  "codepen.io": "DEVELOPMENT",
  "replit.com": "DEVELOPMENT",
  "leetcode.com": "DEVELOPMENT",
  "hackerrank.com": "DEVELOPMENT",
  "kaggle.com": "DEVELOPMENT",
  "huggingface.co": "DEVELOPMENT",
  "gemini.google.com": "DEVELOPMENT",
  "aistudio.google.com": "DEVELOPMENT",
  "chatgpt.com": "DEVELOPMENT",
  "chat.openai.com": "DEVELOPMENT",
  "claude.ai": "DEVELOPMENT",
  "perplexity.ai": "DEVELOPMENT",
  "deepseek.com": "DEVELOPMENT",
  "chat.deepseek.com": "DEVELOPMENT",
  "copilot.microsoft.com": "DEVELOPMENT",
  "v0.dev": "DEVELOPMENT",
  "poe.com": "DEVELOPMENT",

  // 2. PRODUCTIVE (Work / Productivity Tools)
  "docs.google.com": "PRODUCTIVE",
  "drive.google.com": "PRODUCTIVE",
  "notion.so": "PRODUCTIVE",
  "trello.com": "PRODUCTIVE",
  "asana.com": "PRODUCTIVE",
  "clickup.com": "PRODUCTIVE",
  "jira.atlassian.com": "PRODUCTIVE",
  "dropbox.com": "PRODUCTIVE",
  "linear.app": "PRODUCTIVE",

  // 3. EDUCATION (Productive)
  "coursera.org": "EDUCATION",
  "udemy.com": "EDUCATION",
  "edx.org": "EDUCATION",
  "khanacademy.org": "EDUCATION",
  "medium.com": "EDUCATION",
  "dev.to": "EDUCATION",
  "arxiv.org": "EDUCATION",
  "wikipedia.org": "EDUCATION",
  "scholar.google.com": "EDUCATION",

  // 4. CREATIVE (Productive)
  "figma.com": "CREATIVE",
  "canva.com": "CREATIVE",
  "behance.net": "CREATIVE",
  "dribbble.com": "CREATIVE",
  "adobe.com": "CREATIVE",
  "unsplash.com": "CREATIVE",

  // 5. COMMUNICATION (Neutral)
  "mail.google.com": "COMMUNICATION",
  "outlook.live.com": "COMMUNICATION",
  "slack.com": "COMMUNICATION",
  "teams.microsoft.com": "COMMUNICATION",
  "discord.com": "COMMUNICATION",
  "web.whatsapp.com": "COMMUNICATION",
  "telegram.org": "COMMUNICATION",

  // 6. FINANCE (Neutral)
  "zerodha.com": "FINANCE",
  "groww.in": "FINANCE",
  "paypal.com": "FINANCE",
  "bankofamerica.com": "FINANCE",
  "chase.com": "FINANCE",
  "stripe.com": "FINANCE",

  // 7. SYSTEM / UTILITIES (Neutral)
  "google.com": "SYSTEM",
  "bing.com": "SYSTEM",
  "duckduckgo.com": "SYSTEM",
  "speedtest.net": "SYSTEM",

  // 8. NEWS_READING (Neutral)
  "bbc.com": "NEWS_READING",
  "cnn.com": "NEWS_READING",
  "hindustantimes.com": "NEWS_READING",
  "ndtv.com": "NEWS_READING",
  "thehindu.com": "NEWS_READING",
  "techcrunch.com": "NEWS_READING",
  "theverge.com": "NEWS_READING",
  "nytimes.com": "NEWS_READING",

  // 9. ENTERTAINMENT (Distracting)
  "youtube.com": "ENTERTAINMENT",
  "netflix.com": "ENTERTAINMENT",
  "hotstar.com": "ENTERTAINMENT",
  "twitch.tv": "ENTERTAINMENT",
  "primevideo.com": "ENTERTAINMENT",
  "spotify.com": "ENTERTAINMENT",
  "hulu.com": "ENTERTAINMENT",

  // 10. SOCIAL_MEDIA (Distracting)
  "facebook.com": "SOCIAL_MEDIA",
  "instagram.com": "SOCIAL_MEDIA",
  "twitter.com": "SOCIAL_MEDIA",
  "x.com": "SOCIAL_MEDIA",
  "linkedin.com": "SOCIAL_MEDIA",
  "reddit.com": "SOCIAL_MEDIA",
  "tiktok.com": "SOCIAL_MEDIA",
  "snapchat.com": "SOCIAL_MEDIA",
  "pinterest.com": "SOCIAL_MEDIA",

  // 11. GAMING (Distracting)
  "store.steampowered.com": "GAMING",
  "ign.com": "GAMING",
  "epicgames.com": "GAMING",
  "roblox.com": "GAMING",
  "twitch.com": "GAMING",
  "chess.com": "GAMING",

  // 12. SHOPPING (Distracting)
  "amazon.com": "SHOPPING",
  "amazon.in": "SHOPPING",
  "flipkart.com": "SHOPPING",
  "ebay.com": "SHOPPING",
  "myntra.com": "SHOPPING",
  "meesho.com": "SHOPPING",
  "aliexpress.com": "SHOPPING"
};

const CATEGORY_PRODUCTIVITY = {
  "PRODUCTIVE": "PRODUCTIVE",
  "DEVELOPMENT": "PRODUCTIVE",
  "EDUCATION": "PRODUCTIVE",
  "CREATIVE": "PRODUCTIVE",
  "COMMUNICATION": "NEUTRAL",
  "FINANCE": "NEUTRAL",
  "SYSTEM": "NEUTRAL",
  "NEWS_READING": "NEUTRAL",
  "ENTERTAINMENT": "DISTRACTING",
  "SOCIAL_MEDIA": "DISTRACTING",
  "GAMING": "DISTRACTING",
  "SHOPPING": "DISTRACTING"
};

// Known educational & technology YouTube channels or creators
const EDUCATIONAL_CHANNELS = [
  "freecodecamp", "mit opencourseware", "harvard cs50", "stanford",
  "traversy media", "fireship", "3blue1brown", "khan academy", "veritasium",
  "lex fridman", "andrew ng", "statquest", "corey schafer", "techlead",
  "kevin powell", "web dev simplified", "hugging face", "sentdex",
  "geeksforgeeks", "edureka", "simplilearn", "programming with mosh",
  "clever programmer", "amigoscode", "the net ninja", "academind"
];

// Educational keywords in video titles
const EDUCATIONAL_KEYWORDS = [
  "tutorial", "course", "lecture", "explained", "crash course", "how to build",
  "how to code", "how to create", "how to install", "how to use", "how to",
  "learn ", "learning", "guide", "full stack", "data science", "machine learning",
  "deep learning", "artificial intelligence", "algorithms", "data structures",
  "python", "javascript", "typescript", "react", "nextjs", "next.js", "vue", "angular",
  "django", "fastapi", "flask", "golang", "c++", "c#", "rust", "sql", "database",
  "calculus", "linear algebra", "physics", "chemistry", "biology", "system design",
  "roadmap", "documentation", "walkthrough", "step by step", "masterclass",
  "bootcamp", "coding", "programming", "developer", "development", "devops",
  "docker", "kubernetes", "aws", "cloud", "git", "github", "linux", "bash",
  "study with me", "exam preparation", "cs50", "khan academy", "freecodecamp"
];

// Entertainment keywords in video titles
const ENTERTAINMENT_KEYWORDS = [
  "song", "music", "audio", "track", "album", "remix", "lyrics", "official video",
  "official audio", "music video", "feat", "ft.", "prod.", "lofi", "slowed", "reverb",
  "gameplay", "walkthrough part", "let's play", "reaction", "prank", "vlog",
  "trailer", "teaser", "funny moments", "fails", "stream highlights", "highlights",
  "stand up comedy", "standup", "roast", "parody", "tiktok compilation", "meme",
  "movie", "film", "cinema", "episode", "season", "drama", "anime", "gaming", "fortnite",
  "minecraft", "gta", "pubg", "valorant", "unboxing", "review", "podcast", "comedy",
  "singer", "dj ", "band", "live performance", "concert", "pop", "hip hop", "rap"
];

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

function classifyYouTube(url, pageTitle, channelName = "") {
  const urlLower = (url || "").toLowerCase();
  const rawTitle = (pageTitle || "").trim();
  // Strip notification counts like "(9) " and " - YouTube" suffix
  const cleanTitle = rawTitle
    .replace(/^\(\d+\)\s*/, "")
    .replace(/ - YouTube$/i, "")
    .trim()
    .toLowerCase();
  const channelLower = (channelName || "").toLowerCase();

  // 1. YouTube Shorts or pure feed/homepage
  if (urlLower.includes("/shorts/")) {
    return {
      category: "ENTERTAINMENT",
      productivity_label: "DISTRACTING",
      confidence_score: 0.98,
      is_fallback: false
    };
  }

  if (urlLower === "https://www.youtube.com/" || urlLower === "https://youtube.com/" || urlLower.includes("/feed/")) {
    return {
      category: "ENTERTAINMENT",
      productivity_label: "DISTRACTING",
      confidence_score: 0.95,
      is_fallback: false
    };
  }

  // 2. Educational Channel match
  if (channelLower && EDUCATIONAL_CHANNELS.some(c => channelLower.includes(c))) {
    const isDev = ["code", "python", "javascript", "react", "programming", "sql", "api", "git", "web dev", "django", "fastapi"].some(k => cleanTitle.includes(k));
    return {
      category: isDev ? "DEVELOPMENT" : "EDUCATION",
      productivity_label: "PRODUCTIVE",
      confidence_score: 0.95,
      is_fallback: false
    };
  }

  // 3. Keyword checks in video title
  const hasEduKeyword = EDUCATIONAL_KEYWORDS.some(k => cleanTitle.includes(k));
  const hasEntKeyword = ENTERTAINMENT_KEYWORDS.some(k => cleanTitle.includes(k));

  // If educational and no explicit entertainment keywords, classify as PRODUCTIVE
  if (hasEduKeyword && !hasEntKeyword) {
    const isDev = ["code", "python", "javascript", "typescript", "react", "programming", "sql", "api", "git", "web dev", "django", "fastapi", "docker", "algorithm", "data structure", "css", "html"].some(k => cleanTitle.includes(k));
    return {
      category: isDev ? "DEVELOPMENT" : "EDUCATION",
      productivity_label: "PRODUCTIVE",
      confidence_score: 0.9,
      is_fallback: false
    };
  }

  // 4. Default for normal YouTube videos (including songs, music, artist tracks, entertainment):
  // YouTube is an entertainment media platform by default; non-educational videos are DISTRACTING!
  return {
    category: "ENTERTAINMENT",
    productivity_label: "DISTRACTING",
    confidence_score: 0.9,
    is_fallback: false
  };
}

function classifyDomain(domain, pageTitle = "", url = "", channelName = "") {
  // Special Dynamic Handler: YouTube
  if (domain === "youtube.com" || domain.endsWith(".youtube.com")) {
    return classifyYouTube(url, pageTitle, channelName);
  }

  // Exact match
  if (DOMAIN_CATEGORIES[domain]) {
    const category = DOMAIN_CATEGORIES[domain];
    return {
      category,
      productivity_label: CATEGORY_PRODUCTIVITY[category] || "NEUTRAL",
      confidence_score: 1.0,
      is_fallback: false
    };
  }

  // Suffix/Subdomain match
  for (const [key, category] of Object.entries(DOMAIN_CATEGORIES)) {
    if (domain.endsWith("." + key) || domain === key) {
      return {
        category,
        productivity_label: CATEGORY_PRODUCTIVITY[category] || "NEUTRAL",
        confidence_score: 0.95,
        is_fallback: false
      };
    }
  }

  // Keyword check on domain & pageTitle
  const combined = (domain + " " + (pageTitle || "")).toLowerCase();
  if (combined.includes("code") || combined.includes("dev") || combined.includes("api") || combined.includes("git")) {
    return { category: "DEVELOPMENT", productivity_label: "PRODUCTIVE", confidence_score: 0.75, is_fallback: true };
  }
  if (combined.includes("shop") || combined.includes("store") || combined.includes("cart") || combined.includes("buy")) {
    return { category: "SHOPPING", productivity_label: "DISTRACTING", confidence_score: 0.75, is_fallback: true };
  }
  if (combined.includes("movie") || combined.includes("video") || combined.includes("watch") || combined.includes("stream")) {
    return { category: "ENTERTAINMENT", productivity_label: "DISTRACTING", confidence_score: 0.75, is_fallback: true };
  }
  if (combined.includes("game") || combined.includes("play")) {
    return { category: "GAMING", productivity_label: "DISTRACTING", confidence_score: 0.75, is_fallback: true };
  }

  // Default unknown
  return {
    category: "SYSTEM",
    productivity_label: "NEUTRAL",
    confidence_score: 0.5,
    is_fallback: true
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DOMAIN_CATEGORIES, CATEGORY_PRODUCTIVITY, extractDomain, classifyDomain, classifyYouTube };
}
