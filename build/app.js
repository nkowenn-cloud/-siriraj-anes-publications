(function(){
"use strict";

var DATA = JSON.parse(document.getElementById('dataBlock').textContent);

var YEARS = (DATA.years && DATA.years.length
             ? DATA.years
             : Array.from(new Set(DATA.papers.map(function(p){ return p.year; })))
                    .filter(Boolean).sort()).map(String);
var DOCTYPE_ORDER = ['original','review','case_report','guideline','letter','other'];
var DOCTYPE_LABEL = {
  original:'Original article', review:'Review / Meta-analysis',
  case_report:'Case report', guideline:'Guideline',
  letter:'Letter / Comment / Editorial', other:'Other'
};
var DOCTYPES = DOCTYPE_ORDER.filter(function(d){
  return DATA.papers.some(function(p){ return p.doctype===d; });
});
var POSITIONS = ['first','last','middle'];
var POS_LABEL = {first:'First author', last:'Last author', middle:'Co-author'};
var POS_SHORT = {first:'First', last:'Last', middle:'Co'};
var Q_ORDER = ['Q1','Q2','Q3','Q4','not-indexed',''];
var Q_LABEL = {'not-indexed':'Not in Scopus','':'Unknown'};
var QUARTILES = Q_ORDER.filter(function(q){
  return DATA.papers.some(function(p){ return p.q===q; });
});
var CORE_TYPES = ['original','review','case_report'].filter(function(d){ return DOCTYPES.indexOf(d)>-1; });

function defaultFilters(){
  return {
    years: new Set(YEARS),
    doctypes: new Set(CORE_TYPES),
    positions: new Set(POSITIONS),
    quartiles: new Set(QUARTILES)
  };
}
var FILTERS = defaultFilters();

var CURRENT_VIEW = 'home';
var CURRENT_PERSON = null;
var filtersCollapsed = (typeof window !== 'undefined' && window.innerWidth <= 640);
var LB_LIMIT = 10;
var SORT_STATE = {
  personTable: {key:'year', dir:'desc'},
  deptTable: {key:'year', dir:'desc'}
};
var personChartInstance = null;
var deptChartInstance = null;

// ---------------------------------------------------------------- utils --

function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function normalize(s){ return String(s||'').toLowerCase().replace(/[\s\-.]/g,''); }
function posOrderIndex(pos){ return POSITIONS.indexOf(pos); }
function qOrderIndex(q){ var i = Q_ORDER.indexOf(q); return i<0 ? Q_ORDER.length : i; }

function titleLink(p){
  var t = esc(p.title || '(untitled)');
  if(p.pmid){
    return '<a href="https://pubmed.ncbi.nlm.nih.gov/' + esc(p.pmid) + '/" target="_blank" rel="noopener">' + t + '</a>';
  }
  return t;
}
function qTag(p){
  if(!p.q) return '<span class="tag">Unknown</span>';
  if(p.q==='not-indexed') return '<span class="tag">Not in Scopus</span>';
  return '<span class="tag q-' + p.q + '">' + esc(p.q) + '</span>';
}

// -------------------------------------------------------- data indexing --

function personEntries(name){
  var out = [];
  DATA.papers.forEach(function(p){
    for(var i=0;i<p.dept.length;i++){
      if(p.dept[i].person===name){ out.push({paper:p, pos:p.dept[i].pos}); break; }
    }
  });
  return out;
}

function paperPassesBaseFilters(p){
  return FILTERS.years.has(String(p.year)) &&
         FILTERS.doctypes.has(p.doctype) &&
         FILTERS.quartiles.has(p.q);
}

function personFiltered(name){
  return personEntries(name).filter(function(e){
    return paperPassesBaseFilters(e.paper) && FILTERS.positions.has(e.pos);
  });
}

function deptFilteredPapers(){
  return DATA.papers.filter(function(p){
    if(!paperPassesBaseFilters(p)) return false;
    return p.dept.some(function(d){ return FILTERS.positions.has(d.pos); });
  });
}

function leaderboardData(){
  var map = new Map();
  DATA.papers.forEach(function(p){
    if(!paperPassesBaseFilters(p)) return;
    p.dept.forEach(function(d){
      if(!FILTERS.positions.has(d.pos)) return;
      if(!map.has(d.person)) map.set(d.person, {name:d.person, total:0, first:0, last:0, middle:0, q1:0});
      var s = map.get(d.person);
      s.total++; s[d.pos]++;
      if(p.q==='Q1') s.q1++;
    });
  });
  return Array.from(map.values()).sort(function(a,b){ return b.total-a.total; });
}

function buildPersonCounts(){
  var m = new Map();
  DATA.roster.forEach(function(n){ m.set(n,0); });
  DATA.papers.forEach(function(p){
    p.dept.forEach(function(d){ m.set(d.person, (m.get(d.person)||0)+1); });
  });
  return m;
}
var PERSON_COUNTS = buildPersonCounts();

function homeHeadline(){
  var core = DATA.papers.filter(function(p){ return CORE_TYPES.indexOf(p.doctype)>-1; });
  var people = new Set();
  core.forEach(function(p){ p.dept.forEach(function(d){ people.add(d.person); }); });
  var q1 = core.filter(function(p){ return p.q==='Q1'; }).length;
  return { totalPapers: core.length, people: people.size, q1: q1 };
}

function topPeople(n){
  var map = new Map();
  DATA.papers.forEach(function(p){
    if(CORE_TYPES.indexOf(p.doctype)===-1) return;
    p.dept.forEach(function(d){ map.set(d.person, (map.get(d.person)||0)+1); });
  });
  return Array.from(map.entries()).sort(function(a,b){ return b[1]-a[1]; }).slice(0,n);
}

// -------------------------------------------------------------- filters --

function pillGroup(label, groupKey, options, activeSet, labelFn){
  var html = '<div><span class="fgroup-label">' + esc(label) + '</span><div class="pillset">';
  options.forEach(function(v){
    var on = activeSet.has(v) ? ' on' : '';
    var extra = (groupKey==='quartiles' && v==='Q1') ? ' q1' : '';
    var text = labelFn ? labelFn(v) : v;
    html += '<button class="pill' + on + extra + '" data-group="' + groupKey + '" data-value="' + esc(v) + '">' + esc(text) + '</button>';
  });
  html += '</div></div>';
  return html;
}

function buildFiltersPanel(collapsed){
  var body =
    pillGroup('Year', 'years', YEARS, FILTERS.years) +
    pillGroup('Document type', 'doctypes', DOCTYPES, FILTERS.doctypes, function(v){ return DOCTYPE_LABEL[v]||v; }) +
    pillGroup('Author position', 'positions', POSITIONS, FILTERS.positions, function(v){ return POS_LABEL[v]||v; }) +
    pillGroup('Quartile', 'quartiles', QUARTILES, FILTERS.quartiles, function(v){ return Q_LABEL[v] || v; }) +
    '<div class="filters-foot"><button class="reset-link" data-action="reset-filters">Reset all filters</button></div>';
  return (
    '<div class="filters-head" data-action="toggle-filters">' +
      '<h4>Filters</h4><span class="toggle">' + (collapsed?'Show ▾':'Hide ▴') + '</span>' +
    '</div>' +
    '<div class="filters-body' + (collapsed?' collapsed':'') + '">' + body + '</div>'
  );
}

// --------------------------------------------------------------- render --

function renderHome(){
  var h = homeHeadline();
  document.getElementById('homeStats').innerHTML =
    '<div class="home-stat"><div class="num">' + h.totalPapers + '</div><div class="lbl">Research papers (' + YEARS[0] + '&ndash;' + YEARS[YEARS.length-1] + ')</div></div>' +
    '<div class="home-stat"><div class="num">' + h.people + '</div><div class="lbl">Faculty with publications</div></div>' +
    '<div class="home-stat"><div class="num">' + h.q1 + '</div><div class="lbl">Published in Q1 journals</div></div>' +
    '<div class="home-stat"><div class="num">' + DATA.roster.length + '</div><div class="lbl">Faculty in department</div></div>';

  var chips = topPeople(12);
  document.getElementById('topChips').innerHTML = chips.map(function(c){
    return '<span class="chip" data-person="' + esc(c[0]) + '">' + esc(c[0]) + ' &middot; ' + c[1] + '</span>';
  }).join('');
}

function renderSearchResults(query){
  var box = document.getElementById('searchResults');
  var q = normalize(query);
  if(!q){ box.classList.remove('show'); box.innerHTML=''; return; }
  var matches = DATA.roster
    .filter(function(n){ return normalize(n).indexOf(q)>-1; })
    .sort(function(a,b){ return (PERSON_COUNTS.get(b)||0) - (PERSON_COUNTS.get(a)||0); })
    .slice(0,10);
  if(matches.length===0){
    box.innerHTML = '<div class="search-row empty">No matching name — try a different spelling</div>';
  } else {
    box.innerHTML = matches.map(function(n){
      return '<div class="search-row" data-person="' + esc(n) + '"><span>' + esc(n) + '</span><span class="cnt">' +
        (PERSON_COUNTS.get(n)||0) + ' papers</span></div>';
    }).join('');
  }
  box.classList.add('show');
}

function personComparator(key, dir){
  var mul = dir==='asc' ? 1 : -1;
  return function(a,b){
    var av, bv;
    switch(key){
      case 'pos': av=posOrderIndex(a.pos); bv=posOrderIndex(b.pos); break;
      case 'doctype': av=a.paper.doctype; bv=b.paper.doctype; break;
      case 'journal': av=a.paper.journal.toLowerCase(); bv=b.paper.journal.toLowerCase(); break;
      case 'q': av=qOrderIndex(a.paper.q); bv=qOrderIndex(b.paper.q); break;
      default: av=a.paper.year; bv=b.paper.year;
    }
    if(av<bv) return -1*mul;
    if(av>bv) return 1*mul;
    return b.paper.year - a.paper.year;
  };
}
function deptComparator(key, dir){
  var mul = dir==='asc' ? 1 : -1;
  return function(a,b){
    var av, bv;
    switch(key){
      case 'journal': av=a.journal.toLowerCase(); bv=b.journal.toLowerCase(); break;
      case 'q': av=qOrderIndex(a.q); bv=qOrderIndex(b.q); break;
      default: av=a.year; bv=b.year;
    }
    if(av<bv) return -1*mul;
    if(av>bv) return 1*mul;
    return b.year - a.year;
  };
}

function renderPersonStats(entries){
  var total=entries.length, first=0, last=0, middle=0, q1=0;
  entries.forEach(function(e){
    first += e.pos==='first'?1:0;
    last += e.pos==='last'?1:0;
    middle += e.pos==='middle'?1:0;
    if(e.paper.q==='Q1') q1++;
  });
  var rows = [
    ['', 'Publications (filtered)', total],
    ['first', 'First author', first],
    ['last', 'Last author', last],
    ['', 'Co-author', middle],
    ['q1', 'Q1 journals', q1]
  ];
  document.getElementById('personStats').innerHTML = rows.map(function(r){
    return '<div class="statcell ' + r[0] + '"><div class="num">' + r[2] + '</div><div class="lbl">' + r[1] + '</div></div>';
  }).join('');
}

function chartFallback(canvasId, msg){
  var canvas = document.getElementById(canvasId);
  if(!canvas) return;
  canvas.style.display = 'none';
  var box = canvas.closest('.chart-box');
  if(box && !box.querySelector('.chart-fallback')){
    var div = document.createElement('div');
    div.className = 'chart-fallback';
    div.style.cssText = 'padding:30px 10px;text-align:center;color:#8B8275;font-size:12.5px;';
    div.textContent = msg;
    box.appendChild(div);
  }
}

function renderPersonChart(entries){
  if(typeof Chart === 'undefined'){ chartFallback('personChart', 'Chart could not load (needs internet for Chart.js) — the data below still works.'); return; }
  var byYear = {};
  YEARS.forEach(function(y){ byYear[y] = {first:0,last:0,middle:0}; });
  entries.forEach(function(e){
    var y = String(e.paper.year);
    if(byYear[y]) byYear[y][e.pos]++;
  });
  var ctx = document.getElementById('personChart');
  if(personChartInstance) personChartInstance.destroy();
  try{
  personChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: YEARS,
      datasets: [
        {label:'First author', data: YEARS.map(function(y){return byYear[y].first;}), backgroundColor:'#7A2331', borderRadius:2, maxBarThickness:44},
        {label:'Last author', data: YEARS.map(function(y){return byYear[y].last;}), backgroundColor:'#1E6E67', borderRadius:2, maxBarThickness:44},
        {label:'Co-author', data: YEARS.map(function(y){return byYear[y].middle;}), backgroundColor:'#C9C1B2', borderRadius:2, maxBarThickness:44}
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x: {stacked:true, grid:{display:false}, ticks:{color:'#8B8275', font:{size:11}}},
        y: {stacked:true, beginAtZero:true, ticks:{color:'#8B8275', font:{size:11}, precision:0}, grid:{color:'#DED6C7'}}
      },
      plugins:{ legend:{display:false} }
    }
  });
  } catch(err){ chartFallback('personChart', 'Chart could not be displayed — the data below still works.'); }
}

