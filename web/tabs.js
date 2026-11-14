/* Tabs + the always-visible "right now" status box.
 * The site and date in the sidebar are shared by every tab.
 * Code written with AI assistance (Claude).
 */
"use strict";
window.curTab = "plan";
const TABS = ["plan", "nearby", "walk", "earth", "story", "learn"];

function showTab(name) {
  if (!TABS.includes(name)) name = "plan";
  window.curTab = name;
  for (const t of TABS) $("tab-" + t).hidden = t !== name;
  document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name !== "walk" && A.fp) setFP(false); // leave first person when walking away from the 3D tab
  S.mode = name === "learn" ? "learn" : "planner";
  try { localStorage.setItem("tab", name); } catch (e) { /* ignore */ }
  if (S.site && EPH) { render(); drawCmp(); size3D(); } // canvases inside a hidden tab have no size: redraw now
}
window.showTab = showTab;

/* compact status that stays visible on every tab */
function drawMini(cur) {
  if (!cur) return;
  const c = siteCalc(S.site), i = Math.floor(T()), sv = c.sVis[i], ev = c.eVis[i];
  const [v, cls] = sv && ev ? ["GO: power + comms", "ok"] : sv ? ["NO COMMS: needs a relay", "no"] : ev ? ["NO POWER: Sun hidden", "no"] : ["NO POWER, NO COMMS", "no"];
  $("mini").innerHTML = `<div class="note" style="margin:0">At this site and time:</div><div class="verdict ${cls}">${v}</div>
    <div><span class="${sv ? "sunc" : "no"}">☀ Sun ${cur.sEl.toFixed(1)}° · ${sv ? "visible for " + fmtDur(runLen(c.sVis, i)) : "hidden"}</span></div>
    <div><span class="${ev ? "earthc" : "no"}">🌍 Earth ${cur.eEl.toFixed(1)}° · ${ev ? "visible for " + fmtDur(runLen(c.eVis, i)) : "hidden"}</span></div>`;
  const polar = S.site.lat <= -80 && !S.site.id.startsWith("custom");
  document.querySelectorAll(".polarNone").forEach((p) => (p.style.display = polar ? "none" : ""));
}

(function () {
  document.querySelectorAll("#tabs .tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $("startHunt").onclick = () => {
    if (ST.hunt) { setHunt(false); return; }
    if (!(S.site.lat <= -80) || S.site.id.startsWith("custom")) {
      $("huntNote").textContent = "Choose a south-polar site first (for example Artemis III: Peak Near Shakleton).";
      return;
    }
    setHunt(true);
    showTab("walk");
    if (!A.fp) setFP(true);
    $("threeBox").scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const prevRender = window.onRender;
  window.onRender = (cur) => { prevRender(cur); drawMini(cur); };
  // start tab: #tab=walk in the URL, else #learn, else the last tab this browser used
  const h = location.hash;
  let start = (h.match(/tab=(\w+)/) || [])[1] || (/[#&]learn\b/.test(h) ? "learn" : /[#&]fp\b/.test(h) ? "walk" : null);
  if (!start) { try { start = localStorage.getItem("tab"); } catch (e) { start = null; } }
  showTab(start || "plan");
})();
