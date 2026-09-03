export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase().trim());
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

export function normalizeRows(raw) {
  const required = ['date','team','employee_id','scheduled_hours','productive_hours','absence_hours','demand_units'];
  if (!raw.length) return { rows: [], errors: ['No data rows found.'] };
  const errors = [];
  for (const k of required) if (!(k in raw[0])) errors.push(`Missing required column: ${k}`);
  if (errors.length) return { rows: [], errors };
  const rows = [];
  raw.forEach((r, i) => {
    const date = new Date(`${r.date}T00:00:00`);
    const nums = ['scheduled_hours','productive_hours','absence_hours','demand_units'].map(k => Number(r[k]));
    if (Number.isNaN(date.getTime()) || nums.some(v => !Number.isFinite(v))) {
      errors.push(`Row ${i + 2} has an invalid date or numeric value.`); return;
    }
    const [scheduled, productive, absence, demand] = nums;
    if (scheduled < 0 || productive < 0 || absence < 0 || demand < 0) { errors.push(`Row ${i + 2} contains a negative value.`); return; }
    rows.push({ date: r.date, team: r.team || 'Unassigned', role: r.role || 'General', employee_id: r.employee_id || `row-${i}`, scheduled_hours: scheduled, productive_hours: productive, absence_hours: absence, demand_units: demand });
  });
  return { rows, errors };
}

const sum = xs => xs.reduce((a,b)=>a+b,0);
const mean = xs => xs.length ? sum(xs)/xs.length : 0;
const sd = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs); return Math.sqrt(sum(xs.map(x => (x-m)**2))/(xs.length-1));
};
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s=[...xs].sort((a,b)=>a-b), pos=(s.length-1)*q, base=Math.floor(pos), rest=pos-base;
  return s[base+1]!==undefined ? s[base]+rest*(s[base+1]-s[base]) : s[base];
};
function rng(seed=42){ let s=seed>>>0; return ()=>((s=(1664525*s+1013904223)>>>0)/4294967296); }

export function summarize(rows) {
  const teamMap = new Map();
  for (const r of rows) {
    if (!teamMap.has(r.team)) teamMap.set(r.team, []);
    teamMap.get(r.team).push(r);
  }
  const teams = [...teamMap].map(([team, rs]) => {
    const scheduled=sum(rs.map(r=>r.scheduled_hours));
    const absence=sum(rs.map(r=>r.absence_hours));
    const capacity=Math.max(0, scheduled-absence);
    const productive=sum(rs.map(r=>r.productive_hours));
    const demand=sum(rs.map(r=>r.demand_units));
    const productivity=productive>0 ? demand/productive : 0;
    const byEmployee = new Map();
    rs.forEach(r=>byEmployee.set(r.employee_id,(byEmployee.get(r.employee_id)||0)+r.productive_hours));
    const loads=[...byEmployee.values()];
    const loadCv=mean(loads)>0 ? sd(loads)/mean(loads) : 0;
    const sorted=[...loads].sort((a,b)=>b-a);
    const topN=Math.max(1,Math.ceil(sorted.length*.2));
    const concentration=sum(sorted.slice(0,topN))/(sum(sorted)||1);
    return {team, headcount:byEmployee.size, scheduled, absence, capacity, productive, demand, productivity, utilization:capacity>0?productive/capacity:0, loadCv, concentration};
  });
  return { teams, totalScheduled:sum(teams.map(t=>t.scheduled)), totalAbsence:sum(teams.map(t=>t.absence)), totalDemand:sum(teams.map(t=>t.demand)), avgUtilization: mean(teams.map(t=>t.utilization)) };
}

export function forecastCoverage(rows, { horizon=14, targetUtilization=.85, serviceQuantile=.9, seed=42 }={}) {
  if (!rows.length) return [];
  const maxDate = new Date(Math.max(...rows.map(r=>new Date(`${r.date}T00:00:00`).getTime())));
  const teams=[...new Set(rows.map(r=>r.team))];
  const rand=rng(seed);
  const out=[];
  for (const team of teams) {
    const trs=rows.filter(r=>r.team===team);
    const dates=[...new Set(trs.map(r=>r.date))].sort();
    const daily=dates.map(d=>{
      const dr=trs.filter(r=>r.date===d);
      return {date:d, demand:sum(dr.map(r=>r.demand_units)), capacity:sum(dr.map(r=>Math.max(0,r.scheduled_hours-r.absence_hours))), productive:sum(dr.map(r=>r.productive_hours))};
    });
    const productivity=sum(trs.map(r=>r.demand_units))/(sum(trs.map(r=>r.productive_hours))||1);
    const recent=daily.slice(-Math.min(14,daily.length));
    const baseCap=mean(recent.map(d=>d.capacity));
    const weekday = new Map();
    for (const d of daily) {
      const w=new Date(`${d.date}T00:00:00`).getDay();
      if(!weekday.has(w)) weekday.set(w,[]); weekday.get(w).push(d.demand);
    }
    const xs=daily.map((_,i)=>i), ys=daily.map(d=>d.demand);
    const xm=mean(xs), ym=mean(ys);
    const denom=sum(xs.map(x=>(x-xm)**2));
    const slope=denom ? sum(xs.map((x,i)=>(x-xm)*(ys[i]-ym)))/denom : 0;
    const fitted=daily.map((d,i)=> (mean(weekday.get(new Date(`${d.date}T00:00:00`).getDay())||ys) + slope*(i-(daily.length-1))));
    const residuals=daily.map((d,i)=>d.demand-fitted[i]);
    for(let h=1;h<=horizon;h++){
      const dt=new Date(maxDate); dt.setDate(dt.getDate()+h);
      const date=dt.toISOString().slice(0,10), w=dt.getDay();
      const weekdayBase=mean(weekday.get(w)||ys);
      const trend=slope*h;
      const sims=[];
      for(let s=0;s<400;s++){
        const res=residuals.length ? residuals[Math.floor(rand()*residuals.length)] : 0;
        sims.push(Math.max(0,weekdayBase+trend+res));
      }
      const demandP50=quantile(sims,.5), demandRisk=quantile(sims,serviceQuantile);
      const requiredHours=productivity>0 ? demandRisk/productivity/targetUtilization : 0;
      const gap=requiredHours-baseCap;
      out.push({team,date,demandP50,demandRisk,productivity,baseCapacity:baseCap,requiredHours,gap,status:gap>2?'SHORTAGE':gap<-2?'EXCESS':'BALANCED'});
    }
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||b.gap-a.gap);
}

