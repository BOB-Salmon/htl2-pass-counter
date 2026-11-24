/* HACK THE LPIC 2 — PASS COUNTER 設定
   変更したらブラウザを再読み込みしてください。 */
window.HTL_CONFIG = {
  csvUrl: "https://docs.google.com/spreadsheets/d/1rYi9zHxIbrdFVLJvGFccNvTswAm05QeSq5rcJ9dU9CM/export?format=csv&gid=144482082",                 // 公開CSVのURL。空なら data/sample.csv を読み「SAMPLE DATA」表示
  pollSeconds: 20,
  phase: "auto",              // "auto" | "201" | "202"
  phaseSwitchDate: "2026-12-07",
  exams: [
    { id: "201", start: "2026-12-05T09:00:00+09:00", label: "12月5日（土）・6日（日）" },
    { id: "202", start: "2026-12-26T09:00:00+09:00", label: "12月26日（土）・27日（日）" }
  ],
  milestones: [10, 25, 50, 100],
  progressEvery: 180,         // 定着確認課題の提出状況を挟む間隔（秒）。0 で出さない
  progressHold: 12,           // 提出状況を見せる長さ（秒）
  tickerMax: 12
};
