import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {parseDistrictMeetingHtml} from "../lib/district-meetings.mjs";
import {run} from "../scripts/fetch-sources-district-meetings.mjs";

test("HTML-fallback leest de actuele openbare jaartabel",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"district-meetings-html-"));
  const emptyPage={currentVersion:"v2",updatedAt:"2026-09-30T10:00:00Z",snippets:[{type:"wysiwyg",body:{text:"<p>structuur gewijzigd</p>"}}]};
  const html='<h3>Data districtsraden en raadscommissies 2026</h3><table><tr><th>Data algemene raadscommissie</th><th>Data districtsraad</th><th>Data bijzondere raadscommissies</th></tr><tr><td>maandag 12 oktober</td><td>maandag 19 oktober</td><td>dinsdag 13 oktober en woensdag 14 oktober</td></tr><tr><td>maandag 9 november</td><td>maandag 16 november</td><td>woensdag 18 november</td></tr><tr><td>maandag 7 december</td><td>maandag 14 december</td><td>dinsdag 8 december en woensdag 9 december</td></tr></table>';
  let calls=0;
  const fetchImpl=async()=>{calls++;if(calls===1)return{ok:true,status:200,json:async()=>emptyPage};return{ok:true,status:200,text:async()=>html};};
  assert.equal(parseDistrictMeetingHtml(html).items.length,11);
  const status=await run({rootDir:root,clock:()=>new Date("2026-09-30T08:00:00Z"),fetch:fetchImpl,log:()=>{}});
  assert.deepEqual([status[0].fetchStatus,status[0].itemCount],["ok",11]);
});
