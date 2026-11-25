/**
 * Excel実務トレーニング：進捗受け取り用 Google Apps Script
 * スプレッドシートの「拡張機能 → Apps Script」に貼り付けて、ウェブアプリとしてデプロイします。
 * 受講者×ミッションごとに1行を作り、更新があれば同じ行を上書きします。
 */
const SHEET_NAME = '進捗';
const HEADERS = ['更新日時', '受講者', 'ミッション', 'タイトル', '状態', 'いまのステップ',
                 '判定回数', 'ヒント数', 'つまずき（判定の誤り内容×回数）', '所要分', '手順メモ', '報告文'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    const name = clean_(d.name, 50);
    const mission = clean_(d.mission, 10);
    if (!name || !/^M\d{2}$/.test(mission)) return text_('ignored');

    const row = [new Date(), name, mission, clean_(d.title, 100), clean_(d.status, 20), clean_(d.step, 20),
                 Number(d.attempts) || 0, Number(d.hints) || 0, clean_(d.diag, 500),
                 d.minutes === '' ? '' : Number(d.minutes) || '', clean_(d.plan, 3000), clean_(d.report, 3000)];

    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] === name && values[i][2] === mission) {
        sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
        return text_('updated');
      }
    }
    sheet.appendRow(row);
    return text_('added');
  } catch (err) {
    return text_('error');
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 長さを制限し、=,+,-,@ で始まる文字は数式として実行されないよう ' を付ける
function clean_(v, max) {
  let s = String(v == null ? '' : v).slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function text_(s) {
  return ContentService.createTextOutput(s);
}
