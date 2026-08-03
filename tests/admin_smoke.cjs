const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");


const root = path.resolve(__dirname, "..");


function waitFor(window, predicate, description, timeout = 3000) {
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


function fixture() {
  return {
    defaultLocale: "it",
    sourceLocale: "it",
    locales: ["it"],
    content: {
      it: [
        {
          id: "chapter_1",
          number: 1,
          title: "Samadhi Pada",
          subtitle: "Subtitle",
          description: "Chapter description",
          sutras: [
            {
              id: "sutra_1_01",
              number: "1.1",
              order: 1,
              sanskrit: "atha yogānuśāsanam",
              pronunciation: "a-tha yo-gā-nu-śā-sa-nam",
              hintPronunciations: ["a-tha", "yo-gā-nu-śā-sa-nam"],
              wordMeanings: [
                {term: "atha", meaning: "ora"},
                {term: "yoga", meaning: "yoga"}
              ],
              meaning: "Essential meaning",
              explanation: "Explanation"
            }
          ]
        }
      ]
    }
  };
}


async function main() {
  const html = fs
    .readFileSync(path.join(root, "admin/index.html"), "utf-8")
    .replace('<script src="/admin/admin.js"></script>', "");
  const application = fs.readFileSync(path.join(root, "admin/admin.js"), "utf-8");
  const data = fixture();
  let savedPayload = null;

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://127.0.0.1:8765/admin/",
    beforeParse(window) {
      window.confirm = () => true;
      window.fetch = async (url, options = {}) => {
        if (url === "/api/editor-data") {
          return {ok: true, json: async () => structuredClone(data)};
        }
        if (url === "/api/sutra" && options.method === "POST") {
          savedPayload = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({message: "Sutra saved.", data: structuredClone(data)})
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      };
    }
  });

  try {
    dom.window.eval(application);
    const {document} = dom.window;
    await waitFor(
      dom.window,
      () => document.querySelector("#sutra-select").options.length === 1,
      "the editor content"
    );

    if (document.querySelector("#sanskrit").value !== "atha yogānuśāsanam") {
      throw new Error("The Sanskrit field was not populated.");
    }
    if (document.querySelectorAll(".word-row").length !== 2) {
      throw new Error("The word meanings were not populated.");
    }
    if (document.querySelector("#hint-pronunciations").value.split("\n").length !== 2) {
      throw new Error("The progressive pronunciation hints were not populated.");
    }

    document.querySelector("#add-word").click();
    if (document.querySelectorAll(".word-row").length !== 3) {
      throw new Error("The add-word control failed.");
    }
    const newRow = document.querySelector(".word-row:last-child");
    newRow.querySelector(".word-term").value = "anuśāsanam";
    newRow.querySelector(".word-meaning").value = "insegnamento";
    newRow.querySelector(".word-term").dispatchEvent(
      new dom.window.Event("input", {bubbles: true})
    );
    if (!document.querySelector("#change-state").classList.contains("is-dirty")) {
      throw new Error("The unsaved-change indicator did not update.");
    }

    document.querySelector("#meaning").value = "Updated meaning";
    document.querySelector("#sutra-form").dispatchEvent(
      new dom.window.Event("submit", {bubbles: true, cancelable: true})
    );
    await waitFor(dom.window, () => savedPayload !== null, "the sutra save request");
    if (savedPayload.meaning !== "Updated meaning") {
      throw new Error("The edited meaning was not submitted.");
    }
    if (savedPayload.wordMeanings.length !== 3) {
      throw new Error("The edited word meanings were not submitted.");
    }
    if (savedPayload.hintPronunciations.length !== 2) {
      throw new Error("The progressive pronunciation hints were not submitted.");
    }

    console.log("Admin interface smoke test passed.");
  } finally {
    dom.window.close();
  }
}


main().catch((error) => {
  console.error(error);
  process.exit(1);
});