function csvEscape(v){
  var s = String(v==null?'':v);
  if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function downloadCSV(filename, rows){
  var csv = rows.map(function(r){ return r.map(csvEscape).join(','); }).join('\r\n');
  var blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
function exportPerson(){
  if(!CURRENT_PERSON) return;
  var entries = personFiltered(CURRENT_PERSON);
  var s = SORT_STATE.personTable;
  entries = entries.slice().sort(personComparator(s.key, s.dir));
  var rows = [['Year','Position','Doc type','Journal','Quartile','Quartile source','Title','No. of authors','PMID','DOI']];
  entries.forEach(function(e){
    var p = e.paper;
    rows.push([p.year, POS_LABEL[e.pos], DOCTYPE_LABEL[p.doctype]||p.doctype, p.journal,
               p.q, 'SJR Best Quartile (Scimago 2025)', p.title, p.nau, p.pmid, p.doi]);
  });
  downloadCSV(CURRENT_PERSON.replace(/\s+/g,'_') + '_publications.csv', rows);
}
function exportDept(){
  var papers = deptFilteredPapers();
  var s = SORT_STATE.deptTable;
  papers = papers.slice().sort(deptComparator(s.key, s.dir));
  var rows = [['Year','Journal','Quartile','Quartile source','Title','Doc type','No. of authors','Dept members (position)','PMID','DOI']];
  papers.forEach(function(p){
    var who = p.dept.map(function(d){ return d.person + ' (' + POS_LABEL[d.pos] + ')'; }).join('; ');
    rows.push([p.year, p.journal, p.q, 'SJR Best Quartile (Scimago 2025)', p.title,
               DOCTYPE_LABEL[p.doctype]||p.doctype, p.nau, who, p.pmid, p.doi]);
  });
  downloadCSV('siriraj_anes_publications_filtered.csv', rows);
}

function renderPersonTable(entries){
  var tbody = document.querySelector('#personTable tbody');
  var emptyEl = document.getElementById('personEmpty');
  var wrapEl = document.getElementById('personTable').closest('.table-wrap');
  if(entries.length===0){
    tbody.innerHTML=''; emptyEl.style.display='block';
    if(wrapEl) wrapEl.style.display='none';
    return;
  }
  emptyEl.style.display='none';
  if(wrapEl) wrapEl.style.display='';
  var s = SORT_STATE.personTable;
  var sorted = entries.slice().sort(personComparator(s.key, s.dir));
  tbody.innerHTML = sorted.map(function(e){
    var p = e.paper;
    return '<tr>' +
      '<td>' + p.year + '</td>' +
      '<td><span class="tag pos-' + e.pos + '">' + POS_LABEL[e.pos] + '</span></td>' +
      '<td>' + (DOCTYPE_LABEL[p.doctype]||p.doctype) + '</td>' +
      '<td>' + esc(p.journal) + '</td>' +
      '<td>' + qTag(p) + '</td>' +
      '<td class="title-cell">' + titleLink(p) + '</td>' +
    '</tr>';
  }).join('');
}

function renderPerson(name){
  document.getElementById('personName').textContent = name;
  var allEntries = personEntries(name);
  document.getElementById('personSub').textContent = allEntries.length
    ? allEntries.length + ' records on file (all document types) — use the filters below to narrow them down'
    : 'No publications found for this name. The name may be spelled differently in journals, or there may be none in ' + YEARS[0] + '–' + YEARS[YEARS.length-1] + '.';

  document.getElementById('personFiltersMount').innerHTML = buildFiltersPanel(filtersCollapsed);

  var filtered = personFiltered(name);
  renderPersonStats(filtered);
  renderPersonTable(filtered);
  renderPersonChart(filtered);
}

function renderDeptStats(papers){
  var first=0, last=0, middle=0, q1=0;
  papers.forEach(function(p){
    if(p.q==='Q1') q1++;
    p.dept.forEach(function(d){
      if(!FILTERS.positions.has(d.pos)) return;
      if(d.pos==='first') first++;
      else if(d.pos==='last') last++;
      else middle++;
    });
  });
  var rows = [
    ['', 'Publications (1 per paper)', papers.length],
    ['first', 'First-author slots', first],
    ['last', 'Last-author slots', last],
    ['', 'Co-author slots', middle],
    ['q1', 'In Q1 journals', q1]
  ];
  document.getElementById('deptStats').innerHTML = rows.map(function(r){
    return '<div class="statcell ' + r[0] + '"><div class="num">' + r[2] + '</div><div class="lbl">' + r[1] + '</div></div>';
  }).join('');
}

function renderDeptChart(papers){
  if(typeof Chart === 'undefined'){ chartFallback('deptChart', 'Chart could not load (needs internet for Chart.js) — the data below still works.'); return; }
  var byYear = {};
  YEARS.forEach(function(y){ byYear[y] = {q1:0, other:0}; });
  papers.forEach(function(p){
    var y = String(p.year);
    if(!byYear[y]) return;
    if(p.q==='Q1') byYear[y].q1++; else byYear[y].other++;
  });
  var ctx = document.getElementById('deptChart');
  if(deptChartInstance) deptChartInstance.destroy();
  try{
  deptChartInstance = new Chart(ctx, {
    type:'bar',
    data:{
      labels: YEARS,
      datasets:[
        {label:'Q1', data: YEARS.map(function(y){return byYear[y].q1;}), backgroundColor:'#AD7A22', borderRadius:2, maxBarThickness:44},
        {label:'Other quartiles / unknown', data: YEARS.map(function(y){return byYear[y].other;}), backgroundColor:'#C9C1B2', borderRadius:2, maxBarThickness:44}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{stacked:true, grid:{display:false}, ticks:{color:'#8B8275', font:{size:11}}},
        y:{stacked:true, beginAtZero:true, ticks:{color:'#8B8275', font:{size:11}, precision:0}, grid:{color:'#DED6C7'}}
      },
      plugins:{ legend:{display:false} }
    }
  });
  } catch(err){ chartFallback('deptChart', 'Chart could not be displayed — the data below still works.'); }
}

function renderLeaderboard(){
  var all = leaderboardData();
  var el = document.getElementById('leaderboard');
  var moreEl = document.getElementById('lbMore');
  if(all.length===0){
    el.innerHTML = '<div class="empty-state" style="border:none;">No publications match the current filters.</div>';
    moreEl.innerHTML = '';
    return;
  }
  var n = (LB_LIMIT==='all') ? all.length : Math.min(LB_LIMIT, all.length);
  var data = all.slice(0, n);
  var html = '<div class="lb-head"><span>#</span><span>Name</span><span>Total</span>' +
             '<span>First</span><span>Last</span><span>Q1</span></div>';
  html += data.map(function(d, i){
    return '<div class="lb-row" data-person="' + esc(d.name) + '">' +
      '<span class="lb-rank">' + (i+1) + '</span>' +
      '<span class="lb-name">' + esc(d.name) + '</span>' +
      '<span class="lb-num tot">' + d.total + '</span>' +
      '<span class="lb-num f">' + d.first + '</span>' +
      '<span class="lb-num l">' + d.last + '</span>' +
      '<span class="lb-num q">' + d.q1 + '</span>' +
    '</div>';
  }).join('');
  el.innerHTML = html;

  var opts = [['10','Top 10'], ['20','Top 20'], ['all','All (' + all.length + ')']];
  moreEl.innerHTML = opts.map(function(o){
    var val = o[0]==='all' ? 'all' : parseInt(o[0],10);
    var on = (String(LB_LIMIT)===String(val)) ? ' on' : '';
    return '<button class="' + on.trim() + '" data-action="lb-limit" data-limit="' + o[0] + '">' + o[1] + '</button>';
  }).join('');
}

function exportLeaderboard(){
  var all = leaderboardData();
  var rows = [['Rank','Name','Total','First author','Last author','Middle author','Q1','Q1 %']];
  all.forEach(function(d, i){
    rows.push([i+1, d.name, d.total, d.first, d.last, d.middle, d.q1,
               d.total ? (d.q1/d.total*100).toFixed(0) + '%' : '']);
  });
  downloadCSV('siriraj_anes_leaderboard.csv', rows);
}

function renderDeptTable(papers){
  var tbody = document.querySelector('#deptTable tbody');
  var emptyEl = document.getElementById('deptEmpty');
  var wrapEl = document.getElementById('deptTable').closest('.table-wrap');
  if(papers.length===0){
    tbody.innerHTML=''; emptyEl.style.display='block';
    if(wrapEl) wrapEl.style.display='none';
    return;
  }
  emptyEl.style.display='none';
  if(wrapEl) wrapEl.style.display='';
  var s = SORT_STATE.deptTable;
  var sorted = papers.slice().sort(deptComparator(s.key, s.dir));
  tbody.innerHTML = sorted.map(function(p){
    var authors = p.dept.map(function(d){
      return esc(d.person) + ' <span class="tag pos-' + d.pos + '" style="margin-left:2px;">' + POS_LABEL[d.pos] + '</span>';
    }).join('<br>');
    return '<tr>' +
      '<td>' + p.year + '</td>' +
      '<td>' + esc(p.journal) + '</td>' +
      '<td>' + qTag(p) + '</td>' +
      '<td class="title-cell">' + titleLink(p) + '</td>' +
      '<td class="dept-authors">' + authors + '</td>' +
    '</tr>';
  }).join('');
}

function renderJournalsRef(){
  document.getElementById('jrefBody').innerHTML = DATA.journals.map(function(j){
    var q = j.q==='not-indexed' ? 'Not in Scopus' : (j.q || '—');
    return '<tr><td>' + esc(j.name) + '</td><td>' + j.n + '</td><td>' + esc(q) + '</td><td style="font-size:11.5px;color:#8B8275;">' + esc(j.categories||'—') + '</td></tr>';
  }).join('');
}

function renderDept(){
  document.getElementById('deptFiltersMount').innerHTML = buildFiltersPanel(filtersCollapsed);
  var papers = deptFilteredPapers();
  renderDeptStats(papers);
  renderLeaderboard();
  renderDeptTable(papers);
  renderDeptChart(papers);
  renderJournalsRef();
}

function renderCurrentView(){
  if(CURRENT_VIEW==='person') renderPerson(CURRENT_PERSON);
  else if(CURRENT_VIEW==='dept') renderDept();
  else renderHome();
}

// ----------------------------------------------------------- navigation --

function go(view){
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-'+view).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(function(b){
    b.classList.toggle('active', b.dataset.nav===view);
  });
  CURRENT_VIEW = view;
  window.scrollTo(0,0);
  if(view==='home') renderHome();
  if(view==='dept') renderDept();
}

