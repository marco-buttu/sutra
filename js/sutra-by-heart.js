(() => {
  "use strict";

  const app = document.querySelector("#app");
  const data = window.SUTRA_BY_HEART_DATA;
  if (!data) {
    app.textContent = "Application data is unavailable.";
    return;
  }

  const catalog = data.catalog;
  const currentLocale = catalog.defaultLocale;
  const sourceLocale = catalog.sourceLocale;
  const currentLocaleData = data.locales[currentLocale] || data.locales[sourceLocale];
  const sourceLocaleData = data.locales[sourceLocale] || currentLocaleData;
  const currentUi = currentLocaleData.ui || sourceLocaleData.ui;
  const sourceUi = sourceLocaleData.ui || currentUi;
  const player = new Audio();
  const embeddedAudio = window.SUTRA_BY_HEART_EMBEDDED_AUDIO || {};
  const voiceId = catalog.defaultVoiceId;
  const voiceAudio = data.audioManifest.voices.find(
    (voice) => voice.voiceId === voiceId
  );
  const audioByChapter = new Map(
    voiceAudio.chapters.map((chapter) => [chapter.chapterId, chapter])
  );
  const coreSutraById = new Map(data.sutras.map((sutra) => [sutra.id, sutra]));

  let playbackMode = "idle";
  let activeButton = null;
  let sequenceState = null;
  let sequenceUi = null;

  player.preload = "metadata";

  function valueAtPath(object, path) {
    return path.split(".").reduce(
      (value, key) => (value && key in value ? value[key] : undefined),
      object
    );
  }

  function message(path, values = {}) {
    const template = valueAtPath(currentUi, path) ?? valueAtPath(sourceUi, path) ?? path;
    return Object.entries(values).reduce(
      (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
      template
    );
  }

  function localizedChapterById(localeData, chapterId) {
    return localeData.chapters.find((chapter) => chapter.chapterId === chapterId);
  }

  function buildChapters() {
    return data.chapters
      .slice()
      .sort((left, right) => left.number - right.number)
      .map((coreChapter) => {
        const fallback = localizedChapterById(sourceLocaleData, coreChapter.id);
        const localized = localizedChapterById(currentLocaleData, coreChapter.id) || fallback;
        const fallbackSutras = new Map(
          fallback.sutras.map((sutra) => [sutra.sutraId, sutra])
        );
        const localizedSutras = new Map(
          localized.sutras.map((sutra) => [sutra.sutraId, sutra])
        );
        const chapterAudio = audioByChapter.get(coreChapter.id);
        const sutras = coreChapter.sutraIds.map((identifier) => {
          const core = coreSutraById.get(identifier);
          const fallbackContent = fallbackSutras.get(identifier);
          const localizedContent = localizedSutras.get(identifier) || fallbackContent;
          return {
            ...core,
            ...fallbackContent,
            ...localizedContent,
            audio: chapterAudio.sutras[identifier]
          };
        });
        return {
          ...coreChapter,
          ...fallback,
          ...localized,
          count: sutras.length,
          openingAudio: chapterAudio.opening,
          closingAudio: chapterAudio.closing,
          sutras
        };
      });
  }

  const chapters = buildChapters();
  const restartCueAudio = data.audioManifest.restartCue;

  document.documentElement.lang = currentLocale;
  document.title = message("metadata.pageTitle");

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function resolveAudio(source) {
    return embeddedAudio[source] || source;
  }

  function chapterLabel(chapter) {
    return `${message("home.chapterLabel", {chapter: chapter.number})} · ${chapter.title}`;
  }

  function audioButton(source, label) {
    return `
      <button class="audio-button" type="button"
        data-audio="${escapeHtml(source)}"
        aria-label="${escapeHtml(label)}"
        aria-pressed="false">
        <span class="audio-icon" aria-hidden="true"></span>
        <span class="audio-label">${escapeHtml(message("audio.play"))}</span>
      </button>`;
  }

  function homeCreditsMarkup() {
    const credits = catalog.credits;
    return `
      <div class="cover-credits">
        <p class="cover-credit">
          <span>${escapeHtml(message("cover.authorLabel"))}</span>
          <a href="${escapeHtml(credits.authorUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(credits.authorName)}</a>
        </p>
        <p class="cover-credit">
          <span>${escapeHtml(message("cover.voiceLabel"))}</span>
          <span>${escapeHtml(credits.voiceHonorific)}</span>
          <a href="${escapeHtml(credits.voiceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(credits.voiceName)}</a>
        </p>
        <details class="cover-note">
          <summary>${escapeHtml(message("cover.importantNoteTitle"))}</summary>
          <p>${escapeHtml(message("cover.importantNote"))}</p>
        </details>
      </div>`;
  }

  function coverMarkup({home = false, title, subtitle = "", count}) {
    return `
      <header class="cover ${home ? "home-cover" : "chapter-cover"}">
        <div class="cover-inner">
          <p class="kicker">${escapeHtml(message("cover.kicker"))}</p>
          <div class="cover-rule" aria-hidden="true"></div>
          <h1>${escapeHtml(title)}</h1>
          ${home ? homeCreditsMarkup() : `<p class="subtitle">${escapeHtml(subtitle)}</p>`}
          <p class="cover-count">${escapeHtml(count)}</p>
        </div>
      </header>`;
  }

  function renderHome() {
    stopPlayback();

    const totalSutras = chapters.reduce((sum, chapter) => sum + chapter.count, 0);
    const cards = chapters.map((chapter) => `
      <button class="chapter-card ${escapeHtml(chapter.theme)}"
        type="button" data-chapter-link="${chapter.number}">
        <span class="chapter-card-content">
          <span class="chapter-index">${escapeHtml(message("home.chapterLabel", {
            chapter: String(chapter.number).padStart(2, "0")
          }))}</span>
          <strong class="chapter-card-title">${escapeHtml(chapter.title)}</strong>
          <span class="chapter-card-meta">${escapeHtml(message("home.sutraCount", {
            sutras: chapter.count
          }))}</span>
        </span>
      </button>`).join("");

    app.innerHTML = `
      ${coverMarkup({
        home: true,
        title: "Sutra by Heart",
        count: message("cover.homeCount", {
          chapters: String(chapters.length).padStart(2, "0"),
          sutras: totalSutras
        })
      })}
      <main class="home-document">
        <section class="home-panel study-panel" aria-labelledby="study-title">
          <div class="panel-heading">
            <h2 class="panel-title" id="study-title">${escapeHtml(message("home.studyTitle"))}</h2>
            <p class="panel-description">${escapeHtml(message("home.studyDescription"))}</p>
          </div>
          <div class="chapter-grid">${cards}</div>
        </section>

        <section class="home-panel continuous-panel" aria-labelledby="continuous-title">
          <div class="panel-heading">
            <h2 class="panel-title" id="continuous-title">${escapeHtml(message("home.continuousTitle"))}</h2>
            <p class="panel-description">${escapeHtml(message("home.continuousDescription"))}</p>
          </div>

          <div class="continuous-controls">
            <label class="control-field chapter-field">
              <span>${escapeHtml(message("continuous.chapterLabel"))}</span>
              <select id="sequence-chapter">
                ${chapters.map((chapter) => `
                  <option value="${chapter.number}">${escapeHtml(chapterLabel(chapter))}</option>
                `).join("")}
              </select>
            </label>

            <label class="control-field mode-field">
              <span>${escapeHtml(message("continuous.selectionLabel"))}</span>
              <select id="sequence-mode">
                <option value="all">${escapeHtml(message("continuous.allOption"))}</option>
                <option value="range">${escapeHtml(message("continuous.rangeOption"))}</option>
              </select>
            </label>

            <label class="control-field" id="sequence-start-field" hidden>
              <span>${escapeHtml(message("continuous.fromLabel"))}</span>
              <select id="sequence-start"></select>
            </label>

            <label class="control-field" id="sequence-end-field" hidden>
              <span>${escapeHtml(message("continuous.toLabel"))}</span>
              <select id="sequence-end"></select>
            </label>

            <div class="continuous-options">
              <label class="repeat-control">
                <input id="sequence-repeat" type="checkbox" checked>
                <span>${escapeHtml(message("continuous.repeatLabel"))}</span>
              </label>
              <label class="repeat-control">
                <input id="sequence-bell" type="checkbox" checked>
                <span>${escapeHtml(message("continuous.bellLabel"))}</span>
              </label>
              <label class="repeat-control">
                <input id="sequence-repetition-pause" type="checkbox">
                <span>${escapeHtml(message("continuous.repetitionPauseLabel"))}</span>
              </label>
            </div>
          </div>

          <div class="continuous-player">
            <button class="sequence-play" id="sequence-play" type="button" aria-pressed="false">
              <span class="audio-icon" aria-hidden="true"></span>
              <span class="sequence-play-label">${escapeHtml(message("continuous.start"))}</span>
            </button>
            <button class="sequence-stop" id="sequence-stop" type="button" disabled>
              ${escapeHtml(message("continuous.stop"))}
            </button>
            <p class="sequence-status" id="sequence-status" aria-live="polite">
              ${escapeHtml(message("continuous.ready"))}
            </p>
          </div>

          <div class="sequence-current" id="sequence-current" aria-live="polite" hidden>
            <p class="sequence-current-sanskrit"></p>
            <p class="sequence-current-pronunciation"></p>
          </div>
        </section>
      </main>`;

    document.querySelectorAll("[data-chapter-link]").forEach((button) => {
      button.addEventListener("click", () => {
        window.location.hash = `chapter=${button.dataset.chapterLink}`;
      });
    });

    setupContinuousRecitation();
  }

  function recitationMarkup(kind, title, source, chapter) {
    const labelPath = kind === "opening" ? "audio.openingLabel" : "audio.closingLabel";
    return `
      <section class="recitation ${kind}">
        <div class="recitation-heading">
          <p class="recitation-title">${escapeHtml(title)}</p>
          ${audioButton(source, message(labelPath, {title, chapter: chapter.title}))}
        </div>
      </section>`;
  }

  function wordsText(wordMeanings) {
    return wordMeanings
      .map((entry) => `${entry.term} = ${entry.meaning}`)
      .join("; ");
  }

  function explanationMarkup(explanation) {
    if (!catalog.features.explanations || !explanation) {
      return "";
    }
    return `
      <details class="sutra-explanation">
        <summary>${escapeHtml(message("sutra.explanationLabel"))}</summary>
        <p class="sutra-explanation-text">${escapeHtml(explanation)}</p>
      </details>`;
  }

  function sutraMarkup(sutra) {
    return `
      <article class="sutra" id="${escapeHtml(sutra.id)}">
        <div class="sutra-side">
          <p class="number">${escapeHtml(sutra.number)}</p>
          ${audioButton(sutra.audio, message("sutra.playLabel", {number: sutra.number}))}
        </div>
        <div class="sutra-content">
          <p class="sanskrit">${escapeHtml(sutra.sanskrit)}</p>
          <p class="pronunciation">${escapeHtml(sutra.pronunciation)}</p>
          <p class="words"><span class="label">${escapeHtml(message("sutra.wordsLabel"))}</span> ${escapeHtml(wordsText(sutra.wordMeanings))}</p>
          <p class="meaning"><span class="label">${escapeHtml(message("sutra.meaningLabel"))}</span> ${escapeHtml(sutra.meaning)}</p>
          ${explanationMarkup(sutra.explanation)}
        </div>
      </article>`;
  }

  function chapterIntroductionMarkup(chapter) {
    if (!chapter.description) {
      return "";
    }
    return `
      <section class="chapter-introduction">
        <h2 class="chapter-introduction-title">${escapeHtml(message("chapter.aboutTitle"))}</h2>
        <p class="chapter-introduction-text">${escapeHtml(chapter.description)}</p>
      </section>`;
  }

  function renderChapter(chapter) {
    stopPlayback();

    app.innerHTML = `
      ${coverMarkup({
        title: chapter.title,
        subtitle: chapter.subtitle,
        count: message("cover.chapterCount", {
          chapter: String(chapter.number).padStart(2, "0"),
          sutras: chapter.count
        })
      })}
      <main class="chapter-document">
        <nav class="chapter-toolbar">
          <button class="home-button" type="button" id="home-button">${escapeHtml(message("navigation.home"))}</button>
          <p class="chapter-toolbar-note">${escapeHtml(message("navigation.chapterPosition", {
            chapter: chapter.number,
            total: chapters.length
          }))}</p>
        </nav>

        ${chapterIntroductionMarkup(chapter)}

        ${recitationMarkup(
          "opening",
          message("chapter.openingRecitation"),
          chapter.openingAudio,
          chapter
        )}

        <div class="document-heading">
          <span class="document-heading-title">${escapeHtml(chapter.title)}</span>
          <span class="document-heading-detail">${escapeHtml(message("chapter.documentDetail"))}</span>
        </div>

        <div class="sutra-list">
          ${chapter.sutras.map(sutraMarkup).join("")}
        </div>

        ${recitationMarkup(
          "closing",
          message("chapter.closingRecitation"),
          chapter.closingAudio,
          chapter
        )}
      </main>`;

    document.querySelector("#home-button").addEventListener("click", () => {
      window.location.hash = "";
    });

    document.querySelectorAll(".audio-button").forEach(setupAudioButton);
  }

  function resetAudioButton(button) {
    if (!button) {
      return;
    }
    button.classList.remove("is-playing");
    button.setAttribute("aria-pressed", "false");
    button.querySelector(".audio-label").textContent = message("audio.play");
  }

  function markAudioButtonPlaying(button) {
    button.classList.add("is-playing");
    button.setAttribute("aria-pressed", "true");
    button.querySelector(".audio-label").textContent = message("audio.pause");
  }

  function clearPlayerSource() {
    player.removeAttribute("src");
    player.load();
  }

  function stopPlayback() {
    player.pause();
    resetAudioButton(activeButton);
    activeButton = null;
    playbackMode = "idle";
    if (sequenceState?.pauseTimer) {
      window.clearTimeout(sequenceState.pauseTimer);
    }
    sequenceState = null;
    sequenceUi = null;
    clearPlayerSource();
  }

  function setupAudioButton(button) {
    button.addEventListener("click", async () => {
      const source = button.dataset.audio;

      if (playbackMode === "single" && activeButton === button) {
        if (player.paused) {
          try {
            await player.play();
          } catch (error) {
            resetAudioButton(button);
          }
        } else {
          player.pause();
        }
        return;
      }

      player.pause();
      resetAudioButton(activeButton);
      sequenceState = null;
      playbackMode = "single";
      activeButton = button;
      player.src = resolveAudio(source);

      try {
        await player.play();
      } catch (error) {
        resetAudioButton(button);
        activeButton = null;
        playbackMode = "idle";
      }
    });
  }

  function setupContinuousRecitation() {
    const chapterSelect = document.querySelector("#sequence-chapter");
    const modeSelect = document.querySelector("#sequence-mode");
    const startField = document.querySelector("#sequence-start-field");
    const endField = document.querySelector("#sequence-end-field");
    const startSelect = document.querySelector("#sequence-start");
    const endSelect = document.querySelector("#sequence-end");
    const repeatInput = document.querySelector("#sequence-repeat");
    const bellInput = document.querySelector("#sequence-bell");
    const repetitionPauseInput = document.querySelector("#sequence-repetition-pause");
    const playButton = document.querySelector("#sequence-play");
    const playLabel = playButton.querySelector(".sequence-play-label");
    const stopButton = document.querySelector("#sequence-stop");
    const status = document.querySelector("#sequence-status");
    const currentTrack = document.querySelector("#sequence-current");
    const currentSanskrit = currentTrack.querySelector(".sequence-current-sanskrit");
    const currentPronunciation = currentTrack.querySelector(
      ".sequence-current-pronunciation"
    );

    function selectedChapter() {
      return chapters.find((chapter) => chapter.number === Number(chapterSelect.value));
    }

    function populateRange() {
      const chapter = selectedChapter();
      const options = chapter.sutras.map((sutra, index) => (
        `<option value="${index}">${escapeHtml(sutra.number)}</option>`
      )).join("");
      startSelect.innerHTML = options;
      endSelect.innerHTML = options;
      startSelect.value = "0";
      endSelect.value = String(chapter.sutras.length - 1);
    }

    function setControlsDisabled(disabled) {
      chapterSelect.disabled = disabled;
      modeSelect.disabled = disabled;
      startSelect.disabled = disabled;
      endSelect.disabled = disabled;
    }

    function setPlayState(state) {
      const playing = state === "playing";
      playButton.classList.toggle("is-playing", playing);
      playButton.setAttribute("aria-pressed", playing ? "true" : "false");
      playLabel.textContent =
        state === "playing" ? message("continuous.pause") :
        state === "paused" ? message("continuous.resume") :
        message("continuous.start");
    }

    function buildQueue() {
      const sutras = selectedChapter().sutras;
      if (modeSelect.value === "all") {
        return sutras.slice();
      }
      return sutras.slice(
        Number(startSelect.value),
        Number(endSelect.value) + 1
      );
    }

    function updateStatus(state) {
      if (!sequenceState) {
        return;
      }
      const track = sequenceState.queue[sequenceState.index];
      status.textContent = message("continuous.trackStatus", {
        state,
        number: track.number,
        current: sequenceState.index + 1,
        total: sequenceState.queue.length
      });
    }

    function showCurrentTrack(track) {
      currentSanskrit.textContent = track.sanskrit;
      currentPronunciation.textContent = track.pronunciation;
      currentTrack.hidden = false;
    }

    function hideCurrentTrack() {
      currentTrack.hidden = true;
      currentSanskrit.textContent = "";
      currentPronunciation.textContent = "";
    }

    function clearPauseTimer() {
      if (sequenceState?.pauseTimer) {
        window.clearTimeout(sequenceState.pauseTimer);
        sequenceState.pauseTimer = null;
      }
    }

    function stopSequence(statusMessage = message("continuous.ready")) {
      player.pause();
      clearPauseTimer();
      playbackMode = "idle";
      sequenceState = null;
      setPlayState("idle");
      setControlsDisabled(false);
      stopButton.disabled = true;
      status.textContent = statusMessage;
      hideCurrentTrack();
      clearPlayerSource();
    }

    async function playCurrentTrack() {
      if (!sequenceState) {
        return;
      }
      clearPauseTimer();
      sequenceState.phase = "track";
      const track = sequenceState.queue[sequenceState.index];
      showCurrentTrack(track);
      player.src = resolveAudio(track.audio);
      try {
        await player.play();
      } catch (error) {
        stopSequence(message("errors.sequenceTrack", {number: track.number}));
      }
    }

    async function playBellCue() {
      if (!sequenceState) {
        return;
      }
      clearPauseTimer();
      sequenceState.phase = "bell";
      hideCurrentTrack();
      status.textContent = message("continuous.bellPlaying");
      player.src = resolveAudio(restartCueAudio);
      try {
        await player.play();
      } catch (error) {
        stopSequence(message("errors.bellCue"));
      }
    }

    async function advanceAfterTrack() {
      if (!sequenceState) {
        return;
      }
      if (sequenceState.index < sequenceState.queue.length - 1) {
        sequenceState.index += 1;
        await playCurrentTrack();
      } else if (sequenceState.repeat) {
        if (sequenceState.bell) {
          await playBellCue();
        } else {
          sequenceState.index = 0;
          await playCurrentTrack();
        }
      } else {
        stopSequence(message("continuous.completed"));
      }
    }

    function startRepetitionPause(durationMilliseconds) {
      if (!sequenceState) {
        return;
      }
      const track = sequenceState.queue[sequenceState.index];
      sequenceState.phase = "repetition-pause";
      sequenceState.pauseRemaining = durationMilliseconds;
      sequenceState.pauseDeadline = Date.now() + durationMilliseconds;
      sequenceState.pauseTimer = window.setTimeout(() => {
        if (!sequenceState) {
          return;
        }
        sequenceState.pauseTimer = null;
        advanceAfterTrack();
      }, durationMilliseconds);
      setPlayState("playing");
      status.textContent = message("continuous.repetitionPause", {
        number: track.number
      });
    }

    function pauseRepetitionTimer() {
      if (!sequenceState || sequenceState.phase !== "repetition-pause") {
        return;
      }
      sequenceState.pauseRemaining = Math.max(
        0,
        sequenceState.pauseDeadline - Date.now()
      );
      clearPauseTimer();
      setPlayState("paused");
      status.textContent = message("continuous.repetitionPausePaused");
    }

    function resumeRepetitionTimer() {
      if (!sequenceState || sequenceState.phase !== "repetition-pause") {
        return;
      }
      startRepetitionPause(sequenceState.pauseRemaining);
    }

    chapterSelect.addEventListener("change", populateRange);

    modeSelect.addEventListener("change", () => {
      const showRange = modeSelect.value === "range";
      startField.hidden = !showRange;
      endField.hidden = !showRange;
    });

    startSelect.addEventListener("change", () => {
      if (Number(startSelect.value) > Number(endSelect.value)) {
        endSelect.value = startSelect.value;
      }
    });

    endSelect.addEventListener("change", () => {
      if (Number(endSelect.value) < Number(startSelect.value)) {
        startSelect.value = endSelect.value;
      }
    });

    playButton.addEventListener("click", async () => {
      if (playbackMode === "sequence" && sequenceState) {
        if (sequenceState.phase === "repetition-pause") {
          if (sequenceState.pauseTimer) {
            pauseRepetitionTimer();
          } else {
            resumeRepetitionTimer();
          }
          return;
        }
        if (player.paused) {
          try {
            await player.play();
          } catch (error) {
            stopSequence(message("errors.resume"));
          }
        } else {
          player.pause();
        }
        return;
      }

      const queue = buildQueue();
      if (!queue.length) {
        status.textContent = message("continuous.noSutras");
        return;
      }

      playbackMode = "sequence";
      sequenceState = {
        queue,
        index: 0,
        repeat: repeatInput.checked,
        bell: bellInput.checked,
        repetitionPause: repetitionPauseInput.checked,
        phase: "track",
        pauseTimer: null,
        pauseRemaining: 0,
        pauseDeadline: 0
      };
      setControlsDisabled(true);
      stopButton.disabled = false;
      await playCurrentTrack();
    });

    stopButton.addEventListener("click", () => stopSequence());

    repeatInput.addEventListener("change", () => {
      if (sequenceState) {
        sequenceState.repeat = repeatInput.checked;
      }
    });

    bellInput.addEventListener("change", () => {
      if (sequenceState) {
        sequenceState.bell = bellInput.checked;
      }
    });

    repetitionPauseInput.addEventListener("change", () => {
      if (!sequenceState) {
        return;
      }
      sequenceState.repetitionPause = repetitionPauseInput.checked;
      if (!sequenceState.repetitionPause && sequenceState.phase === "repetition-pause") {
        clearPauseTimer();
        advanceAfterTrack();
      }
    });

    sequenceUi = {
      playCurrentTrack,
      playBellCue,
      advanceAfterTrack,
      startRepetitionPause,
      setPlayState,
      stopSequence,
      updateStatus,
      setStatus: (value) => {
        status.textContent = value;
      }
    };
    populateRange();
  }

  player.addEventListener("play", () => {
    if (playbackMode === "single" && activeButton) {
      markAudioButtonPlaying(activeButton);
    } else if (playbackMode === "sequence" && sequenceState && sequenceUi) {
      sequenceUi.setPlayState("playing");
      if (sequenceState.phase === "bell") {
        sequenceUi.setStatus(message("continuous.bellPlaying"));
      } else {
        sequenceUi.updateStatus(message("continuous.playingState"));
      }
    }
  });

  player.addEventListener("pause", () => {
    if (playbackMode === "single" && activeButton) {
      resetAudioButton(activeButton);
    } else if (
      playbackMode === "sequence" &&
      sequenceState &&
      sequenceUi &&
      !player.ended
    ) {
      sequenceUi.setPlayState("paused");
      if (sequenceState.phase === "bell") {
        sequenceUi.setStatus(message("continuous.bellPaused"));
      } else {
        sequenceUi.updateStatus(message("continuous.pausedState"));
      }
    }
  });

  player.addEventListener("ended", () => {
    if (playbackMode === "single") {
      resetAudioButton(activeButton);
      activeButton = null;
      playbackMode = "idle";
    } else if (playbackMode === "sequence" && sequenceState && sequenceUi) {
      if (sequenceState.phase === "bell") {
        sequenceState.index = 0;
        sequenceUi.playCurrentTrack();
      } else {
        const durationMilliseconds = Number.isFinite(player.duration)
          ? player.duration * 1100
          : 0;
        if (sequenceState.repetitionPause && durationMilliseconds > 0) {
          sequenceUi.startRepetitionPause(durationMilliseconds);
        } else {
          sequenceUi.advanceAfterTrack();
        }
      }
    }
  });

  function renderRoute() {
    const match = window.location.hash.match(/^#chapter=(\d+)$/);
    const chapter = match
      ? chapters.find((item) => item.number === Number(match[1]))
      : null;

    if (chapter) {
      renderChapter(chapter);
    } else {
      renderHome();
    }

    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", renderRoute);
  renderRoute();
})();
