const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {JSDOM, VirtualConsole} = require("jsdom");


const root = path.resolve(__dirname, "..");


function waitFor(window, predicate, description, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started >= timeout) {
        reject(new Error(`Timed out while waiting for ${description}.`));
      } else {
        window.setTimeout(check, 10);
      }
    }
    check();
  });
}


function installBrowserStubs(window) {
  window.Math.random = () => 0;
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.__testTimeoutDelays = [];
  window.setTimeout = (callback, delay, ...arguments_) => {
    window.__testTimeoutDelays.push(delay);
    return nativeSetTimeout(callback, delay, ...arguments_);
  };

  class MockAudio extends window.EventTarget {
    constructor() {
      super();
      this.paused = true;
      this.ended = false;
      this.preload = "";
      this.src = "";
      this.duration = 0.01;
      this.currentTime = 0;
      this.muted = false;
      this.playCount = 0;
      window.__testAudio = this;
    }

    async play() {
      this.playCount += 1;
      this.paused = false;
      this.ended = false;
      this.dispatchEvent(new window.Event("play"));
    }

    pause() {
      if (!this.paused) {
        this.paused = true;
        this.dispatchEvent(new window.Event("pause"));
      }
    }

    load() {}

    removeAttribute(name) {
      if (name === "src") {
        this.src = "";
      }
    }
  }

  window.Audio = MockAudio;
  window.scrollTo = () => {};
}


