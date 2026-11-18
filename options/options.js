(async function () {
  const { $, setStatus, saveText } = PG.ui;

  const settings = await PG.settings.get();
  $("#max-posts").value = settings.maxPostsPerRun;
  $("#delay-min").value = settings.grabDelayMinSec;
  $("#delay-max").value = settings.grabDelayMaxSec;
  $("#transcript-enabled").checked = settings.transcriptEnabled;
  $("#api-key").value = settings.openaiApiKey;

  $("#save-limits").addEventListener("click", async () => {
    const saved = await PG.settings.save({
      maxPostsPerRun: $("#max-posts").value,
      grabDelayMinSec: $("#delay-min").value,
      grabDelayMaxSec: $("#delay-max").value
    });
    $("#max-posts").value = saved.maxPostsPerRun;
    $("#delay-min").value = saved.grabDelayMinSec;
    $("#delay-max").value = saved.grabDelayMaxSec;
    setStatus($("#limits-status"), "Saved.", "ok");
  });

  $("#save-transcript").addEventListener("click", async () => {
    const key = $("#api-key").value.trim();
    const enabled = $("#transcript-enabled").checked;
    await PG.settings.save({ transcriptEnabled: enabled, openaiApiKey: key });
    if (enabled && !key) setStatus($("#transcript-status"), "Saved, but Get transcript stays disabled until you add a key.", "warn");
    else setStatus($("#transcript-status"), "Saved.", "ok");
  });

  $("#remove-key").addEventListener("click", async () => {
    $("#api-key").value = "";
    await PG.settings.save({ openaiApiKey: "" });
    setStatus($("#transcript-status"), "Key removed.", "ok");
  });

  async function renderSwipe() {
    const entries = await PG.swipe.all();
    $("#swipe-count").textContent = `(${entries.length})`;
    $("#swipe-empty").hidden = entries.length > 0;
    $("#swipe-table").hidden = entries.length === 0;
    $("#swipe-export").disabled = entries.length === 0;
    $("#swipe-rows").replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement("tr");
        const link = document.createElement("a");
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = `@${entry.account || "unknown"}`;
        link.title = entry.caption || "";
        row.insertCell().append(link);
        for (const value of [entry.hookType, entry.format, entry.tags, entry.notes]) row.insertCell().textContent = value;
        const remove = document.createElement("button");
        remove.className = "link";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove @${entry.account || "unknown"} from swipe file`);
        remove.addEventListener("click", async () => {
          await PG.swipe.remove(entry.key);
          renderSwipe();
        });
        row.insertCell().append(remove);
        return row;
      })
    );
  }

  $("#swipe-export").addEventListener("click", async () => {
    const entries = await PG.swipe.all();
    const filename = `swipe_file_${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      await saveText(filename, PG.swipe.toCsv(entries), "text/csv");
      setStatus($("#swipe-status"), `Saved Downloads/${filename}.`, "ok");
    } catch (e) {
      setStatus($("#swipe-status"), e.message, "error");
    }
  });

  renderSwipe();
})();
