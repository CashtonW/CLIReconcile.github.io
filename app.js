/* CLI Reconcile runs entirely in the browser; no payroll data leaves the device. */
const $ = s => document.querySelector(s);
let scheduleFile, timeFiles = [], lookupFile, exceptions = [], activeFilter = 'all';

function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && n === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  } if (cell || row.length) { row.push(cell.trim()); rows.push(row); } return rows;
}
const isDash = v => /^\s*[-\u2010-\u2015\u2212]+\s*$/.test(String(v ?? '')); // '-', en dash, em dash and similar placeholders
const norm = v => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hrs = v => { if (isDash(v)) return 0; const x = parseFloat(String(v).replace(/[^0-9.]/g,'')); return Number.isFinite(x) ? x : 0; };
function dateISO(s) { const t = String(s || '').trim(); let m = t.match(/(\d{4})-(\d\d)-(\d\d)/); if (m) return m[0]; m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; m = t.match(/(\d{1,2})\/(\d{1,2})/); return m ? `2026-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : ''; }
function timeMin(s) { if (isDash(s)) return null; const m = String(s || '').toLowerCase().match(/(\d{1,2}):(\d\d)\s*([ap])/); if (!m) return null; let h=+m[1]; if(m[3]==='p'&&h!==12)h+=12;if(m[3]==='a'&&h===12)h=0;return h*60+(+m[2]); }
function fmtHours(n) { return n ? `${Number(n.toFixed(2))}h` : '—'; }
function displayDate(d) { return d ? new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Unknown'; }
function findIdx(headers, terms) { return headers.findIndex(h => terms.some(t => norm(h) === norm(t))); }
function parseLookup(text) {
  const rows = parseCSV(text), h = rows[0] || [];
  const code = findIdx(h,['PRS Code']), name = findIdx(h,['Name (First Last)']), workEmail = findIdx(h,['Work Email']), personalEmail = findIdx(h,['Personal Email']);
  if (code < 0 || name < 0) throw new Error('Could not find PRS Code and Name columns in the employee lookup.');
  const byCode = new Map(), byEmail = new Map();
  rows.slice(1).forEach(r => { const person={name:(r[name]||'').trim(),key:norm(r[name]),workEmail:(r[workEmail]||'').trim().toLowerCase(),personalEmail:(r[personalEmail]||'').trim().toLowerCase()}; if(r[code])byCode.set(norm(r[code]),person); [person.workEmail,person.personalEmail].filter(Boolean).forEach(email=>byEmail.set(email,person)); });
  return {byCode,byEmail};
}

function parseSchedule(text) {
  const rows = parseCSV(text), headerAt = rows.findIndex(r => norm(r[0]) === 'schedule'); if (headerAt < 0) throw new Error('Could not find the Schedule header in the schedule export.');
  const h = rows[headerAt], idx = {first:findIdx(h,['First Name']),last:findIdx(h,['Last Name']),date:findIdx(h,['Shift Start Date']),start:findIdx(h,['Shift Start Time']),end:findIdx(h,['Shift End Time']),hours:findIdx(h,['Scheduled Hours']),position:findIdx(h,['Position']),status:findIdx(h,['Status'])};
  return rows.slice(headerAt+1).map(r => ({employee:`${r[idx.first]||''} ${r[idx.last]||''}`.trim(), key:norm(`${r[idx.first]||''}${r[idx.last]||''}`), email:(r[findIdx(h,['Email'])]||'').trim().toLowerCase(), date:dateISO(r[idx.date]), start:timeMin(r[idx.start]), end:timeMin(r[idx.end]), hours:hrs(r[idx.hours]), service:r[idx.position]||'', status:r[idx.status]||''})).filter(x => x.employee && x.date && x.status.toLowerCase()==='published' && norm(x.service)!=='off');
}
function parseTimesheet(text, filename, lookup) {
  const rows = parseCSV(text); const intro = rows.find(r => /employee:/i.test(r.join(' '))).join(' ');
  const em = intro.match(/employee:\s*([^|,]+)/i), codeMatch = intro.match(/code:\s*([^|,\s]+)/i); const lookupPerson = lookup?.byCode.get(norm(codeMatch?.[1])); const employee = lookupPerson?.name || (em ? em[1].trim() : filename.replace(/timesheet.*$/i,'').trim());
  const periodMatch = intro.match(/period:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const period = periodMatch ? { start: dateISO(periodMatch[1]), end: dateISO(periodMatch[2]) } : null;
  let header = [], ix = {}, currentDate = '', output = [], blankDays = new Set();
  for (const r of rows) {
    if (r.some(c => norm(c)==='status') && r.some(c => norm(c)==='in') && r.some(c => norm(c)==='out')) { header=r; ix={date:findIdx(header,['Date']),in:findIdx(header,['In']),out:findIdx(header,['Out']),hours:findIdx(header,['Hours']),cat:findIdx(header,['Category']),location:findIdx(header,['Location'])}; continue; }
    if (!header.length) continue;
    
    // Improved robust date extraction: check primary date column, then any trailing date columns in the row
    const primary = r[ix.date];
    const primaryParsed = dateISO(primary);
    if (primaryParsed) {
      currentDate = primaryParsed;
    } else {
      const lastDate = r.filter(c => /^\d{4}-\d\d-\d\d$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c)).pop();
      if (lastDate) {
        const iso = dateISO(lastDate);
        if (iso) currentDate = iso;
      }
    }

    if (/^(total|note)/i.test((primary||'').trim())) continue; // summary/note lines are not time entries
    const start=timeMin(r[ix.in]), end=timeMin(r[ix.out]), category=(r[ix.cat]||'').toLowerCase();
    if (currentDate && isDash(r[ix.in]) && isDash(r[ix.out]) && !norm(category)) blankDays.add(`${norm(employee)}|${currentDate}`);
    const isMiles = /miles/.test(norm(category)); // Client/Staff Miles (Enter Miles Only), any spacing/wording
    // A miles row with no clock times is only a mileage entry, not worked time. If it DOES carry clock times, those are real worked time,
    // and its Hours column holds miles (not hours), so hours are computed from the clock times instead.
    if (isMiles && (start === null || end === null)) continue;
    if (start !== null && end !== null && currentDate) output.push({employee,key:norm(employee),date:currentDate,start,end,hours:isMiles ? ((end-start+1440)%1440)/60 : (hrs(r[ix.hours]) || ((end-start+1440)%1440)/60),service:r[ix.location]||'',source:filename});
    else if (category && /sick|vacation|pto/.test(category) && hrs(r[ix.hours]) && currentDate) output.push({employee,key:norm(employee),date:currentDate,start:null,end:null,hours:hrs(r[ix.hours]),service:category,source:filename,leave:true});
  }
  const seen = new Set(); output = output.filter(o => { if (o.leave) return true; const k = `${o.key}|${o.date}|${o.start}|${o.end}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return Object.assign(output, { period, blankDays });
}
function push(type, priority, group, s, actual, detail) { exceptions.push({type,priority,group,employee:(s||actual).employee,date:(s||actual).date,scheduled:s?fmtHours(s.hours):'—',actual:actual?fmtHours(actual.hours):'—',service:(s||actual).service||'—',detail}); }
function reconcile(schedules, actuals, blankDays = new Set()) {
  // Day-level review: every row for an employee on a date is gathered first, and the day is judged as a whole.
  // Placeholder rows ("-"), mileage-only rows and note/total lines are ignored; if the remaining worked time
  // (plus any paid leave) lines up with the schedule for that day, nothing is flagged.
  exceptions=[]; const schedGroups = new Map(), actualGroups = new Map(), leaveHours = new Map();
  const key = x=>`${x.key}|${x.date}`;
  const add=(m,k,v)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(v)};
  schedules.forEach(x=>add(schedGroups,key(x),x));
  actuals.forEach(x=>{ if(x.leave) leaveHours.set(key(x),(leaveHours.get(key(x))||0)+x.hours); else add(actualGroups,key(x),x); });
  const span=(rows)=>{ // earliest start / latest end of the day, allowing shifts that run past midnight; rows with no clock times (dashes) are ignored
    rows=rows.filter(x=>x.start!==null&&x.end!==null&&!Number.isNaN(x.start)&&!Number.isNaN(x.end)); if(!rows.length) return null;
    const st=rows.map(x=>x.start), en=rows.map(x=>x.end<=x.start?x.end+1440:x.end);
    return [Math.min(...st),Math.max(...en)]; };
  const all = new Set([...schedGroups.keys(),...actualGroups.keys(),...leaveHours.keys()]);
  for(const k of all){ const ss=schedGroups.get(k)||[], aa=actualGroups.get(k)||[], lv=leaveHours.get(k)||0, s=ss[0], a=aa[0];
    const sh=ss.reduce((n,x)=>n+x.hours,0), wh=aa.reduce((n,x)=>n+x.hours,0), ah=wh+lv;
    if(!ss.length){ if(aa.length) push('Unscheduled worked time','high','missing',null,a,`Worked time appears with no published schedule. Source: ${a.source}.`); continue; } // leave-only days with no schedule are fine
    if(!aa.length){
      if(lv>0){ if(Math.abs(sh-lv)>.10) push('Hours mismatch',Math.abs(sh-lv)>=1?'high':'medium','hours',{...s,hours:sh},{...s,hours:lv,service:'Paid leave'},`Scheduled ${fmtHours(sh)}; only paid leave (${fmtHours(lv)}) is recorded for the day.`); continue; }
      if(!blankDays.has(k)) push('Missing time record','high','missing',s,null,`No worked time found for ${ss.length} scheduled shift${ss.length===1?'':'s'} (${ss.map(x=>x.service).join('; ')}).`);
      continue; }
    // The day is judged on its total across all rows, which also supports PRS exports that consolidate consecutive shifts.
    if(Math.abs(sh-ah)>.10) push('Hours mismatch',Math.abs(sh-ah)>=1?'high':'medium','hours',{...s,hours:sh},{...a,hours:ah},`Scheduled ${fmtHours(sh)} across ${ss.length} shift${ss.length===1?'':'s'}; time card totals ${fmtHours(ah)}${lv?` (including ${fmtHours(lv)} paid leave)`:''}.`);
    else if(!lv){ // hours agree for the day; only compare clock times when there is no paid leave mixed in
      const sp=span(ss), ap=span(aa); if(!sp||!ap) continue; // nothing comparable (e.g. dash placeholders): do not flag
      const [schedStart,schedEnd]=sp, [actStart,actEnd]=ap;
      if(Math.abs(schedStart-actStart)>15 || Math.abs(schedEnd-actEnd)>15) push('Clock-time mismatch','medium','time',{...s,hours:sh},{...a,hours:ah},`Schedule span ${mins(schedStart%1440)}–${mins(schedEnd%1440)}; time card span ${mins(actStart%1440)}–${mins(actEnd%1440)}.`);
    }
  }
  return exceptions.sort((a,b) => ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || a.date.localeCompare(b.date));
}
function mins(m){let h=Math.floor(m/60),z=m%60,ap=h>=12?'PM':'AM';h=h%12||12;return `${h}:${String(z).padStart(2,'0')} ${ap}`;}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){const q=$('#search').value.toLowerCase();const shown=exceptions.filter(x=>(activeFilter==='all'||x.group===activeFilter||x.priority===activeFilter)&&`${x.employee} ${x.date} ${x.service} ${x.type}`.toLowerCase().includes(q));$('#exception-body').innerHTML=shown.map(x=>`<tr><td><span class="badge ${x.priority}">${x.priority}</span></td><td><b>${esc(x.employee)}</b></td><td>${displayDate(x.date)}</td><td class="exception">${x.type}</td><td>${x.scheduled}</td><td>${x.actual}</td><td class="detail">${esc(x.detail)}</td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:#637283;padding:28px">No matching exceptions.</td></tr>';}
function showResults(){const counts={all:exceptions.length,high:exceptions.filter(x=>x.priority==='high').length,hours:exceptions.filter(x=>x.group==='hours').length,missing:exceptions.filter(x=>x.group==='missing').length};Object.entries(counts).forEach(([k,v])=>{const el=$('#'+k+'-count');if(el)el.textContent=v});$('#cards').innerHTML=[['Exceptions',counts.all,'alert'],['High priority',counts.high,'alert'],['Hours mismatch',counts.hours,''],['Missing time',counts.missing,'']].map(x=>`<article class="card ${x[2]}"><div class="num">${x[1]}</div><p>${x[0]}</p></article>`).join('');$('#summary').textContent=`${counts.all} item${counts.all===1?'':'s'} found across the uploaded payroll period.`;$('#empty').classList.add('hidden');$('#results').classList.remove('hidden');render();$('#results').scrollIntoView({behavior:'smooth',block:'start'});}
async function run(){try{const lookup=lookupFile?parseLookup(await lookupFile.text()):null;let schedule=parseSchedule(await scheduleFile.text());if(lookup)schedule.forEach(x=>{const person=lookup.byEmail.get(x.email);if(person){x.key=person.key;x.employee=person.name}});const reports=await Promise.all(timeFiles.map(async f=>parseTimesheet(await f.text(),f.name,lookup)));const periods=reports.map(x=>x.period).filter(Boolean),blankDays=new Set(reports.flatMap(x=>[...x.blankDays]));const times=reports.flat();if(!schedule.length)throw new Error('The schedule file has no published shifts to compare.');if(!times.length)throw new Error('No clocked time was found in the time card files.');if(periods.length){const start=periods.map(x=>x.start).sort()[0],end=periods.map(x=>x.end).sort().at(-1);schedule=schedule.filter(x=>x.date>=start&&x.date<=end)}reconcile(schedule,times,blankDays);showResults()}catch(e){alert(e.message)}}
function updateFiles(){const ready=scheduleFile&&timeFiles.length;$('#run').disabled=!ready;$('#file-status').textContent=ready?`${timeFiles.length} time card${timeFiles.length===1?'':'s'} ready to compare.`:'Add the two export types to begin.';}
$('#schedule-file').addEventListener('change',e=>{scheduleFile=e.target.files[0];if(scheduleFile){$('#schedule-name').textContent=scheduleFile.name;$('#schedule-zone').classList.add('loaded')}updateFiles()});
$('#timesheet-files').addEventListener('change',e=>{timeFiles=[...e.target.files];if(timeFiles.length){$('#timesheet-name').textContent=`${timeFiles.length} file${timeFiles.length===1?'':'s'} selected`;$('#time-zone').classList.add('loaded')}updateFiles()});
$('#lookup-file').addEventListener('change',e=>{lookupFile=e.target.files[0];if(lookupFile){$('#lookup-name').textContent=lookupFile.name;$('#lookup-zone').classList.add('loaded')}updateFiles()});
$('#run').addEventListener('click',run);$('#search').addEventListener('input',render);$('#filters').addEventListener('click',e=>{if(!e.target.matches('button'))return;activeFilter=e.target.dataset.filter;document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('active',x===e.target));render()});
$('#download').addEventListener('click',()=>{const h=['Priority','Employee','Work Date','Exception','Scheduled Hours','Actual Hours','Service','Details'];const data=exceptions.map(x=>[x.priority,x.employee,x.date,x.type,x.scheduled,x.actual,x.service,x.detail]);const csv=[h,...data].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='cli-reconciliation-exceptions.csv';a.click();URL.revokeObjectURL(a.href)});
$('#reset').addEventListener('click',()=>location.reload());
$('#demo').addEventListener('click',()=>alert('For privacy, sample files are not embedded. Use the attached CSV exports by selecting them above.'));