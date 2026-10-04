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
  let activeMaterialId = null;
  const loadedLessonIds = new Set();
  const ans = Object.create(null);
  const inputValues = Object.create(null);
  const questionIndex = Object.create(null);

  const SKILL_TAXONOMY = [
    {key:"groupes_de_mots",cn:"听语块",fr:"Groupes de mots",desc:"把连续语流切成有意义的声音单位。"},
    {key:"liaison_enchainement",cn:"连读衔接",fr:"Liaison / enchaînement",desc:"识别跨词边界产生的声音连接。"},
    {key:"francais_oral",cn:"真实口语",fr:"Français oral",desc:"识别省略、弱化、缩略和真实口语节奏。"},
    {key:"sens_en_contexte",cn:"语境词义",fr:"Sens en contexte",desc:"根据上下文确定表达在这里真正是什么意思。"},
    {key:"structures",cn:"听句型",fr:"Structures",desc:"利用结构锚点组织信息并预测后半句。"},
    {key:"temps_verbaux",cn:"听时态",fr:"Temps verbaux",desc:"从声音识别动词形式和动作时间关系。"},
    {key:"negation",cn:"听否定",fr:"Négation",desc:"在真实语流里抓住否定词和否定范围。"},
    {key:"connecteurs",cn:"听逻辑",fr:"Connecteurs",desc:"追踪转折、因果、让步、递进等论证方向。"}
  ];

  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
  const escapeAttr = escapeHTML;

  function indexBlocks(blocks) {
    (blocks || []).forEach(b => {
      if (b && b.id && (b.type === "mcq" || b.type === "input")) questionIndex[b.id] = b;
    });
  }

  function resetQuestionIndex() {
    Object.keys(questionIndex).forEach(k => delete questionIndex[k]);
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
    return `<div><small class="muted">${escapeHTML(b.label || "")}</small><audio controls playsinline preload="metadata" src="${escapeAttr(src)}"></audio></div>`;
  }

  function synthBlock(b) {
    return `<div><small class="muted">${escapeHTML(b.label || "")}</small><button type="button" class="synth" data-speak="${escapeAttr(encodeURIComponent(b.text || ""))}">▶ 播放句子</button></div>`;
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
    if (!done.length) return {s:"未完成", n:"完成本模块后这里会显示结果。"};
    const score = done.filter(Boolean).length;
    if (score === done.length) return {s:"表现稳定", n:"这一微技能的识别、对比和迁移都比较稳定。"};
    if (score >= Math.ceil(done.length * 2 / 3)) return {s:"基本稳定", n:"大部分已经能跟上，个别声音或结构值得再听一次。"};
    return {s:"建议复习", n:"这一微技能仍容易漏掉，建议再做一遍原文识别 → 对比 → 迁移。"};
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
    const s = LESSON.steps[step];
    $("title").textContent = s.title;
    $("content").innerHTML = renderStep(s);

    if (trainingMode === "skill") {
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
      const inner = '<div class="skillcardtop"><div><b>'+escapeHTML(skill.cn)+'</b><div class="skillfr">'+escapeHTML(skill.fr)+'</div></div><span class="skillcount">'+countText+'</span></div><div class="skilldesc">'+escapeHTML(skill.desc)+'</div>'+(has ? '<div class="skillcta">进入专项练习 →</div>' : '');
      return has
        ? '<button type="button" class="skillcard available" data-start-skill="'+escapeAttr(skill.key)+'">'+inner+'</button>'
        : '<div class="skillcard">'+inner+'</div>';
    }).join("");
  }

  function renderHomeProfile() {
    const target = $("profileHome");
    if (!target) return;
    if (!hasCompletedSession) {
      target.innerHTML = '<div class="profileempty"><b>完成一次完整训练后，这里会出现你的最近一次听力画像。</b><div class="muted">长期版本会累计不同素材中的表现，用来判断你更容易卡在声音切分、语境词义、句法还是篇章逻辑。</div></div>';
      return;
    }
    const preText = pre == null ? "—" : pre + "%";
    const postText = post == null ? "—" : post + "%";
    target.innerHTML = '<div class="profilemetrics"><div class="metric"><b>'+preText+'</b><small>第一次自评</small></div><div class="metric"><b>'+postText+'</b><small>最终自评</small></div></div><h3>最近一次训练</h3>'+skillSummary();
  }

  function activeSkill() {
    return LESSON.skills.find(s => s.key === activeSkillKey) || null;
  }

  function singleSkillSummary(skill) {
    if (!skill) return "";
    const status = skillStatus(skill.items.map(isCorrect));
    return '<div class="skillsum"><div class="skillrow"><div class="skilltop"><b>'+escapeHTML(skill.name)+'</b><span class="skillstate">'+escapeHTML(status.s)+'</span></div><div class="skillnote">'+escapeHTML(status.n)+'</div></div></div>';
  }

  function resultHtml() {
    if (trainingMode === "skill") {
      const skill = activeSkill();
      return `<div class="card"><div class="pill">专项训练完成</div><h2>${escapeHTML(skill ? skill.name : "微技能")}</h2><p class="muted">这次只看这一项微技能，不和其他能力混在一起。</p><h3 style="margin-top:18px">本次表现</h3>${singleSkillSummary(skill)}</div>`;
    }
    return `<div class="card"><div class="pill">训练完成</div><h2>这次你解码了什么</h2><p class="muted">这里不做总分排名，只看哪些听力微技能已经比较稳定，哪些值得继续练。</p>${compareBlock()}<h3 style="margin-top:18px">本次听力画像</h3>${skillSummary()}</div>`;
  }

  function showResult() {
    hasCompletedSession = true;
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
    renderHomeProfile();
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function restart() {
    const skillKey = trainingMode === "skill" ? activeSkillKey : null;
    pre = null;
    post = null;
    Object.keys(ans).forEach(k => delete ans[k]);
    Object.keys(inputValues).forEach(k => delete inputValues[k]);
    if (skillKey) startSkill(skillKey);
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

  function speakFr(encoded) {
    const text = decodeURIComponent(encoded);
    if (!("speechSynthesis" in window)) {
      alert("当前浏览器不支持语音播放，请使用 Chrome、Edge 或 Safari。");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = .92;
    u.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const fr = voices.find(v => /^fr[-_]/i.test(v.lang)) || voices.find(v => /français|french/i.test(v.name));
    if (fr) u.voice = fr;
    window.speechSynthesis.speak(u);
  }

  function choose(id, index) {
    if (ans[id] !== undefined) return;
    const q = questionIndex[id];
    if (!q || q.type !== "mcq") return;
    ans[id] = index;
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
      if (speak) return speakFr(speak.dataset.speak);
      const check = e.target.closest("[data-check-input]");
      if (check) return checkInput(check.dataset.checkInput);
      const rateBtn = e.target.closest("[data-rate-kind]");
      if (rateBtn) return rate(rateBtn.dataset.rateKind, Number(rateBtn.dataset.rateValue), rateBtn);
      const materialBtn = e.target.closest("[data-start-material]");
      if (materialBtn) return startMaterial(materialBtn.dataset.startMaterial);
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
    document.addEventListener("input", e => {
      const id = e.target && e.target.dataset ? e.target.dataset.inputValue : null;
      if (id) inputValues[id] = e.target.value;
    });
  }

  init();
})();
