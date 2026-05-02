export type ViewId = "library" | "discover" | "player" | "progress" | "profile";

export const navItems: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: "library", label: "曲库", icon: "library_music" },
  { id: "discover", label: "发现", icon: "explore" },
  { id: "player", label: "歌词掌握", icon: "mic_external_on" },
  { id: "progress", label: "学习进度", icon: "analytics" },
];

export const featuredSong = {
  title: "Flowers",
  artist: "Miley Cyrus",
  note: "听力练习推荐",
  words: 42,
  cover:
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1800&q=80",
};

export const songs = [
  {
    title: "Blinding Lights",
    artist: "The Weeknd",
    cover:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "As It Was",
    artist: "Harry Styles",
    cover:
      "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=900&q=80",
  },
  {
    title: "Levitating",
    artist: "Dua Lipa",
    cover:
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80",
  },
];

export const vocabulary = [
  ["Ethereal", "/iˈθɪriəl/ · 缥缈的，超凡的"],
  ["Velocity", "/vəˈlɒsəti/ · 速率，速度"],
  ["Melancholy", "/ˈmelənkəli/ · 忧郁的，悲伤的"],
  ["Resonance", "/ˈrezənəns/ · 共鸣，反响"],
];

export const studyCurve = [
  { day: "周一", minutes: 32 },
  { day: "周二", minutes: 48 },
  { day: "周三", minutes: 39 },
  { day: "周四", minutes: 57 },
  { day: "周五", minutes: 46 },
  { day: "周六", minutes: 66 },
  { day: "周日", minutes: 52 },
  { day: "今天", minutes: 72 },
];

export const radarData = [
  { skill: "听辨", value: 92 },
  { skill: "词汇", value: 78 },
  { skill: "发音", value: 84 },
  { skill: "语法", value: 58 },
  { skill: "记忆", value: 88 },
];

export const profileStats = [
  { icon: "calendar_month", value: "128", label: "累计学习(天)", tone: "primary" },
  { icon: "sort_by_alpha", value: "1,450", label: "掌握单词", tone: "secondary" },
  { icon: "psychology", value: "320", label: "攻克难句", tone: "tertiary" },
  { icon: "favorite", value: "86", label: "收藏歌曲", tone: "primary" },
];

export const profileGroups = [
  {
    title: "我的学习",
    tone: "primary",
    items: [
      { icon: "library_music", label: "我的收藏" },
      { icon: "offline_pin", label: "离线词库" },
      { icon: "history", label: "学习历史" },
    ],
  },
  {
    title: "偏好设置",
    tone: "secondary",
    items: [
      { icon: "tune", label: "播放设置" },
      { icon: "subtitles", label: "歌词显示" },
      { icon: "speed", label: "难度偏好" },
    ],
  },
];