export function transferPlan(forecast) {
  const byDate = new Map();
  forecast.forEach(r=>{if(!byDate.has(r.date))byDate.set(r.date,[]);byDate.get(r.date).push({...r});});
  const actions=[];
  for(const [date,rs] of byDate){
    const shortages=rs.filter(r=>r.gap>2).sort((a,b)=>b.gap-a.gap);
    const excess=rs.filter(r=>r.gap<-2).map(r=>({...r,available:-r.gap})).sort((a,b)=>b.available-a.available);
    for(const sh of shortages){
      let need=sh.gap;
      for(const ex of excess){
        if(need<=.25)break; if(ex.available<=.25)continue;
        const hours=Math.min(need,ex.available);
        actions.push({date,from:ex.team,to:sh.team,hours,kind:'REALLOCATE'});
        need-=hours; ex.available-=hours;
      }
      if(need>.25) actions.push({date,from:'Unfilled',to:sh.team,hours:need,kind:'ADD_CAPACITY'});
    }
  }
  return actions;
}

export function dataQuality(rows) {
  if(!rows.length) return [];
  const days=[...new Set(rows.map(r=>r.date))].length;
  const teams=[...new Set(rows.map(r=>r.team))].length;
  const zeroDemand=rows.filter(r=>r.demand_units===0).length/rows.length;
  const impossible=rows.filter(r=>r.productive_hours>r.scheduled_hours+0.01).length;
  const absenceOver=rows.filter(r=>r.absence_hours>r.scheduled_hours+0.01).length;
  return [
    {label:'History depth',value:`${days} days`,level:days>=21?'good':'warn',note:days>=21?'Enough for weekday patterning.':'Short history; forecast uncertainty is understated.'},
    {label:'Team coverage',value:`${teams} teams`,level:'good',note:'Forecasts are built independently by team.'},
    {label:'Zero-demand rows',value:`${(zeroDemand*100).toFixed(1)}%`,level:zeroDemand>.35?'warn':'good',note:'High zero-demand share can indicate missing demand capture.'},
    {label:'Impossible hours',value:String(impossible+absenceOver),level:(impossible+absenceOver)>0?'bad':'good',note:'Productive or absence hours should not exceed scheduled hours.'}
  ];
}

export function exportActions(actions){
  const head='date,action,from_team,to_team,hours\n';
  return head+actions.map(a=>[a.date,a.kind,a.from,a.to,a.hours.toFixed(2)].join(',')).join('\n');
}


export function generateDemoCSV(){
  const header='date,team,role,employee_id,scheduled_hours,productive_hours,absence_hours,demand_units';
  const lines=[header];
  const teams=[['Fulfillment',3,12],['Support',3,8],['Returns',2,9.5]];
  const start=new Date('2026-07-01T00:00:00');
  for(let d=0;d<42;d++){
    const dt=new Date(start);dt.setDate(dt.getDate()+d);
    const date=dt.toISOString().slice(0,10), weekend=dt.getDay()===0||dt.getDay()===6;
    for(const [team,n,rate] of teams){
      const trend=1+d*(team==='Fulfillment'?.006:team==='Support'?.002:0);
      const wave=1+0.11*Math.sin(d*1.7+(team==='Support'?1.2:0));
      const total=n*7*rate*(weekend?.72:1)*trend*wave;
      for(let i=0;i<n;i++){
        const absence=((d*7+i*11+team.length)%71===0)?8:0;
        const productive=Math.max(0,8-absence)*(0.82+((d+i)%5)*.025);
        const units=total/n*(.96+((i*3+d)%7)*.012);
        lines.push([date,team,team==='Support'?'Agent':'Associate',`${team[0]}${String(i+1).padStart(2,'0')}`,8,productive.toFixed(2),absence,units.toFixed(1)].join(','));
      }
    }
  }
  return lines.join('\n');
}