async function verifyPage(filePath) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", (message) => errors.push(String(message)));
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));

  const dom = new JSDOM(fs.readFileSync(filePath, "utf-8"), {
    beforeParse: installBrowserStubs,
    resources: "usable",
    runScripts: "dangerously",
    url: pathToFileURL(filePath).href,
    virtualConsole
  });

  try {
    const {document} = dom.window;
    await waitFor(
      dom.window,
      () => document.querySelectorAll(".chapter-card").length === 2,
      "the home page"
    );

    if (document.querySelector(".home-cover .subtitle")) {
      throw new Error("The removed home subtitle is still visible.");
    }
    const coverLinks = document.querySelectorAll(".cover-credit a");
    if (coverLinks.length !== 3) {
      throw new Error("The author and voice links are missing.");
    }
    if (coverLinks[0].href !== "https://www.instagram.com/marco.buttu/") {
      throw new Error("The first author link is incorrect.");
    }
    if (coverLinks[1].href !== "https://www.instagram.com/a.riamm/") {
      throw new Error("The second author link is incorrect.");
    }
    if (coverLinks[2].href !== "https://www.ashtangasaadhana.com/") {
      throw new Error("The voice link is incorrect.");
    }
    const authorCredit = document.querySelector(".cover-credit-authors");
    const authorLinks = authorCredit?.querySelectorAll(".cover-author-list a");
    if (!authorCredit || authorLinks.length !== 2) {
      throw new Error("The author credit is missing.");
    }
    if (
      authorLinks[0].textContent.trim() !== "Marco Buttu" ||
      authorLinks[1].textContent.trim() !== "Arianna Macciantelli"
    ) {
      throw new Error("The full author names are incorrect.");
    }
    if (!authorCredit.textContent.trim().startsWith("Autori:")) {
      throw new Error("The plural author label is missing.");
    }
    const authorText = authorCredit.textContent.replace(/\s+/g, " ").trim();
    if (authorText !== "Autori: Marco Buttu e Arianna Macciantelli") {
      throw new Error("The authors are not displayed on the requested line.");
    }
    const importantNote = document.querySelector(".cover-note");
    if (!importantNote || !importantNote.textContent.includes("solo ed esclusivamente mia")) {
      throw new Error("The important note is missing.");
    }
    if (importantNote.tagName !== "DETAILS" || importantNote.open) {
      throw new Error("The important note must be collapsible and closed by default.");
    }
    const importantNoteSummary = importantNote.querySelector("summary");
    if (!importantNoteSummary || importantNoteSummary.textContent.trim() !== "Nota importante") {
      throw new Error("The important note summary is missing or incorrect.");
    }
    importantNoteSummary.click();
    if (!importantNote.open) {
      throw new Error("The important note does not expand.");
    }

    const verificationPanel = document.querySelector(".verification-panel");
    if (!verificationPanel) {
      throw new Error("The verification panel is missing.");
    }
    if (verificationPanel.querySelector("#verification-title").textContent.trim() !== "Verifica") {
      throw new Error("The verification title is incorrect.");
    }
    if (verificationPanel.querySelector(".panel-description")) {
      throw new Error("The verification panel must not contain a subtitle.");
    }
    const verificationChapterField = verificationPanel.querySelector(
      ".verification-chapter-field"
    );
    const verificationStartField = verificationPanel.querySelector(
      ".verification-start-field"
    );
    const verificationMode = verificationPanel.querySelector("#verification-mode");
    if (!verificationChapterField.hidden || !verificationStartField.hidden) {
      throw new Error("The verification controls have incorrect defaults.");
    }
    verificationMode.value = "range";
    verificationMode.dispatchEvent(new dom.window.Event("change"));
    if (verificationChapterField.hidden || verificationStartField.hidden) {
      throw new Error("The verification interval controls were not revealed.");
    }
    verificationMode.value = "all";
    verificationMode.dispatchEvent(new dom.window.Event("change"));
    verificationPanel.querySelector("#verification-next").click();
    const verificationCard = verificationPanel.querySelector("#verification-card");
    if (verificationCard.hidden) {
      throw new Error("The random verification question was not shown.");
    }
    if (!verificationCard.querySelector(".verification-number").textContent.includes("1.1")) {
      throw new Error("The random verification question has the wrong sutra number.");
    }
    verificationPanel.querySelector("#verification-hint").click();
    if (verificationCard.querySelector(".verification-hint-sanskrit").textContent !== "atha") {
      throw new Error("The first progressive Sanskrit hint is incorrect.");
    }
    if (verificationCard.querySelector(".verification-hint-pronunciation").textContent !== "a-tha") {
      throw new Error("The first progressive pronunciation hint is incorrect.");
    }
    verificationPanel.querySelector("#verification-hint").click();
    if (
      verificationCard.querySelector(".verification-hint-sanskrit").textContent !==
      "atha yogānuśāsanam"
    ) {
      throw new Error("The progressive hint did not reveal the next word.");
    }
    if (!verificationPanel.querySelector("#verification-hint").disabled) {
      throw new Error("The hint control remains enabled after revealing every word.");
    }
    verificationPanel.querySelector("#verification-solution").click();
    const verificationSolution = verificationCard.querySelector(".verification-solution");
    if (verificationSolution.hidden) {
      throw new Error("The verification solution was not shown.");
    }
    if (!verificationSolution.querySelector(".verification-solution-meaning").textContent.includes("Ora comincia")) {
      throw new Error("The verification solution meaning is missing.");
    }
    if (!verificationSolution.querySelector(".audio-button")) {
      throw new Error("The verification solution audio control is missing.");
    }
    verificationMode.value = "range";
    verificationMode.dispatchEvent(new dom.window.Event("change"));
    verificationPanel.querySelector("#verification-start").value = "1";
    verificationPanel.querySelector("#verification-start").dispatchEvent(
      new dom.window.Event("change")
    );
    verificationPanel.querySelector("#verification-end").value = "1";
    verificationPanel.querySelector("#verification-end").dispatchEvent(
      new dom.window.Event("change")
    );
    verificationPanel.querySelector("#verification-next").click();
    verificationPanel.querySelector("#verification-hint").click();
    verificationPanel.querySelector("#verification-hint").click();
    if (
      verificationCard.querySelector(".verification-hint-pronunciation").textContent !==
      "yo-gaś chit-ta vrit-ti ni-ro-dhah"
    ) {
      throw new Error("A compound progressive pronunciation hint is incorrect.");
    }

    const bellInput = document.querySelector("#sequence-bell");
    const pauseModeSelect = document.querySelector("#sequence-pause-mode");
    const repeatCurrentButton = document.querySelector("#sequence-repeat-current");
    const currentTrack = document.querySelector("#sequence-current");
    if (
      !bellInput.checked ||
      pauseModeSelect.value !== "none" ||
      !repeatCurrentButton.disabled ||
      !currentTrack.hidden
    ) {
      throw new Error("The continuous recitation defaults are incorrect.");
    }

    const modeSelect = document.querySelector("#sequence-mode");
    modeSelect.value = "range";
    modeSelect.dispatchEvent(new dom.window.Event("change"));
    document.querySelector("#sequence-start").value = "0";
    document.querySelector("#sequence-end").value = "0";
    document.querySelector("#sequence-play").click();
    await waitFor(dom.window, () => !currentTrack.hidden, "the first sequence track");
    if (!currentTrack.querySelector(".sequence-current-sanskrit").textContent.trim()) {
      throw new Error("The current Sanskrit text is missing.");
    }
    if (!currentTrack.querySelector(".sequence-current-pronunciation").textContent.trim()) {
      throw new Error("The current pronunciation is missing.");
    }
    if (repeatCurrentButton.disabled) {
      throw new Error("The repeat-current control is disabled during playback.");
    }
    const playCountBeforeRepeat = dom.window.__testAudio.playCount;
    repeatCurrentButton.click();
    await waitFor(
      dom.window,
      () => dom.window.__testAudio.playCount > playCountBeforeRepeat,
      "the repeated current sutra"
    );

    dom.window.__testAudio.ended = true;
    dom.window.__testAudio.dispatchEvent(new dom.window.Event("ended"));
    const expectedBellSource =
      dom.window.SUTRA_BY_HEART_EMBEDDED_AUDIO?.["audio/restarting.mp3"] ||
      "audio/restarting.mp3";
    await waitFor(
      dom.window,
      () => dom.window.__testAudio.src === expectedBellSource,
      "the bell cue"
    );
    if (!currentTrack.hidden) {
      throw new Error("The sutra text must be hidden while the bell is playing.");
    }

    dom.window.__testAudio.ended = true;
    dom.window.__testAudio.dispatchEvent(new dom.window.Event("ended"));
    await waitFor(dom.window, () => !currentTrack.hidden, "the repeated sequence track");
    document.querySelector("#sequence-stop").click();

    bellInput.checked = false;
    pauseModeSelect.value = "after";
    document.querySelector("#sequence-play").click();
    await waitFor(dom.window, () => !currentTrack.hidden, "the after-pause track");
    dom.window.__testAudio.ended = true;
    dom.window.__testAudio.dispatchEvent(new dom.window.Event("ended"));
    await waitFor(
      dom.window,
      () => document.querySelector("#sequence-status").textContent.includes("Pausa dopo"),
      "the pause after the sutra"
    );
    if (!dom.window.__testTimeoutDelays.some((delay) => Math.abs(delay - 11) < 0.001)) {
      throw new Error("The pause after the sutra is not 110% of its duration.");
    }
    if (currentTrack.hidden) {
      throw new Error("The sutra text must remain visible during the pause after it.");
    }
    if (repeatCurrentButton.disabled) {
      throw new Error("The current sutra cannot be repeated during the pause after it.");
    }
    document.querySelector("#sequence-stop").click();

    bellInput.checked = true;
    pauseModeSelect.value = "before";
    document.querySelector("#sequence-play").click();
    await waitFor(
      dom.window,
      () => dom.window.__testAudio.src === expectedBellSource,
      "the initial bell before the first pause"
    );
    if (!currentTrack.hidden || !repeatCurrentButton.disabled) {
      throw new Error("The text and repeat control must be hidden during the initial bell.");
    }
    dom.window.__testAudio.ended = true;
    dom.window.__testAudio.dispatchEvent(new dom.window.Event("ended"));
    await waitFor(
      dom.window,
      () => document.querySelector("#sequence-status").textContent.includes("Pausa prima"),
      "the pause before the sutra"
    );
    if (!dom.window.__testTimeoutDelays.some((delay) => Math.abs(delay - 10) < 0.001)) {
      throw new Error("The pause before the sutra is not equal to its duration.");
    }
    if (!currentTrack.hidden || !repeatCurrentButton.disabled) {
      throw new Error("The sutra must remain hidden during the pause before it.");
    }
    await waitFor(dom.window, () => !currentTrack.hidden, "the track after its leading pause");
    if (repeatCurrentButton.disabled) {
      throw new Error("The current sutra cannot be repeated after the leading pause.");
    }
    document.querySelector("#sequence-stop").click();

    document.querySelector(".chapter-card").click();
    await waitFor(
      dom.window,
      () => document.querySelectorAll("article.sutra").length === 51,
      "chapter 1"
    );

    const chapterOneExplanations = document.querySelectorAll(".sutra-explanation");
    if (chapterOneExplanations.length !== 51) {
      throw new Error(`Expected 51 chapter 1 explanations, found ${chapterOneExplanations.length}.`);
    }
    if (document.querySelectorAll(".sutra-explanation[open]").length !== 0) {
      throw new Error("Every explanation must be closed by default.");
    }
    const chapterDescription = document.querySelector(".chapter-introduction-text");
    if (!chapterDescription || chapterDescription.textContent.trim().length < 40) {
      throw new Error("The chapter description is missing or too short.");
    }

    const firstExplanation = chapterOneExplanations[0];
    firstExplanation.querySelector("summary").click();
    if (!firstExplanation.open) {
      throw new Error("The explanation control did not expand.");
    }
    if (firstExplanation.querySelector("p").textContent.trim().length < 80) {
      throw new Error("The first explanation is missing or too short.");
    }

    dom.window.location.hash = "chapter=2";
    await waitFor(
      dom.window,
      () => document.querySelectorAll("article.sutra").length === 55,
      "chapter 2"
    );
    if (document.querySelectorAll(".sutra-explanation").length !== 55) {
      throw new Error("Chapter 2 does not contain 55 explanations.");
    }

    if (errors.length) {
      throw new Error(`DOM errors: ${JSON.stringify(errors)}`);
    }
  } finally {
    dom.window.close();
  }
}


async function main() {
  await verifyPage(path.join(root, "index.html"));
  const embeddedPath = path.join(root, "dist/sutra_by_heart_embedded.html");
  if (fs.existsSync(embeddedPath)) {
    await verifyPage(embeddedPath);
    console.log("DOM smoke tests passed for separate and embedded builds.");
  } else {
    console.log("DOM smoke tests passed for the separate build.");
  }
}


main().catch((error) => {
  console.error(error);
  process.exit(1);
});
