(function decoderApp() {
  "use strict";
  const LESSON = window.LESSON;
  if (!LESSON) throw new Error("Lesson data not loaded.");

  let step = 0;
  let pre = null;
  let post = null;
  const ans = Object.create(null);
  const inputValues = Object.create(null);
  const questionIndex = Object.create(null);

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
  LESSON.steps.forEach(s => {
    indexBlocks(s.blocks);
    (s.drills || []).forEach(d => indexBlocks(d.blocks));
  });

  function norm(s) {
    return (s || "").trim().toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "'")
      .replace(/[^a-z' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function audioBlock(b) {
    const src = LESSON.audio[b.key] || "";
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
    $("count").textContent = `${step + 1} / ${LESSON.steps.length}`;
    $("bar").style.width = `${(step + 1) / LESSON.steps.length * 100}%`;
    $("content").innerHTML = renderStep(s);
    $("nextBtn").textContent = step === LESSON.steps.length - 1 ? "完成本次训练" : "下一步";
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function resultHtml() {
    return `<div class="card"><div class="pill">训练完成</div><h2>这次你解码了什么</h2><p class="muted">这里不做总分排名，只看哪些听力微技能已经比较稳定，哪些值得继续练。</p>${compareBlock()}<h3 style="margin-top:18px">本次听力画像</h3>${skillSummary()}</div>`;
  }

  function showResult() {
    $("lesson").classList.add("hidden");
    $("home").classList.add("hidden");
    $("result").classList.remove("hidden");
    $("resultContent").innerHTML = resultHtml();
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function start() {
    $("home").classList.add("hidden");
    $("result").classList.add("hidden");
    $("lesson").classList.remove("hidden");
    step = 0;
    render();
  }
  function next() {
    if (step < LESSON.steps.length - 1) {
      step++;
      render();
    } else {
      showResult();
    }
  }
  function prev() { if (step > 0) { step--; render(); } }
  function home() {
    $("lesson").classList.add("hidden");
    $("result").classList.add("hidden");
    $("home").classList.remove("hidden");
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function restart() {
    step = 0;
    pre = null;
    post = null;
    Object.keys(ans).forEach(k => delete ans[k]);
    Object.keys(inputValues).forEach(k => delete inputValues[k]);
    start();
  }
  function jump(i) {
    $("home").classList.add("hidden");
    $("result").classList.add("hidden");
    $("lesson").classList.remove("hidden");
    step = i;
    render();
  }

  function jumps() {
    const h = LESSON.steps.map((s,i) => `<button type="button" class="jump" data-jump="${i}">${i+1}. ${escapeHTML(s.title)}</button>`).join("");
    $("homeJump").innerHTML = h;
    $("lessonJump").innerHTML = h;
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
    document.title = `解码法语听力 · ${LESSON.meta.title}`;
    $("homeTitle").textContent = LESSON.meta.title;
    $("homeIntro").innerHTML = LESSON.meta.introHtml;
    $("homeDuration").textContent = LESSON.meta.duration;
    $("lessonName").textContent = LESSON.meta.title;
    $("lessonBadge").textContent = `${LESSON.meta.level} · ${LESSON.meta.audience}`;
    $("startBtn").addEventListener("click", start);
    $("prevBtn").addEventListener("click", prev);
    $("nextBtn").addEventListener("click", next);
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
      const jumpBtn = e.target.closest("[data-jump]");
      if (jumpBtn) return jump(Number(jumpBtn.dataset.jump));
    });
    document.addEventListener("input", e => {
      const id = e.target && e.target.dataset ? e.target.dataset.inputValue : null;
      if (id) inputValues[id] = e.target.value;
    });
    jumps();
  }

  init();
})();