function openPerson(name){
  CURRENT_PERSON = name;
  CURRENT_VIEW = 'person';
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-person').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
  window.scrollTo(0,0);
  renderPerson(name);
}

// ---------------------------------------------------------------- setup --

document.addEventListener('DOMContentLoaded', function(){
  // Fill in the year range and Scimago year automatically
  var yFrom = YEARS[0], yTo = YEARS[YEARS.length-1];
  var sy = DATA.sci_year || '';
  var range = yFrom + '–' + yTo;
  var bt = document.getElementById('bannerText');
  if(bt) bt.textContent = 'Publications are pulled from PubMed by author name, so coverage may be incomplete '
    + 'where a name is spelled differently. Quartiles use SJR Best Quartile from Scimago ' + sy
    + ', applied to every publication year.';
  var ds = document.getElementById('deptSub');
  if(ds) ds.textContent = range + ' · Data from PubMed';
  var js = document.getElementById('jrefSummary');
  if(js) js.textContent = 'Journal reference table (SJR Best Quartile, Scimago ' + sy + ')';
  var fn = document.getElementById('footNote');  if(fn) fn.textContent = 'Built from PubMed records matched against the department faculty list ('
    + range + '). Quartile = SJR Best Quartile, Scimago Journal Rank ' + sy + ', matched by ISSN. '
    + '"Not in Scopus" means the journal does not appear in the Scimago ' + sy + ' file. '
    + 'The latest year (' + yTo + ') may be incomplete. Updated automatically from PubMed.';

  var us = document.getElementById('updatedStamp');
  if(us){
    if(DATA.generated_at){
      var d = new Date(DATA.generated_at);
      if(!isNaN(d)){
        var days = Math.floor((Date.now() - d.getTime()) / 86400000);
        var ago = days <= 0 ? 'today' : (days === 1 ? 'yesterday' : days + ' days ago');
        us.textContent = 'Data last rebuilt: ' + d.toLocaleString(undefined, {
          year:'numeric', month:'short', day:'numeric',
          hour:'2-digit', minute:'2-digit'
        }) + ' (' + ago + ') · ' + DATA.papers.length + ' records';
        if(days > 14){ us.style.color = '#AD7A22'; us.textContent += ' — auto-update may have stopped'; }
      }
    } else {
      us.textContent = 'Data rebuild time unknown (built with an older script version)';
    }
  }

  renderHome();

  document.getElementById('bannerClose').addEventListener('click', function(){
    document.getElementById('bannerWrap').style.display = 'none';
  });

  var searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', function(e){ renderSearchResults(e.target.value); });
  searchInput.addEventListener('keydown', function(e){
    if(e.key==='Escape'){ searchInput.value=''; renderSearchResults(''); searchInput.blur(); }
    if(e.key==='Enter'){
      var first = document.querySelector('.search-row[data-person]');
      if(first){ openPerson(first.dataset.person); searchInput.value=''; renderSearchResults(''); }
    }
  });
  document.addEventListener('click', function(e){
    if(!e.target.closest('.search-wrap')){
      document.getElementById('searchResults').classList.remove('show');
    }
  });

  document.addEventListener('click', function(e){
    var navBtn = e.target.closest('[data-nav]');
    if(navBtn){ go(navBtn.dataset.nav); return; }

    var personEl = e.target.closest('[data-person]');
    if(personEl){
      openPerson(personEl.dataset.person);
      searchInput.value='';
      document.getElementById('searchResults').classList.remove('show');
      return;
    }

    var pill = e.target.closest('.pill');
    if(pill){
      var group = pill.dataset.group, value = pill.dataset.value;
      var set = FILTERS[group];
      if(set.has(value)) set.delete(value); else set.add(value);
      renderCurrentView();
      return;
    }

    var action = e.target.closest('[data-action]');
    if(action){
      var act = action.dataset.action;
      if(act==='reset-filters'){ FILTERS = defaultFilters(); renderCurrentView(); }
      if(act==='toggle-filters'){ filtersCollapsed = !filtersCollapsed; renderCurrentView(); }
      if(act==='dl-person'){ exportPerson(); }
      if(act==='dl-dept'){ exportDept(); }
      if(act==='dl-leaderboard'){ exportLeaderboard(); }
      if(act==='lb-limit'){
        var lv = action.dataset.limit;
        LB_LIMIT = (lv==='all') ? 'all' : parseInt(lv,10);
        renderLeaderboard();
      }
      return;
    }

    var th = e.target.closest('th[data-sort]');
    if(th){
      var tableId = th.closest('table').id;
      var key = th.dataset.sort;
      var s = SORT_STATE[tableId];
      if(s.key===key) s.dir = (s.dir==='asc'?'desc':'asc');
      else { s.key = key; s.dir = 'desc'; }
      renderCurrentView();
      return;
    }
  });
});

})();
