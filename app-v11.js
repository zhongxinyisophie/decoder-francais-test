(function decoderApp() {
  "use strict";
  let LESSON = null;
  const CATALOG = window.DECODER_CATALOG;
  if (!CATALOG || !Array.isArray(CATALOG.materials)) throw new Error("Material catalog not loaded.");

  let step = 0;
  let pre = null;
  let post = null;
  let hasCompletedSession = false;
  let trainingMode = "lesson";
  let activeSkillKey = null;
  let activeRelationKey = null;
  let activeMaterialId = null;
  const loadedLessonIds = new Set();
  const ans = Object.create(null);
  const inputValues = Object.create(null);
  const questionIndex = Object.create(null);
  const questionAudioRef = Object.create(null);
  let sessionMetrics = null;
  const synthRates = Object.create(null);
  const STORAGE_KEY = "decoder-francais-diagnostics-v1";

  const SKILL_TAXONOMY = [
    {key:"groupes_de_mots",cn:"听语块",fr:"Groupes de mots",desc:"听出一句话里哪些词是连在一起的。"},
    {key:"liaison_enchainement",cn:"连读和衔接",fr:"Liaison / enchaînement",desc:"听清词与词连在一起时的声音变化。"},
    {key:"francais_oral",cn:"真实口语",fr:"Français oral",desc:"听懂自然口语里的省略、弱化和缩读。"},
    {key:"sens_en_contexte",cn:"听懂词义",fr:"Sens en contexte",desc:"结合上下文判断词和表达在这里的意思。"},
    {key:"structures",cn:"听句型",fr:"Structures",desc:"听到关键结构后，能预测后面的信息。"},
    {key:"temps_verbaux",cn:"听时态",fr:"Temps verbaux",desc:"从动词形式听出动作的时间先后。"},
    {key:"negation",cn:"听否定",fr:"Négation",desc:"在自然语流里及时听出否定。"},
    {key:"connecteurs",cn:"听逻辑",fr:"Connecteurs",desc:"听出转折、原因、结果、让步等逻辑关系。"}
  ];

  const CONNECTOR_RELATIONS = [
    {key:"addition",cn:"并列 / 补充",fr:"Addition",desc:"继续补充同一方向的信息。"},
    {key:"progression",cn:"递进",fr:"Progression",desc:"进一步加强前面的意思。"},
    {key:"opposition_contrast",cn:"转折 / 对比",fr:"Opposition / contraste",desc:"转到另一面，形成对比。"},
    {key:"concession_restriction",cn:"让步 / 限制",fr:"Concession / restriction",desc:"承认前面成立，但给结论加上限制。"},
    {key:"cause",cn:"原因",fr:"Cause",desc:"说明为什么。"},
    {key:"consequence",cn:"结果",fr:"Conséquence",desc:"说明前面带来的结果。"},
    {key:"illustration",cn:"举例 / 具体化",fr:"Illustration",desc:"用例子把观点说具体。"},
    {key:"reformulation",cn:"改述 / 解释",fr:"Reformulation",desc:"换一种说法解释或澄清。"},
    {key:"conclusion",cn:"总结 / 结论",fr:"Conclusion",desc:"收束前面的内容，给出结论。"}
  ];

  const LEGACY_RELATION_BY_QUESTION = {
    co1:"concession_restriction",
    co2:"concession_restriction",
    co3:"opposition_contrast"
  };

  function readHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {version:1,sessions:[]};
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.sessions)) return {version:1,sessions:[]};
      return parsed;
    } catch (_) {
      return {version:1,sessions:[]};
    }
  }

  function writeHistory(history) {
    try {
      const capped = {version:1,sessions:(history.sessions || []).slice(-100)};
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
    } catch (_) {}
  }

  function beginSession(mode, skillKey) {
    sessionMetrics = {
      id: Date.now().toString(36),
      startedAt: new Date().toISOString(),
      materialId: activeMaterialId,
      mode,
      skillKey: skillKey || null,
      playback: {},
      questions: {}
    };
  }

  function playbackCount(ref) {
    return sessionMetrics && ref ? (sessionMetrics.playback[ref] || 0) : 0;
  }

  function playCountLabel(ref) {
    const count = playbackCount(ref);
    return count >= 2 ? "已听 " + count + " 次" : "";
  }

  function updatePlaybackCountUI(ref) {
    document.querySelectorAll('[data-playcount-ref="'+CSS.escape(ref)+'"]').forEach(el => {
      el.textContent = playCountLabel(ref);
      el.classList.toggle("visible", playbackCount(ref) >= 2);
    });
  }

  function recordPlay(ref) {
    if (!sessionMetrics || !ref) return;
    sessionMetrics.playback[ref] = (sessionMetrics.playback[ref] || 0) + 1;
    updatePlaybackCountUI(ref);
  }

  function recordQuestionAttempt(id, correct) {
    if (!sessionMetrics || sessionMetrics.questions[id]) return;
    const q = questionIndex[id] || {};
    const ref = questionAudioRef[id] || null;
    sessionMetrics.questions[id] = {
      skillKey: q.primarySkill || (LESSON && LESSON.steps[step] ? LESSON.steps[step].skillKey || null : null),
      relationKey: q.relationKey || null,
      correct: !!correct,
      playbackRef: ref,
      playsBeforeAnswer: ref ? playbackCount(ref) : 0
    };
  }

  function blockPlaybackRef(b) {
    if (!b) return null;
    if (b.type === "audio") return "audio:" + String(b.key || "") + ":" + String(b.label || "");
    if (b.type === "synth") {
      let h = 0;
      const text = String(b.text || "");
      for (let i=0;i<text.length;i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
      return "synth:" + Math.abs(h);
    }
    return null;
  }

  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
  const escapeAttr = escapeHTML;

  function indexBlocks(blocks) {
    let lastRef = null;
    (blocks || []).forEach(b => {
      const ref = blockPlaybackRef(b);
      if (ref) lastRef = ref;
      if (b && b.id && (b.type === "mcq" || b.type === "input")) {
        questionIndex[b.id] = b;
        if (lastRef) questionAudioRef[b.id] = lastRef;
      }
    });
  }

  function resetQuestionIndex() {
    Object.keys(questionIndex).forEach(k => delete questionIndex[k]);
    Object.keys(questionAudioRef).forEach(k => delete questionAudioRef[k]);
  }

  function setupLesson(lesson, materialId) {
    LESSON = lesson;
    activeMaterialId = materialId || lesson.id || null;
    resetQuestionIndex();
    Object.keys(ans).forEach(k => delete ans[k]);
    Object.keys(inputValues).forEach(k => delete inputValues[k]);
    pre = null;
    post = null;
    LESSON.steps.forEach(s => {
      indexBlocks(s.blocks);
      (s.drills || []).forEach(d => indexBlocks(d.blocks));
    });
    $("lessonName").textContent = LESSON.meta.title;
    $("resultLessonName").textContent = LESSON.meta.title;
    $("lessonBadge").textContent = `${LESSON.meta.level} · ${LESSON.meta.audience}`;
    jumps();
  }

  function materialById(id) {
    return CATALOG.materials.find(m => m.id === id) || null;
  }

  function loadMaterial(id) {
    const material = materialById(id);
    if (!material) return Promise.reject(new Error("Material not found: " + id));
    if (LESSON && activeMaterialId === id) return Promise.resolve(LESSON);

    return new Promise((resolve, reject) => {
      window.LESSON = null;
      const script = document.createElement("script");
      script.src = material.lessonScript + (material.lessonScript.includes("?") ? "&" : "?") + "catalog=" + encodeURIComponent(CATALOG.version || 1);
      script.async = true;
      script.onload = () => {
        if (!window.LESSON) {
          reject(new Error("Lesson script loaded but no lesson data was registered."));
          return;
        }
        setupLesson(window.LESSON, id);
        loadedLessonIds.add(id);
        resolve(LESSON);
      };
      script.onerror = () => reject(new Error("Could not load lesson data: " + material.lessonScript));
      document.head.appendChild(script);
    });
  }

  function norm(s) {
    return (s || "").trim().toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "'")
      .replace(/[^a-z' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function audioBlock(b) {
    const src = LESSON && LESSON.audio ? (LESSON.audio[b.key] || "") : "";
    const ref = blockPlaybackRef(b);
    const repeated = playbackCount(ref) >= 2;
    return `<div class="trainingaudio"><div class="audiohead"><small>${escapeHTML(b.label || "")}</small><span class="listenmeta ${repeated ? "visible" : ""}" data-playcount-ref="${escapeAttr(ref)}">${escapeHTML(playCountLabel(ref))}</span></div><audio class="audioengine" playsinline preload="metadata" data-audio-ref="${escapeAttr(ref)}" src="${escapeAttr(src)}"></audio><div class="miniplayer"><button type="button" class="playericon" data-audio-action="back" data-audio-ref="${escapeAttr(ref)}" aria-label="后退三秒">−3</button><button type="button" class="playcore" data-audio-action="toggle" data-audio-ref="${escapeAttr(ref)}" aria-label="播放或暂停"><span data-audio-play-icon-ref="${escapeAttr(ref)}">▶</span></button><button type="button" class="playericon" data-audio-action="replay" data-audio-ref="${escapeAttr(ref)}" aria-label="从头重听">↻</button><div class="speedseg" aria-label="播放速度"><button type="button" data-audio-action="speed" data-speed=".8" data-audio-ref="${escapeAttr(ref)}">0.8</button><button type="button" class="active" data-audio-action="speed" data-speed="1" data-audio-ref="${escapeAttr(ref)}">1.0</button></div></div><div class="seekrow"><input class="seek" type="range" min="0" max="100" value="0" step=".1" data-audio-seek-ref="${escapeAttr(ref)}" aria-label="音频进度"><span class="timecode" data-audio-time-ref="${escapeAttr(ref)}">0:00 / 0:00</span></div></div>`;
  }

  function synthBlock(b) {
    const ref = blockPlaybackRef(b);
    const encoded = escapeAttr(encodeURIComponent(b.text || ""));
    const repeated = playbackCount(ref) >= 2;
    const selected = synthRates[ref] || 1;
    return `<div class="trainingaudio synthplayer"><div class="audiohead"><small>${escapeHTML(b.label || "")}</small><span class="listenmeta ${repeated ? "visible" : ""}" data-playcount-ref="${escapeAttr(ref)}">${escapeHTML(playCountLabel(ref))}</span></div><div class="synthline"><button type="button" class="playcore smallplay" data-speak="${encoded}" data-speak-ref="${escapeAttr(ref)}" aria-label="播放句子">▶</button><span class="synthlabel">听句子</span><div class="speedseg"><button type="button" class="${selected === .8 ? "active" : ""}" data-synth-speed=".8" data-synth-ref="${escapeAttr(ref)}">0.8</button><button type="button" class="${selected === 1 ? "active" : ""}" data-synth-speed="1" data-synth-ref="${escapeAttr(ref)}">1.0</button></div></div></div>`;
  }

  function mcqBlock(b) {
    const answered = ans[b.id] !== undefined;
    const selected = ans[b.id];
    const buttons = b.options.map((option, i) => {
      const classes = ["choice"];
      if (answered) {
        classes.push("locked");
        if (i === b.correct) classes.push("correct");
        else if (i === selected) classes.push("wrong");
      }
      return `<button type="button" class="${classes.join(" ")}" data-choice-id="${escapeAttr(b.id)}" data-choice-index="${i}">${escapeHTML(option)}</button>`;
    }).join("");
    const ok = answered && selected === b.correct;
    const feedback = answered ? `<div class="feedback show" id="${escapeAttr(b.id)}F">${ok ? "✓ " : "再听一次。"}${b.feedback || ""}</div>` : `<div class="feedback" id="${escapeAttr(b.id)}F"></div>`;
    return `<div class="q">${b.question || ""}</div><div class="choices" id="${escapeAttr(b.id)}">${buttons}</div>${feedback}`;
  }

  function inputBlock(b) {
    const answered = ans[b.id] !== undefined;
    const raw = inputValues[b.id] || "";
    let feedback = "";
    if (answered) {
      const ok = !!ans[b.id];
      const success = b.successHtml || `✓ <span class="fr">${escapeHTML(b.displayAnswer || b.answers[0])}</span>`;
      const failure = b.failureHtml || `答案：<span class="fr">${escapeHTML(b.displayAnswer || b.answers[0])}</span>`;
      feedback = `<div class="feedback show" id="${escapeAttr(b.id)}F">${ok ? success : failure}</div>`;
    } else {
      feedback = `<div class="feedback" id="${escapeAttr(b.id)}F"></div>`;
    }
    return `<div class="q">${b.question || ""}</div><input id="${escapeAttr(b.id)}I" class="input" data-input-value="${escapeAttr(b.id)}" value="${escapeAttr(raw)}" placeholder="${escapeAttr(b.placeholder || "")}" ${answered ? "disabled" : ""}><div class="btnrow"><button type="button" class="btn" data-check-input="${escapeAttr(b.id)}" ${answered ? "disabled" : ""}>检查</button></div>${feedback}`;
  }

  function scaleBlock(b) {
    const val = b.kind === "pre" ? pre : post;
    const values = b.values || [20,40,60,80,100];
    return `<div class="q">${b.question || ""}</div><div class="scale">${values.map(v => `<button type="button" class="${val === v ? "sel" : ""}" data-rate-kind="${escapeAttr(b.kind)}" data-rate-value="${v}">${v}%</button>`).join("")}</div>`;
  }

  function compareBlock() {
    if (pre != null && post != null) {
      return `<div id="cmp"><div class="compare"><div><small>第一次</small><br><b>${pre}%</b></div><div>→</div><div><small>最终</small><br><b>${post}%</b></div></div></div>`;
    }
    return `<div id="cmp"><p class="muted">选择前后听懂比例后，这里显示变化。</p></div>`;
  }

  function isCorrect(id) {
    if (ans[id] === undefined) return null;
    const q = questionIndex[id];
    if (!q) return null;
    if (q.type === "mcq") return ans[id] === q.correct;
    if (q.type === "input") return !!ans[id];
    return null;
  }

  function skillStatus(items) {
    const done = items.filter(x => x !== null);
    if (!done.length) return {s:"未完成", n:"完成后这里会显示结果。"};
    if (done.length < items.length) return {s:"进行中", n:"还有题目没做完，暂不判断。"};
    const score = done.filter(Boolean).length;
    if (score === items.length) return {s:"本次表现较稳", n:"这次做得不错；还要多换几段素材，才能看出是否稳定。"};
    if (score >= Math.ceil(items.length * 2 / 3)) return {s:"基本识别", n:"大部分能听出来，但还有一个环节需要再练。"};
    return {s:"建议继续训练", n:"这次还有明显漏听或误判，建议换个语境继续练。"};
  }

  function skillSummary() {
    return `<div class="skillsum">${LESSON.skills.map(skill => {
      const status = skillStatus(skill.items.map(isCorrect));
      let note = status.n;
      (skill.noteRules || []).forEach(rule => {
        const matches = Object.entries(rule.when || {}).every(([id, expected]) => isCorrect(id) === expected);
        if (matches) note = rule.note;
      });
      return `<div class="skillrow"><div class="skilltop"><b>${escapeHTML(skill.name)}</b><span class="skillstate">${escapeHTML(status.s)}</span></div><div class="skillnote">${escapeHTML(note)}</div></div>`;
    }).join("")}</div>`;
  }

  function renderBlock(b) {
    switch (b.type) {
      case "audio": return audioBlock(b);
      case "synth": return synthBlock(b);
      case "mcq": return mcqBlock(b);
      case "input": return inputBlock(b);
      case "scale": return scaleBlock(b);
      case "compare": return compareBlock();
      case "paragraph": return `<p class="muted">${b.html || ""}</p>`;
      case "heading": return `<h3 style="margin-top:18px">${b.html || ""}</h3>`;
      case "summary": return skillSummary();
      case "transcript": return `<details><summary>${escapeHTML(b.summary || "查看完整法语文字稿")}</summary><p class="fr" style="white-space:pre-line;line-height:1.7">${escapeHTML(LESSON.transcript || "")}</p></details>`;
      default: return "";
    }
  }

  function renderBlocks(blocks) {
    return (blocks || []).map(renderBlock).join("");
  }

  function renderStep(s) {
    let body = `<div class="card"><h3>${escapeHTML(s.heading || "")}</h3>`;
    if (s.blocks) body += renderBlocks(s.blocks);
    (s.drills || []).forEach((d, i) => {
      body += `<div class="drill"><div class="drillhead"><span class="num">${i + 1}</span><b>${escapeHTML(d.title)}</b></div>${renderBlocks(d.blocks)}</div>`;
    });
    return body + "</div>";
  }

  function render() {
    const s = trainingMode === "relation" ? relationPracticeStep() : LESSON.steps[step];
    $("title").textContent = s.title;
    $("content").innerHTML = renderStep(s);

    if (trainingMode === "relation") {
      const qCount = relationQuestionIds(activeRelationKey).length;
      $("count").textContent = "逻辑专项 · " + qCount + " 题";
      $("bar").style.width = "100%";
      $("prevBtn").classList.add("hidden");
      $("nextBtn").classList.add("hidden");
      $("finishBtn").classList.remove("hidden");
      $("finishBtn").textContent = "完成逻辑专项";
    } else if (trainingMode === "skill") {
      const skill = activeSkill();
      const questionCount = skill ? skill.items.length : 3;
      $("count").textContent = "专项训练 · " + questionCount + " 题";
      $("bar").style.width = "100%";
      $("prevBtn").classList.add("hidden");
      $("nextBtn").classList.add("hidden");
      $("finishBtn").classList.remove("hidden");
      $("finishBtn").textContent = "完成专项训练";
    } else {
      $("count").textContent = `${step + 1} / ${LESSON.steps.length}`;
      $("bar").style.width = `${(step + 1) / LESSON.steps.length * 100}%`;
      const isLast = step === LESSON.steps.length - 1;
      $("prevBtn").classList.toggle("hidden", step === 0);
      $("nextBtn").classList.toggle("hidden", isLast);
      $("finishBtn").classList.toggle("hidden", !isLast);
      $("finishBtn").textContent = "完成本次训练";
    }
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function renderMaterialLibrary() {
    const target = $("materialLibrary");
    if (!target) return;
    target.innerHTML = CATALOG.materials.map(material => {
      const topics = (material.topics || []).map(t => '<span class="tag">'+escapeHTML(t)+'</span>').join("");
      const skills = (material.skillLabels || []).map(t => '<span class="tag skilltag">'+escapeHTML(t)+'</span>').join("");
      return '<div class="materialcard"><div class="materialtop"><span class="pill">'+escapeHTML(material.level || CATALOG.defaultLevel || "")+'</span><span class="duration">'+escapeHTML((material.audioSeconds || "") + " 秒 · " + (material.duration || ""))+'</span></div><h3>'+escapeHTML(material.title)+'</h3><p class="muted">'+escapeHTML(material.description || "")+'</p><div class="tagrow">'+topics+'</div><div class="tagrow skills">'+skills+'</div><button type="button" class="btn wide" data-start-material="'+escapeAttr(material.id)+'">开始这段训练</button></div>';
    }).join("");
  }

  function renderSkillLibrary() {
    $("skillLibrary").innerHTML = SKILL_TAXONOMY.map(skill => {
      const matches = CATALOG.materials.filter(m => (m.skills || []).includes(skill.key));
      const has = matches.length > 0;
      const countText = has ? (matches.length + " 段素材") : "待扩充";
      const isLogic = skill.key === "connecteurs";
      const cta = has ? '<div class="skillcta">'+(isLogic ? '选择逻辑关系 →' : '进入专项练习 →')+'</div>' : '';
      const inner = '<div class="skillcardtop"><div><b>'+escapeHTML(skill.cn)+'</b><div class="skillfr">'+escapeHTML(skill.fr)+'</div></div><span class="skillcount">'+countText+'</span></div><div class="skilldesc">'+escapeHTML(skill.desc)+'</div>'+cta;
      if (!has) return '<div class="skillcard">'+inner+'</div>';
      return isLogic
        ? '<button type="button" class="skillcard available" data-open-relations="connecteurs">'+inner+'</button>'
        : '<button type="button" class="skillcard available" data-start-skill="'+escapeAttr(skill.key)+'">'+inner+'</button>';
    }).join("");
  }

  function renderConnectorRelations() {
    const panel = $("relationPanel");
    if (!panel) return;
    panel.innerHTML = '<div class="relationhead"><div><small class="eyebrow">Connecteurs</small><h3>选择一种逻辑关系</h3></div><button type="button" class="relationclose" data-close-relations aria-label="关闭">×</button></div><p class="muted relationintro">先听出逻辑关系，再识别具体连接词。同一个连接词在不同语境里，作用可能不同。</p><div class="relationgrid">'+CONNECTOR_RELATIONS.map(rel => {
      const matches = CATALOG.materials.filter(m => (m.logicRelations || []).includes(rel.key));
      const has = matches.length > 0;
      const inner = '<div class="relationtop"><div><b>'+escapeHTML(rel.cn)+'</b><small>'+escapeHTML(rel.fr)+'</small></div><span class="skillcount">'+(has ? matches.length+" 段素材" : "待扩充")+'</span></div><p>'+escapeHTML(rel.desc)+'</p>'+(has ? '<span class="relationcta">开始专项 →</span>' : '');
      return has
        ? '<button type="button" class="relationcard available" data-start-relation="'+escapeAttr(rel.key)+'">'+inner+'</button>'
        : '<div class="relationcard">'+inner+'</div>';
    }).join("")+'</div>';
    panel.classList.remove("hidden");
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function closeConnectorRelations() {
    const panel = $("relationPanel");
    if (panel) panel.classList.add("hidden");
  }

  function aggregateLabel(stat, minSamples) {
    if (!stat || !stat.attempts) return "暂无数据";
    if (stat.attempts < (minSamples || 6)) return "数据还少";
    const ratio = stat.correct / stat.attempts;
    if (ratio >= .8) return "近期较稳";
    if (ratio >= .6) return "还需练习";
    return "建议加强";
  }

  function renderRelationProfile(relationStats) {
    const rows = CONNECTOR_RELATIONS.map(rel => {
      const s = relationStats[rel.key];
      if (!s) return "";
      const avg = s.attempts ? (s.plays / s.attempts).toFixed(1) : "0.0";
      const label = aggregateLabel(s, 5);
      const canPractice = CATALOG.materials.some(m => (m.logicRelations || []).includes(rel.key));
      return '<div class="relationprofilerow"><div><div class="relationprofiletop"><b>'+escapeHTML(rel.cn)+'</b><span>'+escapeHTML(label)+'</span></div><small>'+s.correct+'/'+s.attempts+' 第一次答对 · 答题前平均听 '+avg+' 次</small></div>'+(canPractice ? '<button type="button" data-start-relation="'+escapeAttr(rel.key)+'">专项练习</button>' : '')+'</div>';
    }).join("");
    if (!rows) return "";
    return '<div class="relationprofile"><div class="relationprofilehead"><b>听逻辑 · 详细分析</b><small>按逻辑关系查看</small></div>'+rows+'</div>';
  }

  function renderHomeProfile() {
    const target = $("profileHome");
    if (!target) return;
    const agg = aggregateSkillStats();
    if (!agg.sessionCount) {
      target.innerHTML = '<div class="profileempty"><b>完成一次训练后，这里会开始记录你的听力表现。</b><div class="muted">我们会记录第一次作答和播放次数。数据还少时，只显示趋势，不急着下结论。</div></div>';
      return;
    }

    const skillRows = SKILL_TAXONOMY.map(skill => {
      const s = agg.stats[skill.key];
      if (!s) return "";
      const avg = s.attempts ? (s.plays / s.attempts).toFixed(1) : "0.0";
      const label = aggregateLabel(s, 6);
      return '<div class="skillrow"><div class="skilltop"><b>'+escapeHTML(skill.cn)+'</b><span class="skillstate">'+escapeHTML(label)+'</span></div><div class="skillnote">'+s.correct+'/'+s.attempts+' 首次正确 · 答题前平均听 '+avg+' 次</div></div>';
    }).join("");

    const latest = agg.latest || {};
    const selfRating = latest.pre != null || latest.post != null
      ? '<div class="profilemetrics"><div class="metric"><b>'+(latest.pre == null ? "—" : latest.pre+"%")+'</b><small>最近首次自评</small></div><div class="metric"><b>'+(latest.post == null ? "—" : latest.post+"%")+'</b><small>最近最终自评</small></div></div>'
      : "";

    const relationProfile = renderRelationProfile(agg.relationStats || {});
    target.innerHTML = '<div class="profilehistory"><b>已记录 '+agg.sessionCount+' 次训练</b><small>数据保存在本机浏览器</small></div>'+selfRating+'<div class="skillsum">'+skillRows+'</div>'+relationProfile;
  }

  function activeSkill() {
    return LESSON.skills.find(s => s.key === activeSkillKey) || null;
  }

  function activeRelation() {
    return CONNECTOR_RELATIONS.find(r => r.key === activeRelationKey) || null;
  }

  function connectorStep() {
    return LESSON ? LESSON.steps.find(s => s.skillKey === "connecteurs") : null;
  }

  function relationDrills(key) {
    const s = connectorStep();
    return s ? (s.drills || []).filter(d => d.relationKey === key) : [];
  }

  function relationQuestionIds(key) {
    return relationDrills(key).flatMap(d => (d.blocks || []).filter(b => b.id && (b.type === "mcq" || b.type === "input")).map(b => b.id));
  }

  function relationPracticeStep() {
    const rel = activeRelation();
    return {
      title: "听逻辑 · " + (rel ? rel.cn : "Connecteurs"),
      heading: rel ? rel.cn + " · " + rel.fr : "Connecteurs",
      drills: relationDrills(activeRelationKey)
    };
  }

  function singleSkillSummary(skill) {
    if (!skill) return "";
    const status = skillStatus(skill.items.map(isCorrect));
    return '<div class="skillsum"><div class="skillrow"><div class="skilltop"><b>'+escapeHTML(skill.name)+'</b><span class="skillstate">'+escapeHTML(status.s)+'</span></div><div class="skillnote">'+escapeHTML(status.n)+'</div></div></div>';
  }

  function currentBehaviorSummary() {
    const q = sessionMetrics ? Object.values(sessionMetrics.questions || {}) : [];
    const answered = q.length;
    const correct = q.filter(x => x.correct).length;
    const playbackTotal = sessionMetrics ? Object.values(sessionMetrics.playback || {}).reduce((a,b) => a + b, 0) : 0;
    const avgPlays = answered ? q.reduce((sum,x) => sum + (x.playsBeforeAnswer || 0), 0) / answered : 0;
    return {answered,correct,playbackTotal,avgPlays};
  }

  function behaviorSummaryHtml() {
    const b = currentBehaviorSummary();
    if (!b.answered) return "";
    return '<div class="diagnostic"><div><b>'+b.correct+'/'+b.answered+'</b><small>第一次答对</small></div><div><b>'+b.playbackTotal+'</b><small>总播放次数</small></div><div><b>'+b.avgPlays.toFixed(1)+'</b><small>答题前平均播放</small></div></div>';
  }

  function sessionSkillResults() {
    if (!LESSON) return [];
    return LESSON.skills.map(skill => {
      const items = skill.items.map(isCorrect);
      const status = skillStatus(items);
      return {key:skill.key,name:skill.name,status:status.s,note:status.n,score:items.filter(Boolean).length,total:items.length};
    });
  }

  function finalizeSession() {
    if (!sessionMetrics) return;
    sessionMetrics.completedAt = new Date().toISOString();
    sessionMetrics.pre = pre;
    sessionMetrics.post = post;
    sessionMetrics.skillResults = trainingMode === "skill"
      ? sessionSkillResults().filter(x => x.key === activeSkillKey)
      : trainingMode === "relation"
        ? sessionSkillResults().filter(x => x.key === "connecteurs")
        : sessionSkillResults();
    const history = readHistory();
    history.sessions.push(sessionMetrics);
    writeHistory(history);
  }

  function aggregateSkillStats() {
    const history = readHistory();
    const stats = {};
    const relationStats = {};
    history.sessions.forEach(session => {
      Object.entries(session.questions || {}).forEach(([id,q]) => {
        if (q.skillKey) {
          if (!stats[q.skillKey]) stats[q.skillKey] = {attempts:0,correct:0,plays:0};
          stats[q.skillKey].attempts++;
          if (q.correct) stats[q.skillKey].correct++;
          stats[q.skillKey].plays += q.playsBeforeAnswer || 0;
        }
        const relationKey = q.relationKey || LEGACY_RELATION_BY_QUESTION[id] || null;
        if (q.skillKey === "connecteurs" && relationKey) {
          if (!relationStats[relationKey]) relationStats[relationKey] = {attempts:0,correct:0,plays:0};
          relationStats[relationKey].attempts++;
          if (q.correct) relationStats[relationKey].correct++;
          relationStats[relationKey].plays += q.playsBeforeAnswer || 0;
        }
      });
    });
    return {
      sessionCount:history.sessions.length,
      stats,
      relationStats,
      latest:history.sessions[history.sessions.length-1] || null
    };
  }

  function resultHtml() {
    if (trainingMode === "relation") {
      const rel = activeRelation();
      const ids = relationQuestionIds(activeRelationKey);
      const status = skillStatus(ids.map(isCorrect));
      return `<div class="card"><div class="pill">听逻辑练习完成</div><h2>${escapeHTML(rel ? rel.cn : "听逻辑")}</h2><p class="muted">${escapeHTML(rel ? rel.desc : "")}</p>${behaviorSummaryHtml()}<h3 style="margin-top:18px">本次表现</h3><div class="skillsum"><div class="skillrow"><div class="skilltop"><b>${escapeHTML(rel ? rel.cn : "听逻辑")}</b><span class="skillstate">${escapeHTML(status.s)}</span></div><div class="skillnote">${escapeHTML(status.n)}</div></div></div></div>`;
    }
    if (trainingMode === "skill") {
      const skill = activeSkill();
      return `<div class="card"><div class="pill">专项训练完成</div><h2>${escapeHTML(skill ? skill.name : "微技能")}</h2><p class="muted">这次只看这一项能力。</p>${behaviorSummaryHtml()}<h3 style="margin-top:18px">本次表现</h3>${singleSkillSummary(skill)}</div>`;
    }
    return `<div class="card"><div class="pill">训练完成</div><h2>本次听力表现</h2><p class="muted">不看总分，只看你这次哪里听得稳、哪里容易卡住。</p>${compareBlock()}${behaviorSummaryHtml()}<h3 style="margin-top:18px">本次听力表现</h3>${skillSummary()}</div>`;
  }

  function showResult() {
    hasCompletedSession = true;
    finalizeSession();
    $("lesson").classList.add("hidden");
    $("home").classList.add("hidden");
    $("result").classList.remove("hidden");
    $("resultContent").innerHTML = resultHtml();
    window.scrollTo({top:0, behavior:"smooth"});
  }

  async function startMaterial(id) {
    try {
      await loadMaterial(id);
      trainingMode = "lesson";
      activeSkillKey = null;
      activeRelationKey = null;
      beginSession("lesson", null);
      $("home").classList.add("hidden");
      $("result").classList.add("hidden");
      $("lesson").classList.remove("hidden");
      step = 0;
      render();
    } catch (err) {
      console.error(err);
      alert("素材加载失败，请刷新后重试。");
    }
  }

  async function startSkill(key) {
    const material = CATALOG.materials.find(m => (m.skills || []).includes(key));
    if (!material) return;
    try {
      await loadMaterial(material.id);
      const skill = LESSON.skills.find(s => s.key === key);
      const targetStep = LESSON.steps.findIndex(s => s.skillKey === key);
      if (!skill || targetStep < 0) return;
      trainingMode = "skill";
      activeSkillKey = key;
      activeRelationKey = null;
      beginSession("skill", key);
      $("home").classList.add("hidden");
      $("result").classList.add("hidden");
      $("lesson").classList.remove("hidden");
      step = targetStep;
      render();
    } catch (err) {
      console.error(err);
      alert("专项训练加载失败，请刷新后重试。");
    }
  }

  async function startRelation(key) {
    const material = CATALOG.materials.find(m => (m.logicRelations || []).includes(key));
    if (!material) return;
    try {
      await loadMaterial(material.id);
      const drills = relationDrills(key);
      if (!drills.length) return;
      trainingMode = "relation";
      activeSkillKey = "connecteurs";
      activeRelationKey = key;
      beginSession("relation", "connecteurs");
      if (sessionMetrics) sessionMetrics.relationKey = key;
      $("home").classList.add("hidden");
      $("result").classList.add("hidden");
      $("lesson").classList.remove("hidden");
      step = LESSON.steps.findIndex(s => s.skillKey === "connecteurs");
      render();
    } catch (err) {
      console.error(err);
      alert("逻辑专项加载失败，请刷新后重试。");
    }
  }
  function next() {
    if (step < LESSON.steps.length - 1) {
      step++;
      render();
    }
  }
  function prev() { if (step > 0) { step--; render(); } }
  function home() {
    $("lesson").classList.add("hidden");
    $("result").classList.add("hidden");
    $("home").classList.remove("hidden");
    trainingMode = "lesson";
    activeSkillKey = null;
    activeRelationKey = null;
    closeConnectorRelations();
    renderHomeProfile();
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function restart() {
    const skillKey = trainingMode === "skill" ? activeSkillKey : null;
    const relationKey = trainingMode === "relation" ? activeRelationKey : null;
    pre = null;
    post = null;
    Object.keys(ans).forEach(k => delete ans[k]);
    Object.keys(inputValues).forEach(k => delete inputValues[k]);
    if (relationKey) startRelation(relationKey);
    else if (skillKey) startSkill(skillKey);
    else if (activeMaterialId) startMaterial(activeMaterialId);
  }
  function jump(i) {
    $("home").classList.add("hidden");
    $("result").classList.add("hidden");
    $("lesson").classList.remove("hidden");
    step = i;
    render();
  }

  function jumps() {
    if (!LESSON) return;
    const h = LESSON.steps.map((s,i) => `<button type="button" class="jump" data-jump="${i}">${i+1}. ${escapeHTML(s.title)}</button>`).join("");
    if ($("homeJump")) $("homeJump").innerHTML = h;
    if ($("lessonJump")) $("lessonJump").innerHTML = h;
  }

  function speakFr(encoded, ref) {
    const text = decodeURIComponent(encoded);
    recordPlay(ref);
    if (!("speechSynthesis" in window)) {
      alert("当前浏览器不支持语音播放，请使用 Chrome、Edge 或 Safari。");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = Number((ref && synthRates[ref]) || 1);
    u.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const fr = voices.find(v => /^fr[-_]/i.test(v.lang)) || voices.find(v => /français|french/i.test(v.name));
    if (fr) u.voice = fr;
    window.speechSynthesis.speak(u);
  }

  function findAudio(ref) {
    return document.querySelector('audio[data-audio-ref="'+CSS.escape(ref)+'"]');
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function syncAudioUI(audio) {
    if (!audio) return;
    const ref = audio.dataset.audioRef || "";
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const seek = document.querySelector('[data-audio-seek-ref="'+CSS.escape(ref)+'"]');
    if (seek && document.activeElement !== seek) seek.value = duration > 0 ? String(current / duration * 100) : "0";
    const time = document.querySelector('[data-audio-time-ref="'+CSS.escape(ref)+'"]');
    if (time) time.textContent = formatTime(current) + " / " + formatTime(duration);
    const icon = document.querySelector('[data-audio-play-icon-ref="'+CSS.escape(ref)+'"]');
    if (icon) icon.textContent = audio.paused ? "▶" : "Ⅱ";
  }

  function handleAudioAction(button) {
    const ref = button.dataset.audioRef || "";
    const audio = findAudio(ref);
    if (!audio) return;
    const action = button.dataset.audioAction;
    if (action === "toggle") {
      if (audio.paused) audio.play();
      else audio.pause();
    } else if (action === "replay") {
      audio.currentTime = 0;
      audio.play();
    } else if (action === "back") {
      audio.currentTime = Math.max(0, audio.currentTime - 3);
      syncAudioUI(audio);
    } else if (action === "speed") {
      audio.playbackRate = Number(button.dataset.speed || 1);
      const group = button.parentElement;
      if (group) group.querySelectorAll('[data-audio-action="speed"]').forEach(x => x.classList.toggle("active", x === button));
    }
  }

  function setSynthSpeed(button) {
    const ref = button.dataset.synthRef || "";
    synthRates[ref] = Number(button.dataset.synthSpeed || 1);
    const group = button.parentElement;
    if (group) group.querySelectorAll("[data-synth-speed]").forEach(x => x.classList.toggle("active", x === button));
  }

  function choose(id, index) {
    if (ans[id] !== undefined) return;
    const q = questionIndex[id];
    if (!q || q.type !== "mcq") return;
    ans[id] = index;
    recordQuestionAttempt(id, index === q.correct);
    const group = $(id);
    if (group) {
      [...group.children].forEach((button, i) => {
        button.classList.add("locked");
        if (i === q.correct) button.classList.add("correct");
        else if (i === index) button.classList.add("wrong");
      });
    }
    const feedback = $(id + "F");
    if (feedback) {
      feedback.className = "feedback show";
      feedback.innerHTML = (index === q.correct ? "✓ " : "再听一次。") + (q.feedback || "");
    }
  }

  function checkInput(id) {
    if (ans[id] !== undefined) return;
    const q = questionIndex[id];
    if (!q || q.type !== "input") return;
    const el = $(id + "I");
    const raw = el ? el.value : "";
    inputValues[id] = raw;
    const value = norm(raw);
    const ok = (q.answers || []).some(a => norm(a) === value);
    ans[id] = ok;
    recordQuestionAttempt(id, ok);
    if (el) el.disabled = true;
    const checkButton = document.querySelector('[data-check-input="' + CSS.escape(id) + '"]');
    if (checkButton) checkButton.disabled = true;
    const feedback = $(id + "F");
    if (feedback) {
      const success = q.successHtml || ('✓ <span class="fr">' + escapeHTML(q.displayAnswer || q.answers[0]) + '</span>');
      const failure = q.failureHtml || ('答案：<span class="fr">' + escapeHTML(q.displayAnswer || q.answers[0]) + '</span>');
      feedback.className = "feedback show";
      feedback.innerHTML = ok ? success : failure;
    }
  }

  function rate(kind, value, button) {
    if (kind === "pre") pre = value;
    else post = value;
    if (button && button.parentElement) {
      [...button.parentElement.children].forEach(x => x.classList.remove("sel"));
      button.classList.add("sel");
    }
    if (kind === "post" && $("cmp")) $("cmp").outerHTML = compareBlock();
  }

  function init() {
    document.title = "解码法语 · Décoder le français";
    const backToTop = $("backToTop");
    if (backToTop) {
      const syncBackToTop = () => backToTop.classList.toggle("show", window.scrollY > 480);
      backToTop.addEventListener("click", () => window.scrollTo({top:0, behavior:"smooth"}));
      window.addEventListener("scroll", syncBackToTop, {passive:true});
      syncBackToTop();
    }
    renderMaterialLibrary();
    renderSkillLibrary();
    renderHomeProfile();
    $("prevBtn").addEventListener("click", prev);
    $("nextBtn").addEventListener("click", next);
    $("finishBtn").addEventListener("click", showResult);
    $("homeBtn").addEventListener("click", home);
    $("resultHomeBtn").addEventListener("click", home);
    $("restartBtn").addEventListener("click", restart);
    document.addEventListener("click", e => {
      const choice = e.target.closest("[data-choice-id]");
      if (choice) return choose(choice.dataset.choiceId, Number(choice.dataset.choiceIndex));
      const speak = e.target.closest("[data-speak]");
      if (speak) return speakFr(speak.dataset.speak, speak.dataset.speakRef || null);
      const synthSpeed = e.target.closest("[data-synth-speed]");
      if (synthSpeed) return setSynthSpeed(synthSpeed);
      const audioAction = e.target.closest("[data-audio-action]");
      if (audioAction) return handleAudioAction(audioAction);
      const check = e.target.closest("[data-check-input]");
      if (check) return checkInput(check.dataset.checkInput);
      const rateBtn = e.target.closest("[data-rate-kind]");
      if (rateBtn) return rate(rateBtn.dataset.rateKind, Number(rateBtn.dataset.rateValue), rateBtn);
      const materialBtn = e.target.closest("[data-start-material]");
      if (materialBtn) return startMaterial(materialBtn.dataset.startMaterial);
      const openRelations = e.target.closest("[data-open-relations]");
      if (openRelations) return renderConnectorRelations();
      const closeRelations = e.target.closest("[data-close-relations]");
      if (closeRelations) return closeConnectorRelations();
      const relationBtn = e.target.closest("[data-start-relation]");
      if (relationBtn) return startRelation(relationBtn.dataset.startRelation);
      const skillBtn = e.target.closest("[data-start-skill]");
      if (skillBtn) return startSkill(skillBtn.dataset.startSkill);
      const scrollBtn = e.target.closest("[data-scroll-target]");
      if (scrollBtn) {
        const target = $(scrollBtn.dataset.scrollTarget);
        if (target) target.scrollIntoView({behavior:"smooth", block:"start"});
        return;
      }
      const jumpBtn = e.target.closest("[data-jump]");
      if (jumpBtn) return jump(Number(jumpBtn.dataset.jump));
    });
    document.addEventListener("play", e => {
      const audio = e.target && e.target.matches && e.target.matches("audio[data-audio-ref]") ? e.target : null;
      if (audio) {
        recordPlay(audio.dataset.audioRef || null);
        syncAudioUI(audio);
      }
    }, true);
    ["pause","ended","timeupdate","loadedmetadata"].forEach(eventName => {
      document.addEventListener(eventName, e => {
        const audio = e.target && e.target.matches && e.target.matches("audio[data-audio-ref]") ? e.target : null;
        if (audio) syncAudioUI(audio);
      }, true);
    });
    document.addEventListener("input", e => {
      const seekRef = e.target && e.target.dataset ? e.target.dataset.audioSeekRef : null;
      if (seekRef) {
        const audio = findAudio(seekRef);
        if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = Number(e.target.value || 0) / 100 * audio.duration;
          syncAudioUI(audio);
        }
        return;
      }
      const id = e.target && e.target.dataset ? e.target.dataset.inputValue : null;
      if (id) inputValues[id] = e.target.value;
    });
  }

  init();
})();
