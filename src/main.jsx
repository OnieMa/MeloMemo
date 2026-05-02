import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart, Bar, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { featuredSong, navItems, profileGroups, profileStats, radarData, songs, studyCurve, vocabulary } from "./data";
import { useMeloStore } from "./store";
import "./styles.css";

function parseLyrics(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = lines.flatMap((line, index) => {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();

    if (matches.length === 0) {
      return [{ id: `plain-${index}`, time: index * 4, text: line }];
    }

    return matches.map((match, matchIndex) => {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0"));
      return {
        id: `${index}-${matchIndex}`,
        time: minutes * 60 + seconds + fraction / 1000,
        text: text || "♪",
      };
    });
  });

  return parsed.sort((a, b) => a.time - b.time);
}

async function readTextFile(file) {
  return file.text();
}

function formatTime(value) {
  if (!Number.isFinite(value)) {
    return "0:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function Icon({ name, filled = false }) {
  return <span className={`material-symbols-outlined ${filled ? "filled" : ""}`}>{name}</span>;
}

function Header() {
  const { view, setView } = useMeloStore();
  return (
    <header className="shell-nav">
      <button className="icon-btn ghost mobile-only" aria-label="展开">
        <Icon name="expand_more" />
      </button>
      <button className="brand" onClick={() => setView("library")}>MeloMemo</button>
      <nav className="desktop-nav" aria-label="主导航">
        {navItems.map((item) => (
          <button key={item.id} className={`nav-link ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="nav-actions">
        <button className="icon-btn" aria-label="搜索"><Icon name="search" /></button>
        <button className={`icon-btn ${view === "profile" ? "active-icon" : ""}`} aria-label="个人中心" onClick={() => setView("profile")}><Icon name="person" filled={view === "profile"} /></button>
      </div>
    </header>
  );
}

function LibraryView() {
  const setView = useMeloStore((state) => state.setView);
  const setUploadedSong = useMeloStore((state) => state.setUploadedSong);
  const [uploadMessage, setUploadMessage] = useState("");

  const handleUpload = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const audioFile = form.elements.audio.files?.[0];
    const lyricFile = form.elements.lyrics.files?.[0];
    const coverFile = form.elements.cover.files?.[0];
    const title = form.elements.title.value.trim() || audioFile?.name?.replace(/\.[^/.]+$/, "") || "本地歌曲";
    const artist = form.elements.artist.value.trim() || "Local Artist";

    if (!audioFile || !lyricFile) {
      setUploadMessage("请选择歌曲文件和歌词文件。");
      return;
    }

    const lyricText = await readTextFile(lyricFile);
    const lyrics = parseLyrics(lyricText);

    if (lyrics.length === 0) {
      setUploadMessage("歌词文件没有可读取的内容。");
      return;
    }

    setUploadedSong({
      title,
      artist,
      audioUrl: URL.createObjectURL(audioFile),
      coverUrl: coverFile ? URL.createObjectURL(coverFile) : undefined,
      lyrics,
    });
    setUploadMessage("");
    form.reset();
  };

  return (
    <section className="view">
      <div className="hero">
        <img src={featuredSong.cover} alt="演唱会舞台上紫色灯光中的歌手" />
        <div className="hero-content">
          <span className="eyebrow">今日焦点</span>
          <h1>{featuredSong.title}</h1>
          <p>{featuredSong.artist} · {featuredSong.note} · 词汇量 +{featuredSong.words}</p>
          <div className="hero-actions">
            <button className="primary-btn" onClick={() => setView("player")}><Icon name="play_arrow" filled />立即学习</button>
            <button className="glass-btn">加入歌单</button>
          </div>
        </div>
      </div>
      <SectionHead title="分类探索" subtitle="根据你的学习目标选择最适合的曲目" action="查看全部" />
      <div className="category-grid">
        <CategoryCard icon="neurology" title="听歌识词" copy="在律动中快速建立词汇反射" feature />
        <CategoryCard icon="pace" title="慢速英语" copy="发音清晰，适合零基础" />
        <CategoryCard icon="trending_up" title="流行金曲" copy="榜单前沿，语料鲜活" />
      </div>
      <SectionHead title="热门推荐" subtitle="大家都在练的歌曲" />
      <div className="song-grid">
        {songs.map((song) => <SongCard key={song.title} song={song} />)}
        <article className="song-card soundtrack">
          <Icon name="movie" />
          <strong>更多影视原声</strong>
          <button className="mini-btn">立即查看</button>
          <h3>影视原声</h3>
          <p>Soundtracks</p>
        </article>
      </div>

      <section className="upload-studio">
        <div>
          <span className="eyebrow dark">Local Studio</span>
          <h2>上传本地歌曲</h2>
          <p>支持上传音频、LRC/文本歌词和封面图。上传后会进入播放页，歌词会跟随播放进度滚动。</p>
        </div>
        <form className="upload-form" onSubmit={handleUpload}>
          <label>
            <span>歌曲名称</span>
            <input name="title" type="text" placeholder="例如：My Song" />
          </label>
          <label>
            <span>歌手</span>
            <input name="artist" type="text" placeholder="例如：Local Artist" />
          </label>
          <label>
            <span>歌曲文件</span>
            <input name="audio" type="file" accept="audio/*" />
          </label>
          <label>
            <span>歌词文件</span>
            <input name="lyrics" type="file" accept=".lrc,.txt,text/plain" />
          </label>
          <label>
            <span>封面图</span>
            <input name="cover" type="file" accept="image/*" />
          </label>
          <button className="primary-btn" type="submit"><Icon name="upload_file" />上传并播放</button>
          {uploadMessage && <p className="form-message">{uploadMessage}</p>}
        </form>
      </section>
    </section>
  );
}

function SectionHead({ title, subtitle, action }) {
  return (
    <section className="section-head">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {action && <button className="text-btn">{action}<Icon name="chevron_right" /></button>}
    </section>
  );
}

function CategoryCard({ icon, title, copy, feature = false }) {
  return <article className={`category-card ${feature ? "feature" : ""}`}><Icon name={icon} /><h3>{title}</h3><p>{copy}</p></article>;
}

function SongCard({ song }) {
  const setView = useMeloStore((state) => state.setView);
  return (
    <article className="song-card">
      <img src={song.cover} alt={`${song.title} 专辑氛围图`} />
      <button aria-label={`播放 ${song.title}`} onClick={() => setView("player")}><Icon name="play_circle" filled /></button>
      <h3>{song.title}</h3>
      <p>{song.artist}</p>
    </article>
  );
}

function PlayerView() {
  const { activeWord, isPlaying, isRecording, setPlaying, togglePlaying, toggleRecording, toggleWord, saveWord, savedWords, uploadedSong } = useMeloStore();
  const audioRef = useRef(null);
  const activeLyricRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(225);
  const isEchoesOpen = activeWord === "echoes";
  const hasEchoes = savedWords.some((item) => item.word === "echoes");
  const defaultLyrics = useMemo(
    () => [
      { id: "prev", time: 0, text: "The mountains are calling me back home" },
      { id: "active", time: 8, text: "Where the echoes fade away" },
      { id: "next", time: 16, text: "Searching for a reason to stay" },
      { id: "far", time: 24, text: "But the wind is blowing cold tonight" },
    ],
    [],
  );
  const lyricLines = uploadedSong?.lyrics?.length ? uploadedSong.lyrics : defaultLyrics;
  const activeLineIndex = Math.max(
    0,
    lyricLines.findIndex((line, index) => {
      const nextLine = lyricLines[index + 1];
      return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
    }),
  );

  useEffect(() => {
    if (!audioRef.current || !uploadedSong?.audioUrl) {
      return;
    }

    if (isPlaying) {
      audioRef.current.play().catch(() => setPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, setPlaying, uploadedSong?.audioUrl]);

  useEffect(() => {
    activeLyricRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeLineIndex]);

  return (
    <section className="view player-view">
      {uploadedSong?.audioUrl && (
        <audio
          ref={audioRef}
          src={uploadedSong.audioUrl}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 225)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <div className={`lyric-stage ${uploadedSong ? "synced" : ""}`}>
        {uploadedSong ? (
          <div className="synced-lyrics">
            {lyricLines.map((line, index) => (
              <p
                key={line.id}
                ref={index === activeLineIndex ? activeLyricRef : null}
                className={`synced-line ${index === activeLineIndex ? "active" : ""}`}
              >
                {line.text}
              </p>
            ))}
          </div>
        ) : (
          <>
            <p className="lyric muted">The mountains are calling me back home</p>
            <div className="active-lyric">
              <h1>
                Where the{" "}
                <button className={`smart-word ${isEchoesOpen ? "is-open" : ""}`} type="button" aria-expanded={isEchoesOpen} onClick={() => toggleWord("echoes")}>
                  echoes
                </button>{" "}
                fade away
              </h1>
              {isEchoesOpen && (
                <aside className="word-popover">
                  <div><span>SmartWord</span><button className="icon-btn tiny" aria-label="发音"><Icon name="volume_up" filled /></button></div>
                  <h2>echoes</h2>
                  <p>/ˈekoʊz/ · n. 回声，共鸣</p>
                  <em>"The walls repeat the echoes of our past."</em>
                  <button className="primary-btn small" onClick={() => saveWord({
                    word: "echoes",
                    phonetic: "/ˈekoʊz/",
                    meaning: "n. 回声，共鸣",
                    example: "The walls repeat the echoes of our past.",
                    sourceSong: "Ethereal Echoes",
                  })}>
                    {hasEchoes ? "已加入" : "加入生词本"}
                  </button>
                </aside>
              )}
            </div>
            <p className="lyric next">Searching for a reason to stay</p>
            <p className="lyric far">But the wind is blowing cold tonight</p>
          </>
        )}
        {uploadedSong && (
          <div className="local-song-meta">
            <Icon name="graphic_eq" />
            <span>本地歌词同步中</span>
          </div>
        )}
      </div>
      <div className={`record-widget ${isRecording ? "recording" : ""}`} aria-label="录音练习">
        <div className="wave-stack"><span /><span /><span /><span /><span /></div>
        <button className="record-btn" aria-label="长按录音纠音" onClick={toggleRecording}><Icon name={isRecording ? "stop" : "mic"} filled /></button>
        <strong>{isRecording ? "正在录音" : "长按录音纠音"}</strong>
      </div>
      <footer className="player-bar">
        <div className="progress-row">
          <span>{formatTime(uploadedSong ? currentTime : 134)}</span>
          <div className="track"><i style={{ width: `${Math.min(100, ((uploadedSong ? currentTime : 146) / duration) * 100)}%` }} /></div>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="control-glass">
          <div className="now-playing">
            <img src={uploadedSong?.coverUrl || "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=300&q=80"} alt="当前歌曲封面" />
            <div><strong>{uploadedSong?.title || "Ethereal Echoes"}</strong><span>{uploadedSong?.artist || "Lyrical Soul"}</span></div>
          </div>
          <div className="transport">
            <button className="icon-btn ghost" aria-label="随机"><Icon name="shuffle" /></button>
            <button className="icon-btn ghost" aria-label="上一首"><Icon name="skip_previous" /></button>
            <button className="play-btn" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlaying}><Icon name={isPlaying ? "pause" : "play_arrow"} filled /></button>
            <button className="icon-btn ghost" aria-label="下一首"><Icon name="skip_next" /></button>
            <button className="icon-btn ghost" aria-label="循环"><Icon name="repeat" /></button>
          </div>
          <div className="volume"><Icon name="favorite" filled /><Icon name="volume_up" /><div className="volume-track"><i /></div></div>
        </div>
      </footer>
    </section>
  );
}

function DiscoverView() {
  const { savedWords, vocabularyStatus } = useMeloStore();
  return (
    <section className="view">
      <section className="overview-panel">
        <h1>词汇掌握概览</h1>
        <p>你已经通过 12 首歌曲掌握了以下语言成就。</p>
        <div className="stat-grid">
          <div><span>总掌握词汇</span><strong>1,428</strong></div>
          <div><span>已攻克难句</span><strong>86</strong></div>
          <div><span>学习时长</span><strong>14h 20m</strong></div>
          <div><span>发音准确度</span><strong>94%</strong></div>
        </div>
      </section>
      <div className="learning-grid">
        <section className="word-list">
          <div className="section-head compact"><h2>重点词汇卡片</h2><button className="text-btn">查看全部</button></div>
          {vocabulary.map(([word, meaning]) => <article key={word}><div><h3>{word}</h3><p>{meaning}</p></div><button className="icon-btn"><Icon name="volume_up" /></button></article>)}
        </section>
        <aside className="challenge-card">
          <Icon name="psychology" />
          <h2>今日难句挑战</h2>
          <blockquote>"The ethereal velocity of the night sky echoes through my soul."</blockquote>
          <p>夜空的缥缈速度在我的灵魂中回响。</p>
          <div><button className="primary-btn light"><Icon name="play_arrow" />播放原声</button><button className="glass-btn"><Icon name="mic" />开始跟读</button></div>
        </aside>
      </div>
      <section className="saved-vocabulary">
        <SectionHead title="我的生词本" subtitle="从歌词中点击收藏的单词会同步保存在这里" />
        {vocabularyStatus === "loading" && <p className="empty-note">正在读取生词本...</p>}
        {vocabularyStatus === "error" && <p className="empty-note">暂时无法连接生词本服务，请确认后端已启动。</p>}
        {vocabularyStatus !== "loading" && savedWords.length === 0 && (
          <p className="empty-note">还没有收藏单词。去歌词掌握页点击 SmartWord，把第一个单词放进来。</p>
        )}
        {savedWords.length > 0 && (
          <div className="saved-word-grid">
            {savedWords.map((item) => (
              <article className="saved-word-card" key={item.word}>
                <div>
                  <span>SmartWord</span>
                  <h3>{item.word}</h3>
                  <p>{item.phonetic} · {item.meaning}</p>
                </div>
                {item.example && <em>"{item.example}"</em>}
                {item.sourceSong && <small>{item.sourceSong}</small>}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function ProgressView() {
  return (
    <section className="view">
      <div className="progress-top">
        <article className="metric-card"><Icon name="local_fire_department" filled /><p>连续学习</p><h2>15 <small>天</small></h2><div className="mini-days"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span></div></article>
        <article className="metric-card primary"><p>累计时长</p><h2>128 <small>小时</small></h2><span>相当于通过音乐记住了 1,420 个核心词汇</span></article>
        <article className="metric-card ring-card"><p>掌握程度</p><div className="ring"><strong>75%</strong></div><span>白银等级 · 节奏大师</span></article>
      </div>
      <div className="chart-grid">
        <section className="chart-card">
          <div className="section-head compact"><div><h2>学习曲线</h2><p>过去 30 天的旋律记忆波动</p></div><div className="segmented"><button>周</button><button>月</button></div></div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={studyCurve}><Bar dataKey="minutes" radius={[16, 16, 0, 0]} fill="url(#barGradient)" /><defs><linearGradient id="barGradient" x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--primary)" /><stop offset="1" stopColor="var(--secondary-soft)" /></linearGradient></defs></BarChart>
          </ResponsiveContainer>
          <div className="axis">{studyCurve.map((item) => <span key={item.day}>{item.day}</span>)}</div>
        </section>
        <section className="chart-card radar-card">
          <h2>能力雷达图</h2>
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={radarData}><PolarGrid stroke="var(--outline)" /><PolarAngleAxis dataKey="skill" tick={{ fill: "var(--muted)", fontSize: 12 }} /><Radar dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.35} /></RadarChart>
          </ResponsiveContainer>
          <div className="radar-meta"><p><span>最强项</span><strong>旋律听辨</strong></p><p><span>待加强</span><strong>复杂语法</strong></p></div>
        </section>
      </div>
      <section className="honors">
        <SectionHead title="荣誉墙" subtitle="记录你每一个闪耀的瞬间" />
        <div className="honor-grid">
          {["初试啼声", "学习先锋", "百词斩", "填词达人"].map((title, index) => <article key={title} className={index === 3 ? "locked" : ""}><Icon name={["auto_awesome", "timer_10_alt_1", "verified", "lyrics"][index]} filled={index < 3} /><strong>{title}</strong><small>{["完成第 1 首歌", "累计 10 小时", "掌握 100 词汇", "解锁 50 首全词"][index]}</small></article>)}
        </div>
      </section>
    </section>
  );
}

function ProfileView() {
  return (
    <section className="view profile-view">
      <div className="profile-main">
        <div className="profile-left">
          <section className="profile-hero-card">
            <div className="avatar-wrap">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBUysvjdILh1cXFtHAS32MsdeoPUxMUQui-iBosnBkTcRUVWczqZBdf4NjfRqwB-oKLn7iXPkERDhTXs4BkURjp-NBtVQxBvSDzGXuiPLUdWNMo37HDg6LQcDtr41Zk2CF73lUXrvLrCzsQvPZk8V6O2Kpgf9hq4FNVCkdtttae7ZW0Q0l3VsZDPKh-zvmv8O6nycuhNQ1jsEVPC8BAUPPwQ2ZwjB6SsDg-bQxyEVX6_5l-IfJpCmpPlqbu-_F2b5mGyQ8rDEHAu3Pb"
                alt="用户头像"
              />
              <span><Icon name="music_note" filled /></span>
            </div>
            <div className="profile-copy">
              <h1>音律旅人</h1>
              <span className="level-chip">LV.4 节奏大师</span>
              <p>"在旋律中寻找灵魂的共鸣"</p>
            </div>
          </section>

          <section className="profile-stats">
            {profileStats.map((stat) => (
              <article key={stat.label} className={`profile-stat ${stat.tone}`}>
                <Icon name={stat.icon} filled={stat.icon === "favorite"} />
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </article>
            ))}
          </section>

          <section className="profile-groups">
            {profileGroups.map((group) => (
              <div className="profile-list-card" key={group.title}>
                <h2>{group.title}</h2>
                {group.items.map((item) => (
                  <button className="profile-list-row" key={item.label}>
                    <span className={`row-icon ${group.tone}`}><Icon name={item.icon} /></span>
                    <strong>{item.label}</strong>
                    <Icon name="chevron_right" />
                  </button>
                ))}
              </div>
            ))}
          </section>
        </div>

        <aside className="pro-card">
          <div className="pro-title">
            <div>
              <h2>Pro 会员</h2>
              <p>尊享极致音乐学习体验</p>
            </div>
            <Icon name="workspace_premium" filled />
          </div>
          <ul>
            <li><Icon name="check_circle" />解锁高保真音质</li>
            <li><Icon name="check_circle" />专属生词本导出</li>
            <li><Icon name="check_circle" />AI发音纠错</li>
          </ul>
          <button>续费会员</button>
        </aside>
      </div>
    </section>
  );
}

function MobileNav() {
  const { view, setView } = useMeloStore();
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {navItems.map((item) => <button key={item.id} className={`${view === item.id ? "active" : ""} ${item.id === "player" ? "center" : ""}`} onClick={() => setView(item.id)}><Icon name={item.icon} filled={view === item.id || item.id === "player"} />{item.id !== "player" && <small>{item.label}</small>}</button>)}
    </nav>
  );
}

function App() {
  const view = useMeloStore((state) => state.view);
  const loadSavedWords = useMeloStore((state) => state.loadSavedWords);

  useEffect(() => {
    loadSavedWords();
  }, [loadSavedWords]);

  return (
    <>
      <div className="atmosphere" aria-hidden="true" />
      <Header />
      <main>
        {view === "library" && <LibraryView />}
        {view === "discover" && <DiscoverView />}
        {view === "player" && <PlayerView />}
        {view === "progress" && <ProgressView />}
        {view === "profile" && <ProfileView />}
      </main>
      <MobileNav />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
