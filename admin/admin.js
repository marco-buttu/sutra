(() => {
  "use strict";

  const elements = {
    locale: document.querySelector("#locale-select"),
    chapter: document.querySelector("#chapter-select"),
    sutra: document.querySelector("#sutra-select"),
    previous: document.querySelector("#previous-sutra"),
    next: document.querySelector("#next-sutra"),
    status: document.querySelector("#editor-status"),
    chapterForm: document.querySelector("#chapter-form"),
    chapterTitle: document.querySelector("#chapter-title"),
    chapterSubtitle: document.querySelector("#chapter-subtitle"),
    chapterDescription: document.querySelector("#chapter-description"),
    resetChapter: document.querySelector("#reset-chapter"),
    saveChapter: document.querySelector("#save-chapter"),
    sutraForm: document.querySelector("#sutra-form"),
    sutraIdentifier: document.querySelector("#sutra-identifier"),
    sutraNumber: document.querySelector("#sutra-number"),
    changeState: document.querySelector("#change-state"),
    sanskrit: document.querySelector("#sanskrit"),
    pronunciation: document.querySelector("#pronunciation"),
    hintPronunciations: document.querySelector("#hint-pronunciations"),
    wordList: document.querySelector("#word-list"),
    wordTemplate: document.querySelector("#word-row-template"),
    addWord: document.querySelector("#add-word"),
    meaning: document.querySelector("#meaning"),
    explanation: document.querySelector("#explanation"),
    resetSutra: document.querySelector("#reset-sutra"),
    saveSutra: document.querySelector("#save-sutra")
  };

  const state = {
    data: null,
    locale: null,
    chapterId: null,
    sutraId: null,
    sutraDirty: false,
    chapterDirty: false,
    saving: false
  };

  function setStatus(message, type = "info") {
    elements.status.textContent = message;
    elements.status.classList.toggle("is-error", type === "error");
    elements.status.classList.toggle("is-success", type === "success");
  }

  function setDirty(kind, dirty) {
    state[`${kind}Dirty`] = dirty;
    const anyDirty = state.sutraDirty || state.chapterDirty;
    elements.changeState.textContent = anyDirty ? "Unsaved changes" : "Saved";
    elements.changeState.classList.toggle("is-dirty", anyDirty);
  }

  function hasUnsavedChanges() {
    return state.sutraDirty || state.chapterDirty;
  }

  function confirmDiscard() {
    return !hasUnsavedChanges() || window.confirm("Discard unsaved changes?");
  }

  function currentChapters() {
    return state.data.content[state.locale];
  }

  function currentChapter() {
    return currentChapters().find((chapter) => chapter.id === state.chapterId);
  }

  function currentSutra() {
    return currentChapter().sutras.find((sutra) => sutra.id === state.sutraId);
  }

  function replaceOptions(select, items, valueFor, labelFor, selectedValue) {
    select.replaceChildren();
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = valueFor(item);
      option.textContent = labelFor(item);
      select.append(option);
    });
    select.value = selectedValue;
  }

  function renderSelectors() {
    replaceOptions(
      elements.locale,
      state.data.locales,
      (locale) => locale,
      (locale) => locale.toUpperCase(),
      state.locale
    );
    replaceOptions(
      elements.chapter,
      currentChapters(),
      (chapter) => chapter.id,
      (chapter) => `${chapter.number}. ${chapter.title}`,
      state.chapterId
    );
    replaceOptions(
      elements.sutra,
      currentChapter().sutras,
      (sutra) => sutra.id,
      (sutra) => `${sutra.number} - ${sutra.sanskrit}`,
      state.sutraId
    );
  }

  function renderChapter() {
    const chapter = currentChapter();
    elements.chapterTitle.value = chapter.title;
    elements.chapterSubtitle.value = chapter.subtitle;
    elements.chapterDescription.value = chapter.description;
    setDirty("chapter", false);
  }

  function updateWordButtons() {
    const rows = [...elements.wordList.querySelectorAll(".word-row")];
    rows.forEach((row, index) => {
      row.querySelector(".move-up").disabled = index === 0;
      row.querySelector(".move-down").disabled = index === rows.length - 1;
      row.querySelector(".remove-word").disabled = rows.length === 1;
    });
  }

  function addWordRow(word = {term: "", meaning: ""}, position = null) {
    const row = elements.wordTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".word-term").value = word.term;
    row.querySelector(".word-meaning").value = word.meaning;

    row.querySelector(".move-up").addEventListener("click", () => {
      const previous = row.previousElementSibling;
      if (previous) {
        elements.wordList.insertBefore(row, previous);
        setDirty("sutra", true);
        updateWordButtons();
      }
    });
    row.querySelector(".move-down").addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next) {
        elements.wordList.insertBefore(next, row);
        setDirty("sutra", true);
        updateWordButtons();
      }
    });
    row.querySelector(".remove-word").addEventListener("click", () => {
      row.remove();
      setDirty("sutra", true);
      updateWordButtons();
    });

    if (position) {
      elements.wordList.insertBefore(row, position);
    } else {
      elements.wordList.append(row);
    }
    updateWordButtons();
    return row;
  }

  function renderSutra() {
    const sutra = currentSutra();
    elements.sutraIdentifier.textContent = sutra.id;
    elements.sutraNumber.textContent = `Sutra ${sutra.number}`;
    elements.sanskrit.value = sutra.sanskrit;
    elements.pronunciation.value = sutra.pronunciation;
    elements.hintPronunciations.value = sutra.hintPronunciations.join("\n");
    elements.meaning.value = sutra.meaning;
    elements.explanation.value = sutra.explanation;
    elements.wordList.replaceChildren();
    sutra.wordMeanings.forEach((word) => addWordRow(word));
    setDirty("sutra", false);

    const sutras = currentChapter().sutras;
    const index = sutras.findIndex((item) => item.id === state.sutraId);
    elements.previous.disabled = index === 0;
    elements.next.disabled = index === sutras.length - 1;
  }

  function renderAll() {
    renderSelectors();
    renderChapter();
    renderSutra();
  }

  function selectDefaults() {
    state.locale = state.data.defaultLocale;
    state.chapterId = state.data.content[state.locale][0].id;
    state.sutraId = state.data.content[state.locale][0].sutras[0].id;
  }

  async function loadData() {
    const response = await fetch("/api/editor-data", {cache: "no-store"});
    if (!response.ok) {
      throw new Error(`Unable to load content (${response.status}).`);
    }
    state.data = await response.json();
    selectDefaults();
    renderAll();
    setStatus("Content loaded. Select a sutra and start editing.");
  }

  function restoreSelectionControls() {
    elements.locale.value = state.locale;
    elements.chapter.value = state.chapterId;
    elements.sutra.value = state.sutraId;
  }

  function changeSelection(update) {
    if (!confirmDiscard()) {
      restoreSelectionControls();
      return;
    }
    update();
    setDirty("chapter", false);
    setDirty("sutra", false);
    renderAll();
  }

  function wordMeaningsFromForm() {
    return [...elements.wordList.querySelectorAll(".word-row")].map((row) => ({
      term: row.querySelector(".word-term").value,
      meaning: row.querySelector(".word-meaning").value
    }));
  }

  async function postJson(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Save failed (${response.status}).`);
    }
    return result;
  }

  function setSaving(saving) {
    state.saving = saving;
    elements.saveSutra.disabled = saving;
    elements.saveChapter.disabled = saving;
    elements.resetSutra.disabled = saving;
    elements.resetChapter.disabled = saving;
  }

  function applyReturnedData(data) {
    state.data = data;
    renderAll();
  }

  elements.locale.addEventListener("change", () => {
    const locale = elements.locale.value;
    changeSelection(() => {
      state.locale = locale;
      state.chapterId = state.data.content[locale][0].id;
      state.sutraId = state.data.content[locale][0].sutras[0].id;
    });
  });

  elements.chapter.addEventListener("change", () => {
    const chapterId = elements.chapter.value;
    changeSelection(() => {
      state.chapterId = chapterId;
      state.sutraId = currentChapter().sutras[0].id;
    });
  });

  elements.sutra.addEventListener("change", () => {
    const sutraId = elements.sutra.value;
    changeSelection(() => {
      state.sutraId = sutraId;
    });
  });

  function moveSutra(offset) {
    if (!confirmDiscard()) {
      return;
    }
    const sutras = currentChapter().sutras;
    const index = sutras.findIndex((sutra) => sutra.id === state.sutraId);
    const target = sutras[index + offset];
    if (target) {
      state.sutraId = target.id;
      renderSutra();
      renderSelectors();
    }
  }

  elements.previous.addEventListener("click", () => moveSutra(-1));
  elements.next.addEventListener("click", () => moveSutra(1));

  elements.addWord.addEventListener("click", () => {
    const row = addWordRow();
    setDirty("sutra", true);
    row.querySelector(".word-term").focus();
  });

  elements.sutraForm.addEventListener("input", () => setDirty("sutra", true));
  elements.chapterForm.addEventListener("input", () => setDirty("chapter", true));

  elements.resetSutra.addEventListener("click", () => {
    if (!state.sutraDirty || window.confirm("Reset the sutra fields?")) {
      renderSutra();
      setStatus("Sutra changes reset.");
    }
  });

  elements.resetChapter.addEventListener("click", () => {
    if (!state.chapterDirty || window.confirm("Reset the chapter fields?")) {
      renderChapter();
      setStatus("Chapter changes reset.");
    }
  });

  elements.sutraForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.chapterDirty) {
      setStatus("Save or reset the chapter changes first.", "error");
      return;
    }
    if (!elements.sutraForm.reportValidity()) {
      return;
    }
    setSaving(true);
    setStatus("Validating and saving the sutra...");
    try {
      const result = await postJson("/api/sutra", {
        locale: state.locale,
        sutraId: state.sutraId,
        sanskrit: elements.sanskrit.value,
        pronunciation: elements.pronunciation.value,
        hintPronunciations: elements.hintPronunciations.value
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        wordMeanings: wordMeaningsFromForm(),
        meaning: elements.meaning.value,
        explanation: elements.explanation.value
      });
      applyReturnedData(result.data);
      setStatus(result.message, "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setSaving(false);
    }
  });

  elements.chapterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.sutraDirty) {
      setStatus("Save or reset the sutra changes first.", "error");
      return;
    }
    if (!elements.chapterForm.reportValidity()) {
      return;
    }
    setSaving(true);
    setStatus("Validating and saving the chapter...");
    try {
      const result = await postJson("/api/chapter", {
        locale: state.locale,
        chapterId: state.chapterId,
        title: elements.chapterTitle.value,
        subtitle: elements.chapterSubtitle.value,
        description: elements.chapterDescription.value
      });
      applyReturnedData(result.data);
      setStatus(result.message, "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setSaving(false);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  loadData().catch((error) => {
    setStatus(error.message, "error");
    elements.sutraForm.hidden = true;
    elements.chapterForm.hidden = true;
  });
})();
